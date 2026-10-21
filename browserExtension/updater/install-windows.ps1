# Installs the Orbit extension updater for the unpacked extension this script ships in.
#
#   powershell -ExecutionPolicy Bypass -File "C:\path\to\orbit-extension\updater\install-windows.ps1"
#
# (or double-click install-windows.cmd next to it). Copies the native messaging host out of the
# extension folder (the folder is replaced on every update, the host must not be) and registers
# it with Chrome, Chromium, Brave and Edge for this extension's id only. Run it again after
# moving the extension folder.

$ErrorActionPreference = 'Stop'

$HostName = 'space.privateorbit.extension_updater'
$ExtensionDir = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $ExtensionDir 'manifest.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "No manifest.json in $ExtensionDir" }
# The updater replaces this folder wholesale, so it must be the unpacked release, never the
# extension's sources in a clone of the repository.
$looksLikeSources = @('src', 'package.json', '.git') | Where-Object { Test-Path -LiteralPath (Join-Path $ExtensionDir $_) }
if (-not (Test-Path -LiteralPath (Join-Path $ExtensionDir 'background.js')) -or $looksLikeSources) {
  throw "$ExtensionDir is not an unpacked Orbit release; run the installer from the downloaded copy."
}
$key = [string](Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).key
if (-not $key) { throw 'manifest.json has no key; is this the Orbit release build?' }

# Chrome's id for an unpacked extension with a key: sha256 of the key's bytes, first 32 hex
# digits, each mapped 0-f to a-p.
$digest = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($key))
$extensionId = -join ($digest[0..15] | ForEach-Object {
  [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15))
})

$hostDir = Join-Path $env:LOCALAPPDATA 'Orbit\extension-updater'
New-Item -ItemType Directory -Path $hostDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'orbit-updater.ps1') -Destination $hostDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'orbit-updater.cmd') -Destination $hostDir -Force
@{ extensionDir = $ExtensionDir; keyPrefix = $key.Substring(0, 64) } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $hostDir 'config.json') -Encoding UTF8

$hostManifestPath = Join-Path $hostDir "$HostName.json"
# Written without a byte order mark: Chrome does not parse a host manifest that starts with one,
# and Set-Content -Encoding UTF8 in Windows PowerShell always writes it.
$hostManifest = @{
  name = $HostName
  description = 'Orbit extension updater'
  path = (Join-Path $hostDir 'orbit-updater.cmd')
  type = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($hostManifestPath, $hostManifest, (New-Object Text.UTF8Encoding $false))

foreach ($browser in @('Google\Chrome', 'Chromium', 'BraveSoftware\Brave-Browser', 'Microsoft\Edge')) {
  $registryKey = "HKCU:\Software\$browser\NativeMessagingHosts\$HostName"
  New-Item -Path $registryKey -Force | Out-Null
  Set-Item -Path $registryKey -Value $hostManifestPath
}

Write-Host ''
Write-Host 'Orbit updater installed.'
Write-Host "  extension folder: $ExtensionDir"
Write-Host "  extension id:     $extensionId"
Write-Host 'Open the Orbit popup and press "Check for updates" to try it.'
