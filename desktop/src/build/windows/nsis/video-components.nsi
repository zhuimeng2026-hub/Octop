Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "dev"
!endif
!ifndef INSTALLER_OUTFILE
  !define INSTALLER_OUTFILE "..\..\..\bin\Octop-video-components-windows-x64-${VERSION}.exe"
!endif
!define COMPONENTS_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OctopVideoComponents"

Name "Octop 视频制作组件 ${VERSION}"
OutFile "${INSTALLER_OUTFILE}"
InstallDir "$LOCALAPPDATA\Octop\video-runtime"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUnInstDetails show
!define MUI_ICON "..\..\windows\icon.ico"
!define MUI_UNICON "..\..\windows\icon.ico"

!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\Octop\video-runtime"
  SetOutPath "$INSTDIR"
  File /r "..\..\..\video-runtime\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${COMPONENTS_UNINSTALL_KEY}" "DisplayName" "Octop 视频制作组件"
  WriteRegStr HKCU "${COMPONENTS_UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${COMPONENTS_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${COMPONENTS_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  CreateShortcut "$SMPROGRAMS\Octop 视频制作组件卸载.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Function .onInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Octop\video-runtime"
FunctionEnd

Function un.onInit
  StrCmp $INSTDIR "$LOCALAPPDATA\Octop\video-runtime" done
  MessageBox MB_OK|MB_ICONSTOP "卸载路径不匹配，已取消以保护其他文件。"
  Abort
  done:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Octop 视频制作组件卸载.lnk"
  DeleteRegKey HKCU "${COMPONENTS_UNINSTALL_KEY}"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\runtime.json"
  Delete "$INSTDIR\desktop-worker.mjs"
  Delete "$INSTDIR\render.mjs"
  Delete "$INSTDIR\project.mjs"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\NODE-LICENSE.txt"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR"
SectionEnd
