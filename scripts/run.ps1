param([ValidateSet('dev','build','test','package','start','check','installer','mac:test','mac:dmg')][string]$Task='dev')
$env:TEMP='D:\CodexData\Temp'
$env:TMP=$env:TEMP
$env:TMPDIR=$env:TEMP
$env:npm_config_cache='D:\CodexData\Cache\npm'
$env:ELECTRON_CACHE='D:\CodexData\Cache\electron'
$env:electron_config_cache=$env:ELECTRON_CACHE
$env:ELECTRON_BUILDER_CACHE='D:\CodexData\Cache\electron-builder'
$brandProjectRoot=Split-Path $PSScriptRoot -Parent
$brand7zip=Join-Path $brandProjectRoot 'node_modules\electron-winstaller\vendor\7z.exe'
if (-not $env:ELECTRON_BUILDER_7ZIP_PATH -and (Test-Path -LiteralPath $brand7zip)) { $env:ELECTRON_BUILDER_7ZIP_PATH=$brand7zip }
$brandNsis=Join-Path $env:ELECTRON_BUILDER_CACHE 'nsis-3.0.4.1'
$brandNsisResources=Join-Path $env:ELECTRON_BUILDER_CACHE 'nsis-resources-3.4.1'
if (-not $env:ELECTRON_BUILDER_NSIS_DIR -and (Test-Path -LiteralPath (Join-Path $brandNsis 'Bin\makensis.exe'))) { $env:ELECTRON_BUILDER_NSIS_DIR=$brandNsis }
if (-not $env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR -and (Test-Path -LiteralPath (Join-Path $brandNsisResources 'plugins'))) { $env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR=$brandNsisResources }
$env:XDG_CACHE_HOME='D:\CodexData\Cache'
$env:TIERFLOW_DATA_DIR='D:\CodexData\TierFlow'
$env:ELECTRON_RUN_AS_NODE=$null
foreach($dir in @($env:TEMP,$env:npm_config_cache,$env:ELECTRON_CACHE,$env:ELECTRON_BUILDER_CACHE,$env:TIERFLOW_DATA_DIR)){New-Item -ItemType Directory -Path $dir -Force | Out-Null}
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
Write-Output "Temporary files: $env:TEMP | npm cache: $env:npm_config_cache | Electron cache: $env:ELECTRON_CACHE | App data: $env:TIERFLOW_DATA_DIR"
npm run $Task
exit $LASTEXITCODE
