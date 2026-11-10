$ErrorActionPreference = 'Stop'

foreach ($tool in @('supabase', 'docker')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Required tool '$tool' was not found on PATH. Install it, restart PowerShell, and try again."
    }
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker is not running. Start Docker Desktop and run this script again.'
}

$secureConnectionString = Read-Host 'Paste the staging/production PostgreSQL connection string (input hidden)' -AsSecureString
$connectionString = $null
$bstr = [IntPtr]::Zero
try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConnectionString)
    $connectionString = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if ($connectionString -notmatch '^postgres(ql)?://') {
    $connectionString = $null
    throw 'The supplied value does not look like a PostgreSQL connection string. No dump was started.'
}

$root = Join-Path $env:USERPROFILE 'Shibra-Campus-Backups'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $root $stamp
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

$dumps = @(
    @{ Name = 'roles.sql'; Args = @('--role-only') },
    @{ Name = 'schema.sql'; Args = @() },
    @{ Name = 'data.sql'; Args = @('--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes') }
)
$manifest = [System.Collections.Generic.List[string]]::new()
$manifest.Add("Created (local time): $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')")
$manifest.Add('Dump type: Supabase CLI logical database dump')
$manifest.Add('Connection string/password: not recorded')

try {
    foreach ($dump in $dumps) {
        $outputFile = Join-Path $backupDirectory $dump.Name
        Write-Host "Creating $($dump.Name)..."
        $arguments = @('db', 'dump', '--db-url', $connectionString, '-f', $outputFile) + $dump.Args
        & supabase @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Supabase CLI failed while creating $($dump.Name) (exit code $LASTEXITCODE)."
        }
        if (-not (Test-Path -LiteralPath $outputFile) -or (Get-Item -LiteralPath $outputFile).Length -le 0) {
            throw "The dump file '$($dump.Name)' is missing or empty."
        }

        $file = Get-Item -LiteralPath $outputFile
        $hash = Get-FileHash -LiteralPath $outputFile -Algorithm SHA256
        $manifest.Add("$($file.Name) | $($file.Length) bytes | SHA256 $($hash.Hash)")
    }

    $manifestPath = Join-Path $backupDirectory 'backup-manifest.txt'
    Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
    Write-Host ''
    Write-Host 'Backup dump files completed. This is not a verified restore.'
    Write-Host "Backup folder: $backupDirectory"
    Write-Host 'Protect this folder: it contains sensitive school data.'
}
finally {
    $connectionString = $null
    $secureConnectionString.Dispose()
}
