param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath node_modules)) { npm run install:ci; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
npm run build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run db:migrate
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npm run dev -- --port $Port
