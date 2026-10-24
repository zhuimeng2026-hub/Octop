@echo off
setlocal
rem Octop bootstrapper entry point. Double-click to open the GUI and download
rem the base environment + application step by step.
rem Extra switches are forwarded: -Mirror -WithBrowser -NoLaunch -NoGui -Plan
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Octop-Bootstrap.ps1" %*
endlocal
