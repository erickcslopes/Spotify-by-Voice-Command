@echo off
setlocal
cd /d "%~dp0"

set "EXE=src-tauri\target\release\spotify-voice-assistant.exe"

if exist "%EXE%" (
    start "" "%EXE%"
    exit /b 0
)

echo Executavel nao encontrado. Gerando build release (primeira vez demora)...
call npm run tauri build
if errorlevel 1 (
    echo.
    echo Falha no build. Verifique o toolchain Rust e o Node: https://tauri.app
    pause
    exit /b 1
)

start "" "%EXE%"
exit /b 0