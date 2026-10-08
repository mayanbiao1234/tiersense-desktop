; Distribution defaults follow the current user's Windows folders.
; Developer build and QA storage overrides are defined outside this installer.
!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh

Name "TierFlow"
InstallDir "$LOCALAPPDATA\Programs\TierFlow"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show
; Compile-time test isolation: never writes to the real Desktop / Start menu or app registry.
!ifdef TIERFLOW_QA_ROOT
  !define INSTALL_KEY "Software\TierFlow\InstallerQA"
  !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TierFlowInstallerQA"
!else
  !define INSTALL_KEY "Software\TierFlow\Desktop"
  !define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TierFlowDesktop"
!endif
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallLocation"
Var DesktopSelected
Var StartMenuSelected
Var DesktopCheckbox
Var StartMenuCheckbox
Var ShortcutsDialog
Var DesktopDirectory
Var ProgramsDirectory
Var LegacyShortcut
Var CommandLineOptions

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 TierFlow"
!define MUI_WELCOMEPAGE_TEXT "TierSense 步骤级智能路由客户端。$\r$\n$\r$\n默认安装到当前用户的程序目录，也可以选择其他可写文件夹。无需预先安装 Node.js 或 Python。$\r$\n$\r$\n升级前请从右下角托盘菜单选择“退出 TierFlow”。$\r$\n配置与加密密钥保存在用户数据目录，旧版配置继续沿用；卸载时保留。实际路径可在客户端设置中查看。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ShortcutsPageCreate ShortcutsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "TierFlow 已安装。$\r$\n$\r$\n安装位置：$INSTDIR$\r$\n$\r$\n可以从已选择的桌面或开始菜单快捷方式打开，也可运行安装目录中的 TierFlow.exe。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\TierFlow.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 TierFlow"
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "打开安装文件夹"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenInstallFolder
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "卸载前请从右下角托盘菜单选择“退出 TierFlow”，避免程序文件被占用。配置与加密密钥将保留。"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
  !ifdef TIERFLOW_QA_ROOT
    ; Read-only validation hook: exercise C:/E:/UNC paths without writing there.
    ${GetParameters} $CommandLineOptions
    ClearErrors
    ${GetOptions} $CommandLineOptions "/CHECKDIR=" $0
    ${IfNot} ${Errors}
      StrCpy $INSTDIR $0
      Call ValidateInstallDirectory
      Pop $0
      SetErrorLevel $0
      Quit
    ${EndIf}
  !endif
  Call InitShortcutDirectories
  StrCpy $DesktopSelected ${BST_CHECKED}
  StrCpy $StartMenuSelected ${BST_CHECKED}
  ; Preserve choices on an upgrade. First installs offer both familiar launch points.
  ClearErrors
  ReadRegDWORD $0 HKCU "${INSTALL_KEY}" "DesktopShortcut"
  ${IfNot} ${Errors}
    StrCpy $DesktopSelected $0
  ${EndIf}
  ClearErrors
  ReadRegDWORD $0 HKCU "${INSTALL_KEY}" "StartMenuShortcut"
  ${IfNot} ${Errors}
    StrCpy $StartMenuSelected $0
  ${EndIf}
  ; Explicit switches also make unattended deployments predictable.
  ${GetParameters} $CommandLineOptions
  ClearErrors
  ${GetOptions} $CommandLineOptions "/DESKTOP=" $0
  ${IfNot} ${Errors}
    ${If} $0 == "0"
      StrCpy $DesktopSelected ${BST_UNCHECKED}
    ${ElseIf} $0 == "1"
      StrCpy $DesktopSelected ${BST_CHECKED}
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $CommandLineOptions "/STARTMENU=" $0
  ${IfNot} ${Errors}
    ${If} $0 == "0"
      StrCpy $StartMenuSelected ${BST_UNCHECKED}
    ${ElseIf} $0 == "1"
      StrCpy $StartMenuSelected ${BST_CHECKED}
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro ShortcutDirectories Prefix
Function ${Prefix}InitShortcutDirectories
  !ifdef TIERFLOW_QA_ROOT
    StrCpy $DesktopDirectory "${TIERFLOW_QA_ROOT}\Desktop"
    StrCpy $ProgramsDirectory "${TIERFLOW_QA_ROOT}\Programs"
    StrCpy $LegacyShortcut "${TIERFLOW_QA_ROOT}\TierFlow.lnk"
  !else
    StrCpy $DesktopDirectory "$DESKTOP"
    StrCpy $ProgramsDirectory "$SMPROGRAMS"
    StrCpy $LegacyShortcut "D:\CodexData\Apps\TierFlow.lnk"
  !endif
