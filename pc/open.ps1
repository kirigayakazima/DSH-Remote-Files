param(
    [Parameter(Mandatory = $true)][string]$ConfigFile,
    [string]$AdbPath,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$ConfigFile = [IO.Path]::GetFullPath($ConfigFile)
$privateDir = Split-Path -Parent $ConfigFile
$projectDir = Split-Path -Parent $PSScriptRoot
$workspaceDir = Split-Path -Parent (Split-Path -Parent $projectDir)
if ($AdbPath) { $adbExe = [IO.Path]::GetFullPath($AdbPath) }
elseif ($env:ADB_PATH) { $adbExe = [IO.Path]::GetFullPath($env:ADB_PATH) }
elseif (Get-Command adb.exe -ErrorAction SilentlyContinue) { $adbExe = (Get-Command adb.exe).Source }
else { $adbExe = Join-Path $workspaceDir '_toolchains\android-sdk\platform-tools\adb.exe' }
if (!(Test-Path -LiteralPath $adbExe -PathType Leaf)) { throw 'ADB not found. Supply -AdbPath or put Android platform-tools on PATH.' }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$pairState = Get-Content -LiteralPath (Join-Path $privateDir 'pairing-state.json') -Raw | ConvertFrom-Json
$serial = [string]$pairState.serial
if ($serial -notmatch '^[a-zA-Z0-9._:-]+$') { throw 'Invalid paired device.' }

# Reuse only this device's exact USB mapping; do not replace someone else's port.
$forwards = @(& $adbExe forward --list)
if ($LASTEXITCODE -ne 0) { throw 'ADB is unavailable.' }
$mapping = @($forwards | Where-Object { $_ -match '^\S+\s+tcp:22225\s+' })
if ($mapping.Count) {
    if ($mapping.Count -ne 1 -or ($mapping[0].Trim() -split '\s+') -join ' ' -ne "$serial tcp:22225 tcp:22225") { throw 'USB port 22225 is already used by a different mapping.' }
} else {
    $null = & $adbExe -s $serial forward --no-rebind tcp:22225 tcp:22225
    if ($LASTEXITCODE -ne 0) { throw 'Connect and unlock the paired phone, then authorize USB debugging.' }
}

if (!(Test-Path -LiteralPath $ConfigFile -PathType Leaf)) {
    & $nodeExe (Join-Path $PSScriptRoot 'pair-usb.mjs') finish $privateDir $adbExe $serial
    if ($LASTEXITCODE -ne 0) { throw 'The phone must finish the one-time pairing export first.' }
}
$config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
if ($config.port -ne 22226) { throw 'This launcher expects local UI port 22226.' }
$url = 'http://127.0.0.1:22226'
$uiToken = (Get-Content -LiteralPath $config.uiTokenFile -Raw).Trim()
$headers = @{Authorization = "Bearer $uiToken"}
function Test-LocalBroker {
    try {
        $reply = Invoke-RestMethod -Uri "$url/api/vault" -Headers $headers -TimeoutSec 2
        return ($null -ne $reply.available)
    } catch { return $false }
}
if (!(Test-LocalBroker)) {
    $probe = [Net.Sockets.TcpClient]::new()
    try { $probe.Connect('127.0.0.1', 22226); $occupied = $true } catch { $occupied = $false } finally { $probe.Dispose() }
    if ($occupied) { throw 'Local port 22226 is occupied by a different process.' }
    $browserEntry = Join-Path $PSScriptRoot 'browser.mjs'
    if ($browserEntry.Contains('"') -or $ConfigFile.Contains('"')) { throw 'Unsupported quote in configuration path.' }
    $process = Start-Process -FilePath $nodeExe -ArgumentList @(('"{0}"' -f $browserEntry), ('"{0}"' -f $ConfigFile)) -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $privateDir 'browser.stdout.log') -RedirectStandardError (Join-Path $privateDir 'browser.stderr.log')
    [IO.File]::WriteAllText((Join-Path $privateDir 'browser.pid'), [string]$process.Id)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-LocalBroker) { break }
        Start-Sleep -Milliseconds 100
    }
    if (!(Test-LocalBroker)) { throw 'Local UI did not start. Inspect browser.stderr.log in the private configuration directory.' }
}

# Clipboard is local only; never print either credential or put it into a URL.
Set-Clipboard -Value $uiToken
Write-Output "Ready: $url"
Write-Output 'The local UI login token is on the clipboard. Paste it in the login box.'
if (!$NoBrowser) { Start-Process $url }
