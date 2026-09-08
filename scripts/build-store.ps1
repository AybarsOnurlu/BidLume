$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$submissionRoot = Join-Path $projectRoot 'Store_Submission'
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json
$version = $manifest.version
$buildDir = Join-Path $submissionRoot "bidlume-production-build-v$version"
$zipPath = Join-Path $submissionRoot "bidlume-production-build-v$version.zip"

if (-not $buildDir.StartsWith($submissionRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build directory resolved outside Store_Submission.'
}
if (-not $zipPath.StartsWith($submissionRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'ZIP path resolved outside Store_Submission.'
}

& node (Join-Path $PSScriptRoot 'validate-extension.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Source validation failed.' }

if (Test-Path -LiteralPath $buildDir) { Remove-Item -LiteralPath $buildDir -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path $buildDir | Out-Null

$include = @('analysis', 'content', 'icons', 'lib', 'popup', 'utils', 'manifest.json', 'sw.js')
foreach ($item in $include) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $buildDir -Recurse -Force
}

Compress-Archive -Path (Join-Path $buildDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  if ($entries -notcontains 'manifest.json') { throw 'ZIP root does not contain manifest.json.' }
  if ($entries | Where-Object { $_ -match '^(options|tests|Store_Submission|cloudflare-worker)/' }) {
    throw 'ZIP contains development-only files.'
  }
} finally {
  $archive.Dispose()
}

Write-Output "Store package created: $zipPath"
