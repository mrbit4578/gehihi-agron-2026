@echo off
chcp 65001 >nul
title Gehihi Argon 2026 - Launcher
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Da co loi xay ra khi chay chuong trinh.
    pause
)
