@echo off
rem Cairn CLI launcher (Windows). Always runs via node - never open the .js directly.
rem Usage: cairn.cmd <command> [args]  ==  node dist\src\interfaces\cli\main.js <command>
setlocal
set "SCRIPT_DIR=%~dp0"
if not exist "%SCRIPT_DIR%dist\src\interfaces\cli\main.js" (
  echo [cairn] dist not found. Run: npm run build 1>&2
  exit /b 1
)
node "%SCRIPT_DIR%dist\src\interfaces\cli\main.js" %*
endlocal
