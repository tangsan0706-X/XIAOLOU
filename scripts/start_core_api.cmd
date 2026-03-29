@echo off
setlocal
cd /d D:\xuan\??WEB\core-api
start "" /min cmd /c "node src/server.js > core-api.log 2> core-api.err.log"
