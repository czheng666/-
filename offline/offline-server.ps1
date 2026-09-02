$ErrorActionPreference = "Stop"

$webRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\docs"))
if (-not (Test-Path -LiteralPath $webRoot -PathType Container)) {
  Write-Host "Web folder not found: $webRoot" -ForegroundColor Red
  exit 1
}

$listener = $null
$port = $null
for ($candidate = 8766; $candidate -le 8775; $candidate += 1) {
  $candidateListener = New-Object System.Net.HttpListener
  try {
    $candidatePrefix = "http://127.0.0.1:$candidate/"
    $candidateListener.Prefixes.Add($candidatePrefix)
    $candidateListener.Start()
    $listener = $candidateListener
    $port = $candidate
    break
  } catch {
    try { $candidateListener.Close() } catch {}
    if ($candidate -eq 8775) {
      Write-Host "Could not start local web server: ports 8766-8775 are unavailable." -ForegroundColor Red
      Write-Host $_.Exception.Message -ForegroundColor DarkRed
      exit 1
    }
  }
}

$baseUrl = "http://127.0.0.1:$port/"
$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".htm" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".mjs" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".wasm" = "application/wasm"
  ".tar" = "application/octet-stream"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".ico" = "image/x-icon"
}

function Get-MimeType([string]$path) {
  $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($mimeTypes.ContainsKey($extension)) { return $mimeTypes[$extension] }
  return "application/octet-stream"
}

function Send-ErrorResponse($response, [int]$statusCode, [string]$message) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($message)
  $response.StatusCode = $statusCode
  $response.ContentType = "text/plain; charset=utf-8"
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

Write-Host "Clinical Capture offline version is running." -ForegroundColor Green
Write-Host "Local address: $baseUrl" -ForegroundColor Cyan
Write-Host "Close this window to stop. Patient data stays in this browser." -ForegroundColor Yellow
Start-Process $baseUrl

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $response = $context.Response
      if ($request.HttpMethod -notin @("GET", "HEAD")) {
        Send-ErrorResponse $response 405 "Method Not Allowed"
        continue
      }

      $relativePath = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart("/")
      if ([String]::IsNullOrWhiteSpace($relativePath)) { $relativePath = "index.html" }
      $relativePath = $relativePath.Replace("/", "\")
      if (($relativePath -split '\\') -contains '..') {
        Send-ErrorResponse $response 403 "Forbidden"
        continue
      }

      $filePath = [IO.Path]::GetFullPath((Join-Path $webRoot $relativePath))
      $rootPrefix = $webRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Send-ErrorResponse $response 403 "Forbidden"
        continue
      }
      if (Test-Path -LiteralPath $filePath -PathType Container) { $filePath = Join-Path $filePath "index.html" }
      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        Send-ErrorResponse $response 404 "Not Found"
        continue
      }

      $bytes = [IO.File]::ReadAllBytes($filePath)
      $response.StatusCode = 200
      $response.ContentType = Get-MimeType $filePath
      $response.ContentLength64 = $bytes.Length
      $response.Headers.Add("Cache-Control", "no-store")
      if ($request.HttpMethod -ne "HEAD") { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch {
      try { Send-ErrorResponse $context.Response 500 "Internal Server Error" } catch {}
    } finally {
      try { $context.Response.OutputStream.Close() } catch {}
      try { $context.Response.Close() } catch {}
    }
  }
} finally {
  try { $listener.Stop() } catch {}
  try { $listener.Close() } catch {}
}
