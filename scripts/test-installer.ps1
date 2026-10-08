param([string]$Version = '')
$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = (Get-Content -Raw -LiteralPath (Join-Path $taskProjectRoot 'package.json') | ConvertFrom-Json).version }
$env:TEMP = 'D:\CodexData\Temp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:ELECTRON_RUN_AS_NODE = $null
$taskNsis = 'D:\CodexData\Cache\electron-builder\nsis-3.0.4.1\Bin\makensis.exe'
$taskQaRoot = Join-Path $env:TEMP ('TierFlow-Installer-' + $Version + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
if (-not ([IO.Path]::GetFullPath($taskQaRoot)).StartsWith('D:\CodexData\Temp\TierFlow-Installer-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe QA directory' }
if (Test-Path 'HKCU:\Software\TierFlow\InstallerQA') { throw 'An earlier QA install still exists; preserve it for inspection before running this test.' }
New-Item -ItemType Directory -Path $taskQaRoot | Out-Null
$taskQaInstaller = Join-Path $taskQaRoot 'TierFlow-QA-Setup.exe'
$taskAppDir = Join-Path $taskQaRoot '用户自选 Apps\TierFlow Client'
$taskWrapper = Join-Path $taskQaRoot 'installer-qa.nsi'
$taskSource = @'
Unicode true
SetCompressor zlib
OutFile "@OUTPUT@"
!define PROJECT_DIR "@PROJECT@"
!define VERSION "@VERSION@"
!define TIERFLOW_QA_ROOT "@ROOT@"
!include "@PROJECT@\build\installer.nsi"
'@
$taskSource = $taskSource.Replace('@OUTPUT@', $taskQaInstaller).Replace('@PROJECT@', $taskProjectRoot).Replace('@VERSION@', $Version).Replace('@ROOT@', $taskQaRoot)
Set-Content -LiteralPath $taskWrapper -Value $taskSource -Encoding utf8
Write-Output "Installer QA, all files and shortcut targets under: $taskQaRoot"
& $taskNsis /V2 /INPUTCHARSET UTF8 $taskWrapper
if ($LASTEXITCODE -ne 0) { throw "NSIS QA compilation failed: $LASTEXITCODE" }
function Assert-Installer([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; Write-Output "PASS: $Message" }
foreach ($taskProbe in @(
  @{Path='C:\Users\测试 用户\AppData\Local\Programs\TierFlow'; Code=0},
  @{Path='E:\My Apps\Router 客户端'; Code=0},
  @{Path='\\server\share\TierFlow'; Code=0},
  @{Path='C:\'; Code=1},
  @{Path='E:\'; Code=1},
  @{Path=$env:WINDIR; Code=1}
)) {
  $taskProcess = Start-Process -FilePath $taskQaInstaller -ArgumentList "/S /CHECKDIR=$($taskProbe.Path)" -WindowStyle Hidden -PassThru -Wait
  Assert-Installer ($taskProcess.ExitCode -eq $taskProbe.Code) "Read-only installation path validation: $($taskProbe.Path) (expected $($taskProbe.Code), received $($taskProcess.ExitCode))"
}
function Invoke-QaInstall([string]$Options) {
  $taskProcess = Start-Process -FilePath $taskQaInstaller -ArgumentList "/S $Options /D=$taskAppDir" -WindowStyle Hidden -PassThru -Wait
  if ($taskProcess.ExitCode -ne 0) { throw "Installer failed: $($taskProcess.ExitCode)" }
}
$taskDesktopLink = Join-Path $taskQaRoot 'Desktop\TierFlow.lnk'
$taskMenuLink = Join-Path $taskQaRoot 'Programs\TierFlow\TierFlow.lnk'
$taskUninstallLink = Join-Path $taskQaRoot 'Programs\TierFlow\卸载 TierFlow.lnk'
$taskShell = New-Object -ComObject WScript.Shell
Invoke-QaInstall '/DESKTOP=1 /STARTMENU=1'
Assert-Installer (Test-Path -LiteralPath $taskDesktopLink) 'Selected desktop shortcut is created'
Assert-Installer (Test-Path -LiteralPath $taskMenuLink) 'Selected Start menu shortcut is created'
Assert-Installer (Test-Path -LiteralPath $taskUninstallLink) 'Start menu uninstall entry is created'
foreach ($taskLinkPath in @($taskDesktopLink, $taskMenuLink)) {
  $taskLink = $taskShell.CreateShortcut($taskLinkPath)
  Assert-Installer ($taskLink.TargetPath -eq (Join-Path $taskAppDir 'TierFlow.exe')) 'Shortcut points to the installed executable'
  Assert-Installer ($taskLink.WorkingDirectory -eq $taskAppDir) 'Shortcut uses the installation working directory'
  Assert-Installer ($taskLink.IconLocation -like '*TierFlow.exe*') 'Shortcut uses the TierFlow application icon'
}
# Confirm upgraded/uninstalled applications do not remove unrelated user-created files.
$taskKeepMenu = Join-Path $taskQaRoot 'Programs\TierFlow\keep-user-file.txt'
$taskKeepApp = Join-Path $taskAppDir 'keep-user-file.txt'
Set-Content -LiteralPath $taskKeepMenu -Value 'keep'
Set-Content -LiteralPath $taskKeepApp -Value 'keep'
Invoke-QaInstall '/DESKTOP=0 /STARTMENU=0'
Assert-Installer (-not (Test-Path -LiteralPath $taskDesktopLink)) 'Deselecting desktop removes its previously created shortcut'
Assert-Installer (-not (Test-Path -LiteralPath $taskMenuLink)) 'Deselecting Start menu removes its previously created shortcut'
Assert-Installer (Test-Path -LiteralPath $taskKeepMenu) 'Unrelated Start menu file is preserved'
Invoke-QaInstall ''
Assert-Installer (-not (Test-Path -LiteralPath $taskDesktopLink) -and -not (Test-Path -LiteralPath $taskMenuLink)) 'Upgrade remembers both disabled shortcut preferences'
Invoke-QaInstall '/DESKTOP=1 /STARTMENU=0'
Assert-Installer ((Test-Path -LiteralPath $taskDesktopLink) -and -not (Test-Path -LiteralPath $taskMenuLink)) 'Desktop and Start menu choices are independent'
$env:TIERFLOW_DATA_DIR = Join-Path $taskQaRoot 'profile'
$taskSmoke = Start-Process -FilePath (Join-Path $taskAppDir 'TierFlow.exe') -ArgumentList '--smoke-test' -WorkingDirectory $taskQaRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $taskQaRoot 'startup.log') -RedirectStandardError (Join-Path $taskQaRoot 'startup-error.log')
Assert-Installer ($taskSmoke.ExitCode -eq 0 -and (Get-Content -Raw (Join-Path $taskQaRoot 'startup.log')) -match 'TIERFLOW_SMOKE_OK') 'Installed application starts with system key encryption'
$taskConfigHash = (Get-FileHash -LiteralPath (Join-Path $env:TIERFLOW_DATA_DIR 'config.json')).Hash
$taskUninstall = Start-Process -FilePath (Join-Path $taskAppDir 'Uninstall TierFlow.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
Assert-Installer ($taskUninstall.ExitCode -eq 0) 'Uninstaller exits successfully'
Assert-Installer (-not (Test-Path -LiteralPath (Join-Path $taskAppDir 'TierFlow.exe'))) 'Installed executable is removed'
Assert-Installer (-not (Test-Path -LiteralPath $taskDesktopLink)) 'Owned desktop shortcut is removed by uninstall'
Assert-Installer ((Test-Path -LiteralPath $taskKeepApp) -and (Test-Path -LiteralPath $taskKeepMenu)) 'Uninstall preserves unrelated files'
Assert-Installer ((Get-FileHash -LiteralPath (Join-Path $env:TIERFLOW_DATA_DIR 'config.json')).Hash -eq $taskConfigHash) 'Configuration and encrypted keys remain unchanged'
Assert-Installer (-not (Test-Path 'HKCU:\Software\TierFlow\InstallerQA')) 'Test registration is removed'
$taskReport = [pscustomobject]@{version=$Version; result='passed'; qaDirectory=$taskQaRoot; finishedAt=(Get-Date -Format o)}
$taskReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskProjectRoot ".runtime\installer-$Version-qa.json") -Encoding utf8
Write-Output 'INSTALLER_QA_OK'
