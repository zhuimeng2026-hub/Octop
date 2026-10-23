@echo off
setlocal
where node >nul 2>nul || (echo Node.js 22 or newer with npm is required. Install it from https://nodejs.org/ & exit /b 1)
cd /d "%~dp0renderer"
node launch.mjs --render --project "%~dp0." %*
if errorlevel 1 pause
