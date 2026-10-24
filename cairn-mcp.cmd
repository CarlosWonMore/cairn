@echo off
rem Cairn MCP stdio server launcher (Windows), for agent configs.
rem Usage: cairn-mcp.cmd [--home <dir>]
setlocal
set "SCRIPT_DIR=%~dp0"
if not exist "%SCRIPT_DIR%dist\src\interfaces\mcp\server.js" (
  echo [cairn-mcp] dist not found. Run: npm run build 1>&2
  exit /b 1
)
node "%SCRIPT_DIR%dist\src\interfaces\mcp\server.js" %*
endlocal
