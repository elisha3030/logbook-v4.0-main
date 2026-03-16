# ============================================================
# Logbook System - PowerShell Startup Script
# Starts the Node.js server and opens the app in the browser.
# Designed to be called directly or via Windows Task Scheduler.
# ============================================================

# Resolve the project root (parent of the autostart\ folder this script lives in)
$appDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)

Set-Location $appDir

# --- Check for Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    [System.Windows.Forms.MessageBox]::Show(
        "Node.js is not installed or not in PATH.`nPlease install Node.js and try again.",
        "Logbook System - Error",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
    exit 1
}

# --- Start the server (hidden window) ---
$serverProcess = Start-Process -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $appDir `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Logbook server started (PID: $($serverProcess.Id))"

# --- Wait for the server to be ready ---
$port     = 3000
$url      = "http://localhost:$port"
$maxWait  = 30   # seconds
$elapsed  = 0
$ready    = $false

Write-Host "Waiting for server on $url ..."
while ($elapsed -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # Server not ready yet
    }
    Start-Sleep -Seconds 1
    $elapsed++
}

if ($ready) {
    Write-Host "Server is ready. Opening browser..."
    Start-Process $url
} else {
    Write-Warning "Server did not respond within $maxWait seconds. Opening browser anyway..."
    Start-Process $url
}
