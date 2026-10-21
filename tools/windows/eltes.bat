@echo off
rem ===========================================================================
rem  Eltes AI - portable Windows launcher
rem  Serves this folder on 127.0.0.1 and opens the workspace in your browser.
rem  No installer, no registry writes, no service, no admin rights.
rem
rem  Usage:
rem    eltes.bat                start on port 4173 and open the browser
rem    eltes.bat --port 8080    use another port
rem    eltes.bat --shortcut     also add a Start-menu shortcut
rem    eltes.bat --no-browser   start the server only
rem    eltes.bat --shell        risky: enable the supervised local command runner
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title Eltes AI
cd /d "%~dp0"

set "PORT=4173"
set "OPENBROWSER=1"
set "SHORTCUT=0"
set "ENABLESHELL=0"

:parse
if "%~1"=="" goto run
if /I "%~1"=="--port" (
  set "PORT=%~2"
  if "!PORT!"=="" (
    echo [Eltes] --port needs a number, for example: eltes.bat --port 8080
    goto fail
  )
  shift
  shift
  goto parse
)
if /I "%~1"=="--shortcut" (
  set "SHORTCUT=1"
  shift
  goto parse
)
if /I "%~1"=="--no-browser" (
  set "OPENBROWSER=0"
  shift
  goto parse
)
if /I "%~1"=="--shell" (
  set "ENABLESHELL=1"
  shift
  goto parse
)
if /I "%~1"=="--help" goto help
if /I "%~1"=="-h" goto help
echo [Eltes] Unknown option: %~1
goto help

:help
echo.
echo   Eltes AI launcher
echo.
echo   eltes.bat                 start on port 4173 and open the browser
echo   eltes.bat --port 8080     use another port
echo   eltes.bat --shortcut      add a Start-menu shortcut
echo   eltes.bat --no-browser    start the server without opening a tab
echo   eltes.bat --shell         risky opt-in local command runner
echo.
goto end

:run
if not exist "%~dp0index.html" (
  echo [Eltes] index.html is missing next to this file.
  echo         Unzip the whole eltes-windows folder and run eltes.bat from inside it.
  goto fail
)

echo.
echo   Eltes AI
echo   ---------------------------------------------
echo   folder : %~dp0
echo   port   : %PORT%
echo   stop   : close this window or press Ctrl+C
echo.

set "PSEXTRA="
if "%SHORTCUT%"=="1" set "PSEXTRA=%PSEXTRA% -Shortcut"
if not "%OPENBROWSER%"=="1" set "PSEXTRA=%PSEXTRA% -NoBrowser"
if "%ENABLESHELL%"=="1" set "PSEXTRA=%PSEXTRA% -EnableShell"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Eltes.ps1" -Port %PORT% %PSEXTRA%
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto fail
goto end

:fail
echo.
echo [Eltes] The launcher stopped. Read the message above.
echo.
pause
exit /b 1

:end
endlocal
