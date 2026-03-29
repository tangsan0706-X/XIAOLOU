@echo off
setlocal
cd /d D:\xuan\??WEB\XIAOLOU-main
start "" /min cmd /c "npm run preview -- --host 0.0.0.0 --port 3000 > vite-preview.log 2> vite-preview.err.log"
