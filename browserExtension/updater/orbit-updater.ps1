# Orbit extension updater: a Chrome native messaging host for Windows.
#
# Chrome starts orbit-updater.cmd, which runs this script, when the unpacked Orbit extension
# asks it something: one length-prefixed JSON message on stdin, one reply on stdout. Two actions:
#
#   stage  {version, sha256, url}  download the release, check its sha256, unpack it beside
#                                  the extension folder. Slow, and harmless while importing.
#   apply  {version}               mirror the staged copy over the extension folder. Fast.
#                                  The extension asks only when nothing is importing, and
#                                  reloads itself right after.
#
# Installed by install-windows.ps1, which writes config.json next to this file. Nothing but the
# reply may reach stdout: every command that prints is sent to Out-Null or to updater.log.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$HostDir = $PSScriptRoot
$LogPath = Join-Path $HostDir 'updater.log'
$StageRoot = Join-Path $HostDir 'staged'
# Set by an apply: whether the folder still holds a whole release if it fails.
$Restored = $null

function Write-Log([string]$Text) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  Add-Content -LiteralPath $LogPath -Value "$stamp $Text"
}

function Read-Exactly([IO.Stream]$Stream, [int]$Count) {
  $buffer = New-Object byte[] $Count
  $read = 0
  while ($read -lt $Count) {
    $n = $Stream.Read($buffer, $read, $Count - $read)
    if ($n -le 0) { return $null }
    $read += $n
  }
  return ,$buffer
}

function Read-Message {
  $stdin = [Console]::OpenStandardInput()
  $lengthBytes = Read-Exactly $stdin 4
  if ($null -eq $lengthBytes) { return $null }
  $length = [BitConverter]::ToInt32($lengthBytes, 0)
  $body = Read-Exactly $stdin $length
  if ($null -eq $body) { return $null }
  return ([Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json)
}

function Send-Reply($Reply) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($Reply | ConvertTo-Json -Compress))
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# The folder is mirrored, deleting what the release does not have, so it has to be a built Orbit
# extension and nothing else: the extension's own key in its manifest, a compiled background.js,
# and none of what a source checkout has.
function Test-BuiltOrbitExtension([string]$Dir, [string]$KeyPrefix) {
  $manifest = Join-Path $Dir 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifest)) { return $false }
  if (-not (Test-Path -LiteralPath (Join-Path $Dir 'background.js'))) { return $false }
  foreach ($name in @('src', 'package.json', '.git')) {
    if (Test-Path -LiteralPath (Join-Path $Dir $name)) { return $false }
  }
  return (Get-Content -LiteralPath $manifest -Raw).Contains($KeyPrefix)
}

function Invoke-Stage([string]$Version, [string]$Sha256, [string]$Url) {
  if (-not $Url.StartsWith('https://')) { throw 'Refusing a download that is not https.' }
  if ($Sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid sha256.' }

  $dir = Join-Path $StageRoot $Version
  $marker = Join-Path $dir '.verified'
  if ((Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $Sha256)) {
    return
  }

  if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $zip = Join-Path $dir 'release.zip'
  $files = Join-Path $dir 'files'
  Write-Log "stage $Version from $Url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $zip -TimeoutSec 300 | Out-Null
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Sha256) { throw "sha256 mismatch: expected $Sha256, got $actual." }
  Expand-Archive -LiteralPath $zip -DestinationPath $files -Force | Out-Null
  $manifestPath = Join-Path $files 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'The release has no manifest.json.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.version -ne $Version) { throw "The release is not version $Version." }
  Remove-Item -LiteralPath $zip -Force
  Set-Content -LiteralPath $marker -Value $Sha256 -NoNewline
}

# Makes $Target an exact copy of $Source; returns robocopy's exit code, 8 and up being a failure.
function Invoke-Mirror([string]$Source, [string]$Target) {
  & robocopy.exe $Source $Target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-File -Append -LiteralPath $LogPath
  return $LASTEXITCODE
}

function Invoke-Apply([string]$Version) {
  $dir = Join-Path $StageRoot $Version
  $files = Join-Path $dir 'files'
  if (-not (Test-Path -LiteralPath (Join-Path $dir '.verified'))) { throw "Version $Version is not staged." }
  $configPath = Join-Path $HostDir 'config.json'
  if (-not (Test-Path -LiteralPath $configPath)) { throw 'The updater is not configured; run install-windows.ps1 again.' }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $extensionDir = [string]$config.extensionDir
  if (-not (Test-BuiltOrbitExtension $extensionDir ([string]$config.keyPrefix))) {
    throw "$extensionDir does not hold the built Orbit extension."
  }
  Write-Log "apply $Version to $extensionDir"
  # A mirror that stops halfway leaves a folder of neither release, which no worker can run. So
  # the current files are kept aside first and put back when the mirror fails; the reply says
  # whether that worked, and the extension keeps imports out until a mirror succeeds.
  $backup = Join-Path $HostDir 'previous'
  $script:Restored = $true
  $code = Invoke-Mirror $extensionDir $backup
  if ($code -ge 8) { throw "Cannot keep a copy of the current files (robocopy $code)." }
  $code = Invoke-Mirror $files $extensionDir
  if ($code -ge 8) {
    if ((Invoke-Mirror $backup $extensionDir) -ge 8) {
      $script:Restored = $false
      throw "Cannot replace the files (robocopy $code), nor put the previous ones back."
    }
    throw "Cannot replace the files (robocopy $code); the previous version is back."
  }
  Remove-Item -LiteralPath $StageRoot, $backup -Recurse -Force
  # The host is a copy outside the folder, so it takes its own update from the release it just
  # applied. PowerShell has already read this script whole, so replacing it does not touch the
  # run in progress.
  try {
    foreach ($name in @('orbit-updater.ps1', 'orbit-updater.cmd')) {
      $source = Join-Path (Join-Path $extensionDir 'updater') $name
      if (-not (Test-Path -LiteralPath $source)) { continue }
      $next = Join-Path $HostDir ".$name.new"
      Copy-Item -LiteralPath $source -Destination $next -Force
      Move-Item -LiteralPath $next -Destination (Join-Path $HostDir $name) -Force
    }
  } catch {
    Write-Log "could not refresh the host from ${Version}: $($_.Exception.Message)"
  }
}

try {
  $message = Read-Message
  if ($null -eq $message) { exit 0 }
  $version = [string]$message.version
  if ($version -notmatch '^[0-9]+(\.[0-9]+){0,3}$') { throw 'Invalid version.' }
  # One stage or apply at a time: two hosts (two browsers, or two calls close together) would
  # otherwise delete the staging tree under each other. A mutex is released by Windows when its
  # owner dies, so a crashed host never leaves it held.
  $mutex = New-Object Threading.Mutex($false, 'Local\OrbitExtensionUpdater')
  try {
    try {
      if (-not $mutex.WaitOne([TimeSpan]::FromMinutes(5))) { throw 'Another update is in progress.' }
    } catch [Threading.AbandonedMutexException] {
      # Its previous owner died; the mutex is ours now.
    }
    switch ([string]$message.action) {
      'stage' { Invoke-Stage $version ([string]$message.sha256) ([string]$message.url) }
      'apply' { Invoke-Apply $version }
      default { throw 'Unknown action.' }
    }
  } finally {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
  }
  Send-Reply @{ ok = $true; version = $version }
} catch {
  $text = $_.Exception.Message
  try { Write-Log "error: $text" } catch {}
  $reply = @{ ok = $false; error = $text }
  if ($null -ne $script:Restored) { $reply.restored = $script:Restored }
  Send-Reply $reply
}
