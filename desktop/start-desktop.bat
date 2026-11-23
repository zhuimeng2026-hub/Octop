@echo off
rem Octop Wails desktop shell - developer mode.
rem The dashboard URL comes from the OCTOP_DESKTOP_URL user environment
rem variable (set once via: setx OCTOP_DESKTOP_URL https://ocbot.aixifs.com/videogen).
rem Do NOT hardcode it here, or this script would override the system value.
rem OCTOP_DESKTOP_DEV=1 puts the shell into developer mode: no local Python
rem runtime, developer tools on (Ctrl+Shift+D), navigation log on the console.
rem For the local-dashboard hot reload variant, run desktop\package-dev-remote.ps1
rem (or desktop/package-dev-remote.sh) instead of this script.
rem Requires: Go toolchain + wails3 in GOPATH bin.
rem Double-click to launch; close the console window or the tray icon to quit.

cd /d C:\Octop\desktop\src
set PATH=%USERPROFILE%\go\bin;%PATH%
set OCTOP_DESKTOP_DEV=1
wails3 dev
