@echo off
rem Octop Wails desktop shell - dev mode.
rem The dashboard URL comes from the OCTOP_DESKTOP_URL user environment
rem variable (set once via: setx OCTOP_DESKTOP_URL https://ocbot.aixifs.com/videogen).
rem Do NOT hardcode it here, or this script would override the system value.
rem Requires: Go toolchain + wails3 in GOPATH bin.
rem Double-click to launch; close the console window or the tray icon to quit.

cd /d C:\Octop\desktop\src
set PATH=%USERPROFILE%\go\bin;%PATH%
wails3 dev