FunctionEnd
!macroend
!insertmacro ShortcutDirectories ""
!insertmacro ShortcutDirectories "un."

Function ShortcutsPageCreate
  !insertmacro MUI_HEADER_TEXT "选择启动入口" "选择安装后在哪里找到 TierFlow。"
  nsDialogs::Create 1018
  Pop $ShortcutsDialog
  ${If} $ShortcutsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 26u "建议保留至少一个快捷方式。程序文件仍安装在刚才选择的目录。"
  Pop $0
  ${NSD_CreateCheckbox} 0 37u 100% 16u "在桌面创建 TierFlow 快捷方式"
  Pop $DesktopCheckbox
  ${NSD_SetState} $DesktopCheckbox $DesktopSelected
  ${NSD_CreateCheckbox} 0 66u 100% 16u "在开始菜单创建 TierFlow 快捷方式"
  Pop $StartMenuCheckbox
  ${NSD_SetState} $StartMenuCheckbox $StartMenuSelected
  ${NSD_CreateLabel} 0 102u 100% 35u "开始菜单中可搜索 TierFlow 打开应用。安装完成后，也可以选择立即启动或打开安装文件夹。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ShortcutsPageLeave
  ${NSD_GetState} $DesktopCheckbox $DesktopSelected
  ${NSD_GetState} $StartMenuCheckbox $StartMenuSelected
  ${If} $DesktopSelected == ${BST_UNCHECKED}
  ${AndIf} $StartMenuSelected == ${BST_UNCHECKED}
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "你没有选择创建快捷方式。以后请从以下位置启动：$\r$\n$INSTDIR\TierFlow.exe$\r$\n$\r$\n继续安装？" IDOK +2
    Abort
  ${EndIf}
FunctionEnd

Function OpenInstallFolder
  ExecShell "open" "$INSTDIR"
FunctionEnd

Function .onVerifyInstDir
  Call ValidateInstallDirectory
  Pop $0
  ${If} $0 != 0
    Abort
  ${EndIf}
FunctionEnd

Function ValidateInstallDirectory
  ; Accept any user-selected application folder, never a volume root or a
  ; shared system/profile directory. The uninstaller removes only its manifest.
  ; NSIS GetFullPathName resolves existing long names and fails for new folders.
  ; Win32 normalization also accepts a not-yet-created installation directory.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i .r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    Push 1
    Return
  ${EndIf}
  ${GetRoot} "$0" $1
  ${If} $0 == $1
  ${OrIf} $0 == "$1\"
  ${OrIf} $0 == $WINDIR
  ${OrIf} $0 == $SYSDIR
  ${OrIf} $0 == $PROFILE
  ${OrIf} $0 == $LOCALAPPDATA
  ${OrIf} $0 == $APPDATA
  ${OrIf} $0 == $PROGRAMFILES
  ${OrIf} $0 == $PROGRAMFILES64
    Push 1
  ${Else}
    Push 0
  ${EndIf}
FunctionEnd

