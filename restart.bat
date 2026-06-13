@echo off
echo Stopping existing node process...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
echo Starting JARVIS server...
cd /d d:\nexus-app
node server.js
