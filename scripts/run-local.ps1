$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$goCommand = Get-Command go -ErrorAction SilentlyContinue
if ($goCommand) {
  $goPath = $goCommand.Source
} else {
  $goPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '..\tools\go\bin\go.exe'))
  if (-not (Test-Path -LiteralPath $goPath)) { throw 'Install Go 1.27.2+ from go.dev/dl or add Go to PATH.' }
}
& $goPath run ./cmd/server
