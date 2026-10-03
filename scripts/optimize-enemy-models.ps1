$ErrorActionPreference = 'Stop'

# Reproducible offline asset pass. Source GLBs under 3D/ are read-only inputs.
# glTF Transform simplification preserves material assignments, UVs, and existing normals.
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'public\assets\models\enemies\optimized'
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('tower-defence-enemy-opt-' + [guid]::NewGuid().ToString('N'))
$toolPackage = '@gltf-transform/cli@4.5.1'

$models = @(
  @{ Name = 'goblin'; Source = 'Goblin'; Ratio = '0.075'; TextureLimit = 1024 },
  @{ Name = 'goblin-brute'; Source = 'Goblin Brute'; Ratio = '0.07'; TextureLimit = 1024 },
  @{ Name = 'goblin-rider'; Source = 'Goblin Rider'; Ratio = '0.14'; TextureLimit = 2048 },
  @{ Name = 'giant-goblin'; Source = 'Giant Goblin'; Ratio = '0.09'; TextureLimit = 2048 },
  @{ Name = 'ghoul'; Source = 'Ghoul'; Ratio = '0.10'; TextureLimit = 1024 },
  @{ Name = 'wraith'; Source = 'Wraith'; Ratio = '0.09'; TextureLimit = 1024 }
)

New-Item -ItemType Directory -Force -Path $outputDirectory, $temporaryDirectory | Out-Null
try {
  foreach ($model in $models) {
    $sourcePath = Join-Path $projectRoot "3D\$($model.Source).glb"
    $simplifiedPath = Join-Path $temporaryDirectory "$($model.Name).glb"
    $outputPath = Join-Path $outputDirectory "$($model.Name).glb"

    & npm exec --yes --package=$toolPackage -- gltf-transform simplify $sourcePath $simplifiedPath `
      --ratio $model.Ratio --error 0.02
    if ($LASTEXITCODE -ne 0) { throw "Geometry simplification failed for $($model.Source).glb" }

    if ($model.TextureLimit -lt 2048) {
      & npm exec --yes --package=$toolPackage -- gltf-transform resize $simplifiedPath $outputPath `
        --width $model.TextureLimit --height $model.TextureLimit --filter lanczos3
      if ($LASTEXITCODE -ne 0) { throw "Texture resize failed for $($model.Source).glb" }
    } else {
      Move-Item -LiteralPath $simplifiedPath -Destination $outputPath -Force
    }
  }
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($temporaryDirectory)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $tempPathIsScoped = $resolvedTemp.StartsWith($expectedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
  $tempFolderIsOurs = (Split-Path -Leaf $resolvedTemp).StartsWith('tower-defence-enemy-opt-')
  if ($tempPathIsScoped -and $tempFolderIsOurs) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
