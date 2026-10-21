@echo off
rem Octop Wails desktop shell - dev mode (attaches to a running Octop server)
rem Requires: Go toolchain + wails3 in GOPATH bin, and Octop already serving.
rem Double-click to launch; close the console window or the tray icon to quit.

cd /d C:\Octop\desktop\src
set OCTOP_DESKTOP_URL=http://127.0.0.1:8088/videogen
set PATH=%USERPROFILE%\go\bin;%PATH%
wails3 dev
