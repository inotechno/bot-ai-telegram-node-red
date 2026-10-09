<#
.SYNOPSIS
    Backup database PostgreSQL AI Integrator lewat container Docker.

.DESCRIPTION
    Menjalankan pg_dump di dalam container ai-integrator-postgres, lalu menyimpan
    hasilnya ke folder backups/ dengan nama ai-integrator_<tanggal>.sql[.gz].
    File lama dibuang otomatis sesuai -Keep.

    User & database dibaca dari environment, lalu dari file .env di root proyek.

.EXAMPLE
    .\scripts\backup-db.ps1
    .\scripts\backup-db.ps1 -Gzip -Keep 7
    .\scripts\backup-db.ps1 -OutDir D:\backup-ai

.RESTORE (contoh)
    # dari dump polos
    docker exec -i ai-integrator-postgres psql -U ai_integrator -d ai_integrator < backups\ai-integrator_20261009-030000.sql
    # dari dump .gz (PowerShell)
    Get-Content backups\ai-integrator_20261009-030000.sql.gz -Raw | & "C:\Program Files\Git\usr\bin\gunzip.exe"
    # atau dari dalam container
    docker exec -i ai-integrator-postgres sh -c 'gunzip -c /tmp/x.sql.gz' < backups\x.sql.gz   # (salin dulu dgn docker cp)
#>
[CmdletBinding()]
param(
    [string]$Container = 'ai-integrator-postgres',
    # $PSScriptRoot tidak terisi di default parameter saat [CmdletBinding()] dipakai,
    # jadi OutDir kosong -> diisi di bawah menjadi <proyek>\backups
    [string]$OutDir,
    [string]$User,
    [string]$Database,
    [ValidateRange(1, 3650)]
    [int]$Keep = 14,
    [switch]$Gzip,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot '..\backups' }

function Get-DotEnvValue {
    param([string]$Key, [string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $name, $value = $line.Split('=', 2)
        if ($name.Trim() -eq $Key) { return $value.Trim().Trim('"').Trim("'") }
    }
    return $null
}

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'

if (-not $User)     { $User = $env:PGUSER;     if (-not $User)     { $User = Get-DotEnvValue 'PGUSER' $envFile } }
if (-not $Database) { $Database = $env:PGDATABASE; if (-not $Database) { $Database = Get-DotEnvValue 'PGDATABASE' $envFile } }
if (-not $User)     { $User = 'ai_integrator' }
if (-not $Database) { $Database = 'ai_integrator' }

$running = docker ps --filter "name=$Container" --format '{{.Names}}'
if ($running -notcontains $Container) {
    throw "Container '$Container' tidak berjalan. Jalankan dulu: docker compose up -d"
}

$flags = '--no-owner --no-privileges'
if ($Clean) { $flags = "$flags --clean --if-exists" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteSql = '/tmp/ai-backup.sql'
$name = "ai-integrator_$stamp.sql"

Write-Host "Dump $User/$Database dari container $Container ..." -ForegroundColor Cyan

docker exec $Container sh -c "pg_dump -U '$User' -d '$Database' $flags -f $remoteSql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump gagal (exit code $LASTEXITCODE)" }

$remote = $remoteSql
if ($Gzip) {
    docker exec $Container sh -c "gzip -f $remoteSql"
    if ($LASTEXITCODE -ne 0) { throw "gzip gagal (exit code $LASTEXITCODE)" }
    $remote = "$remoteSql.gz"
    $name = "$name.gz"
}

if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$target = Join-Path (Resolve-Path -LiteralPath $OutDir) $name

docker cp "${Container}:${remote}" $target
if ($LASTEXITCODE -ne 0) { throw "docker cp gagal (exit code $LASTEXITCODE)" }
docker exec $Container sh -c "rm -f $remoteSql $remoteSql.gz" | Out-Null

$file = Get-Item -LiteralPath $target
if ($file.Length -lt 200) {
    Remove-Item -LiteralPath $target -Force
    throw "Dump terlalu kecil ($($file.Length) byte) - dibuang, kemungkinan pg_dump tidak berhasil."
}

$removed = 0
Get-ChildItem -LiteralPath $OutDir -Filter 'ai-integrator_*.sql*' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; $removed++ }

$sizeMB = [math]::Round($file.Length / 1MB, 2)
$tables = docker exec $Container psql -U $User -d $Database -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
$latest = docker exec $Container psql -U $User -d $Database -t -A -c "SELECT relname||'='||n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC"

Write-Host ""
Write-Host "Backup tersimpan : $target" -ForegroundColor Green
Write-Host "Ukuran           : $sizeMB MB"
Write-Host "Tabel publik     : $($tables.Trim())"
Write-Host "File cadangan    : $Keep disimpan, $removed dihapus"
Write-Host ""
Write-Host "Isi tabel saat ini:"
$latest -split "`n" | Where-Object { $_ } | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Restore (ke db yang sama):" -ForegroundColor Yellow
if ($Gzip) {
    Write-Host "  docker cp `"$target`" ai-integrator-postgres:/tmp/restore.sql.gz"
    Write-Host "  docker exec ai-integrator-postgres sh -c `"gunzip -c /tmp/restore.sql.gz | psql -U $User -d $Database`""
} else {
    Write-Host "  docker exec -i ai-integrator-postgres psql -U $User -d $Database < `"$target`""
}
