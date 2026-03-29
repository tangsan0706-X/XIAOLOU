@echo off
setlocal
cd /d D:\xuan\xiaolou_frontend
start "" /min cmd /c "npm run dev > vite-dev.log 2> vite-dev.err.log"
