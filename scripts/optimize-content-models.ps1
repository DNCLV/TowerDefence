param([string[]]$Only = @())
$ErrorActionPreference = 'Stop'

# Same glTF Transform simplify/resize pipeline as optimize-enemy-models.ps1.
# Source GLBs stay untouched; runtime originals are retained where a Runtime path is set.
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolPackage = '@gltf-transform/cli@4.5.1'
$cachedCli = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx\*\node_modules\.bin\gltf-transform.cmd') -ErrorAction SilentlyContinue | Select-Object -First 1
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('tower-defence-content-opt-' + [guid]::NewGuid().ToString('N'))
$models = @(
  @{ Source = 'Undead Dragon'; Runtime = 'public\assets\models\enemies\undead-dragon.glb'; Optimized = 'public\assets\models\enemies\optimized\undead-dragon.glb'; Ratio = '0.14'; TextureLimit = 1024 },
  @{ Source = 'Skeleton King'; Runtime = 'public\assets\models\enemies\skeleton-king.glb'; Optimized = 'public\assets\models\enemies\optimized\skeleton-king.glb'; Ratio = '0.11'; TextureLimit = 1024 },
  @{ Source = 'Green Archer'; Runtime = 'public\assets\models\defenders\green-archer.glb'; Optimized = 'public\assets\models\defenders\optimized\green-archer.glb'; Ratio = '0.11'; TextureLimit = 1024 },
  @{ Source = 'Battlemage'; Runtime = 'public\assets\models\defenders\battlemage.glb'; Optimized = 'public\assets\models\defenders\optimized\battlemage.glb'; Ratio = '0.075'; TextureLimit = 1024 },
  @{ Source = 'Skeletal Commander Flying'; Runtime = 'public\assets\models\enemies\skeletal-commander.glb'; Optimized = 'public\assets\models\enemies\optimized\skeletal-commander.glb'; Ratio = '0.13'; TextureLimit = 1024 },
  @{ Source = 'Soveign'; Runtime = 'public\assets\models\defenders\sovereign.glb'; Optimized = 'public\assets\models\defenders\optimized\sovereign.glb'; Ratio = '0.075'; TextureLimit = 1024 },
  @{ Source = 'Blue Wizard'; Runtime = 'public\assets\models\defenders\blue-wizard.glb'; Optimized = 'public\assets\models\defenders\optimized\blue-wizard.glb'; Ratio = '0.14'; TextureLimit = 1024 },
  @{ Source = 'Holy Knight'; Runtime = 'public\assets\models\defenders\holy-knight.glb'; Optimized = 'public\assets\models\defenders\optimized\holy-knight.glb'; Ratio = '0.14'; TextureLimit = 1024 },
  @{ Source = 'Holy Emperor'; Runtime = 'public\assets\models\defenders\holy-emperor.glb'; Optimized = 'public\assets\models\defenders\optimized\holy-emperor.glb'; Ratio = '0.10'; TextureLimit = 1024 },
  @{ Source = 'Treant'; Optimized = 'public\assets\models\defenders\optimized\treant.glb'; Ratio = '0.075'; TextureLimit = 1024 },
  @{ Source = 'Thorn Owl'; Optimized = 'public\assets\models\defenders\optimized\thorn-owl.glb'; Ratio = '0.30'; TextureLimit = 1024 },
  @{ Source = 'Druid'; Optimized = 'public\assets\models\defenders\optimized\druid.glb'; Ratio = '0.07'; TextureLimit = 1024 },
  @{ Source = 'Seer'; Optimized = 'public\assets\models\defenders\optimized\seer.glb'; Ratio = '0.085'; TextureLimit = 1024 }
)

New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
try {
  foreach ($model in $models) {
    if ($Only.Count -gt 0 -and $model.Source -notin $Only) { continue }
    $sourcePath = Join-Path $projectRoot "3D\$($model.Source).glb"
    $runtimePath = if ($model.Runtime) { Join-Path $projectRoot $model.Runtime } else { $null }
    $optimizedPath = Join-Path $projectRoot $model.Optimized
    $simplifiedPath = Join-Path $temporaryDirectory "$($model.Source -replace ' ', '-').glb"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $optimizedPath) | Out-Null

    if ($runtimePath) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $runtimePath) | Out-Null
      # Preserve an exact unoptimized runtime copy for models with an optimized-first fallback.
      Copy-Item -LiteralPath $sourcePath -Destination $runtimePath -Force
    }
    if ($cachedCli) {
      & $cachedCli.FullName simplify $sourcePath $simplifiedPath --ratio $model.Ratio --error 0.02
    } else {
      & npm exec --yes --package=$toolPackage -- gltf-transform simplify $sourcePath $simplifiedPath --ratio $model.Ratio --error 0.02
    }
    if ($LASTEXITCODE -ne 0) { throw "Geometry simplification failed for $($model.Source).glb" }

    if ($model.TextureLimit -lt 2048) {
      if ($cachedCli) {
        & $cachedCli.FullName resize $simplifiedPath $optimizedPath --width $model.TextureLimit --height $model.TextureLimit --filter lanczos3
      } else {
        & npm exec --yes --package=$toolPackage -- gltf-transform resize $simplifiedPath $optimizedPath --width $model.TextureLimit --height $model.TextureLimit --filter lanczos3
      }
      if ($LASTEXITCODE -ne 0) { throw "Texture resize failed for $($model.Source).glb" }
    } else {
      Move-Item -LiteralPath $simplifiedPath -Destination $optimizedPath -Force
    }
    $runtimeOutput = if ($runtimePath) { "$($model.Runtime) + " } else { '' }
    Write-Output "Optimized $($model.Source): $runtimeOutput$($model.Optimized)"
  }

  # This skinned Ranger is only an emergency Wizard/Knight visual fallback. Keep
  # its exact rig and geometry, but cap the six 4K source textures to 512px.
  if ($Only.Count -eq 0 -or 'Quaternius Ranger' -in $Only) {
    $rangerSource = Join-Path $projectRoot 'public\assets\models\quaternius\Female_Ranger.gltf'
    $rangerRuntime = Join-Path $projectRoot 'public\assets\models\quaternius\runtime\Female_Ranger.gltf'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $rangerRuntime) | Out-Null
    if ($cachedCli) {
      & $cachedCli.FullName resize $rangerSource $rangerRuntime --width 512 --height 512 --filter lanczos3
    } else {
      & npm exec --yes --package=$toolPackage -- gltf-transform resize $rangerSource $rangerRuntime --width 512 --height 512 --filter lanczos3
    }
    if ($LASTEXITCODE -ne 0) { throw 'Texture resize failed for Quaternius Ranger fallback.' }
    Write-Output 'Optimized Quaternius Ranger fallback textures to 512px; original rig and source textures remain untouched.'
  }
} finally {
  $resolvedTemp = [System.IO.Path]::GetFullPath($temporaryDirectory)
  $expectedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $tempPathIsScoped = $resolvedTemp.StartsWith($expectedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
  $tempFolderIsOurs = (Split-Path -Leaf $resolvedTemp).StartsWith('tower-defence-content-opt-')
  if ($tempPathIsScoped -and $tempFolderIsOurs) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
