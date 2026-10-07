param([string]$Ratio = '0.075', [int]$TextureLimit = 1024)
$ErrorActionPreference = 'Stop'

# Offline runtime pass for the chosen Casual Walk export only. The source GLB is untouched.
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot '3D\Goblin\Meshy_AI_Bloodfang_Marauder_biped\Meshy_AI_Bloodfang_Marauder_biped_Animation_Casual_Walk_withSkin.glb'
$outputDirectory = Join-Path $projectRoot 'public\assets\models\enemies\optimized'
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('tower-defence-meshy-goblin-' + [guid]::NewGuid().ToString('N'))
$simplifiedPath = Join-Path $temporaryDirectory 'bloodfang-simplified.glb'
$outputPath = Join-Path $outputDirectory 'goblin-meshy-casual-walk.glb'
$toolPackage = '@gltf-transform/cli@4.5.1'
$cachedCli = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\*\node_modules\.bin\gltf-transform.cmd') -ErrorAction SilentlyContinue | Select-Object -First 1

New-Item -ItemType Directory -Force -Path $outputDirectory, $temporaryDirectory | Out-Null
try {
  if ($cachedCli) {
    & $cachedCli.FullName simplify $sourcePath $simplifiedPath --ratio $Ratio --error 0.02
  } else {
    & npm exec --yes --package=$toolPackage -- gltf-transform simplify $sourcePath $simplifiedPath --ratio $Ratio --error 0.02
  }
  if ($LASTEXITCODE -ne 0) { throw 'Skinned mesh simplification failed.' }

  if ($cachedCli) {
    & $cachedCli.FullName resize $simplifiedPath $outputPath --width $TextureLimit --height $TextureLimit --filter lanczos3
  } else {
    & npm exec --yes --package=$toolPackage -- gltf-transform resize $simplifiedPath $outputPath --width $TextureLimit --height $TextureLimit --filter lanczos3
  }
  if ($LASTEXITCODE -ne 0) { throw 'Embedded texture resize failed.' }

  $sourceBytes = (Get-Item -LiteralPath $sourcePath).Length
  $outputBytes = (Get-Item -LiteralPath $outputPath).Length
  Write-Output ("Runtime asset created: {0:N2} MiB -> {1:N2} MiB (ratio {2}, textures capped at {3}px)." -f ($sourceBytes / 1MB), ($outputBytes / 1MB), $Ratio, $TextureLimit)
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($temporaryDirectory)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $tempPathIsScoped = $resolvedTemp.StartsWith($expectedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
  $tempFolderIsOurs = (Split-Path -Leaf $resolvedTemp).StartsWith('tower-defence-meshy-goblin-')
  if ($tempPathIsScoped -and $tempFolderIsOurs) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