Section "TierFlow" InstallSection
  ; Silent /D installs must pass the same validation as the directory page.
  Call ValidateInstallDirectory
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 1
    Abort "请选择独立的应用安装文件夹。"
  ${EndIf}
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${PROJECT_DIR}\release\${VERSION}\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall TierFlow.exe"
  FileOpen $0 "$INSTDIR\.tierflow-install" w
  FileWrite $0 "TierFlow Desktop ${VERSION}"
  FileClose $0
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "TierFlow"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "清枢智汇"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\TierFlow.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall TierFlow.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ; Only remove shortcuts previously recorded by this installation when deselected.
  ${If} $DesktopSelected == ${BST_CHECKED}
    CreateDirectory "$DesktopDirectory"
    ClearErrors
    CreateShortCut "$DesktopDirectory\TierFlow.lnk" "$INSTDIR\TierFlow.exe" "" "$INSTDIR\TierFlow.exe" 0
    ${If} ${Errors}
      StrCpy $DesktopSelected ${BST_UNCHECKED}
      DetailPrint "未能创建桌面快捷方式，可从 $INSTDIR\TierFlow.exe 启动。"
    ${EndIf}
  ${Else}
    ReadINIStr $0 "$INSTDIR\install-options.ini" "Shortcuts" "Desktop"
    ${If} $0 == "1"
      Delete "$DesktopDirectory\TierFlow.lnk"
    ${EndIf}
  ${EndIf}
  ${If} $StartMenuSelected == ${BST_CHECKED}
    CreateDirectory "$ProgramsDirectory\TierFlow"
    ClearErrors
    CreateShortCut "$ProgramsDirectory\TierFlow\TierFlow.lnk" "$INSTDIR\TierFlow.exe" "" "$INSTDIR\TierFlow.exe" 0
    ${If} ${Errors}
      StrCpy $StartMenuSelected ${BST_UNCHECKED}
      DetailPrint "未能创建开始菜单入口，可从 $INSTDIR\TierFlow.exe 启动。"
    ${Else}
      CreateShortCut "$ProgramsDirectory\TierFlow\卸载 TierFlow.lnk" "$INSTDIR\Uninstall TierFlow.exe"
    ${EndIf}
  ${Else}
    ReadINIStr $0 "$INSTDIR\install-options.ini" "Shortcuts" "StartMenu"
    ${If} $0 == "1"
      Delete "$ProgramsDirectory\TierFlow\TierFlow.lnk"
      Delete "$ProgramsDirectory\TierFlow\卸载 TierFlow.lnk"
      RMDir "$ProgramsDirectory\TierFlow"
    ${EndIf}
  ${EndIf}
  WriteINIStr "$INSTDIR\install-options.ini" "Shortcuts" "Desktop" $DesktopSelected
  WriteINIStr "$INSTDIR\install-options.ini" "Shortcuts" "StartMenu" $StartMenuSelected
  WriteRegDWORD HKCU "${INSTALL_KEY}" "DesktopShortcut" $DesktopSelected
  WriteRegDWORD HKCU "${INSTALL_KEY}" "StartMenuShortcut" $StartMenuSelected
SectionEnd

Function un.onInit
  SetShellVarContext current
  Call un.InitShortcutDirectories
  IfFileExists "$INSTDIR\.tierflow-install" +3 0
    MessageBox MB_ICONSTOP "找不到 TierFlow 安装标记，已停止卸载。"
    Abort
FunctionEnd

Section "Uninstall"
  ; A newer installation may own these shared launch points. Leave those intact.
  ReadRegStr $0 HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    ReadINIStr $1 "$INSTDIR\install-options.ini" "Shortcuts" "Desktop"
    ${If} $1 == "1"
      Delete "$DesktopDirectory\TierFlow.lnk"
    ${EndIf}
    ReadINIStr $1 "$INSTDIR\install-options.ini" "Shortcuts" "StartMenu"
    ${If} $1 == "1"
      Delete "$ProgramsDirectory\TierFlow\TierFlow.lnk"
      Delete "$ProgramsDirectory\TierFlow\卸载 TierFlow.lnk"
      RMDir "$ProgramsDirectory\TierFlow"
    ${EndIf}
    Delete "$LegacyShortcut"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "${INSTALL_KEY}"
  ${EndIf}
  ; This manifest lists only build-owned files, never user configuration.
  !include "${PROJECT_DIR}\release\${VERSION}\uninstall-files.nsh"
  Delete "$INSTDIR\.tierflow-install"
  Delete "$INSTDIR\install-options.ini"
  Delete "$INSTDIR\Uninstall TierFlow.exe"
  RMDir "$INSTDIR"
SectionEnd
