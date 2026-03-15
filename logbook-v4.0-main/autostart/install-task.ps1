# ============================================================
# Logbook System - Windows Task Scheduler Installer
#
# Run this script ONCE (as Administrator) to register a
# scheduled task that automatically launches the Logbook
# web app whenever you log in to Windows.
#
# Usage:
#   Right-click this file → "Run with PowerShell"
#   - OR -
#   powershell -ExecutionPolicy Bypass -File install-task.ps1
# ============================================================

# Self-elevate if not already running as Administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting Administrator privileges..."
    Start-Process powershell.exe `
        -ArgumentList "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Definition)`"" `
        -Verb RunAs
    exit
}

$taskName    = "LogbookSystem"
$taskDesc    = "Starts the Logbook System Node.js server and opens it in the browser at login."
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition   # autostart\
$appDir      = Split-Path -Parent $scriptDir                             # project root
$batFile     = Join-Path $scriptDir "start-logbook.bat"

# Verify the launcher exists
if (-not (Test-Path $batFile)) {
    Write-Error "Could not find start-logbook.bat at: $batFile"
    exit 1
}

# ---- Build the scheduled task components ----

# Action: run the batch file (cmd /c ensures .bat runs correctly)
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$batFile`"" `
    -WorkingDirectory $scriptDir

# Trigger: at current user logon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Settings: allow running on battery, don't stop on idle, etc.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew

# Principal: run as current user, only when logged in
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

# ---- Register (or update) the task ----
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Task '$taskName' already exists. Updating..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName  $taskName `
    -Description $taskDesc `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -Principal $principal | Out-Null

Write-Host ""
Write-Host "========================================"
Write-Host "  Logbook System task registered!"
Write-Host "========================================"
Write-Host "  Task name : $taskName"
Write-Host "  Trigger   : At logon ($env:USERNAME)"
Write-Host "  Script    : $batFile"
Write-Host ""
Write-Host "The app will start automatically the next time you log in."
Write-Host "To run it right now, execute:  $batFile"
Write-Host ""

# Ask if the user wants to start it immediately
$ans = Read-Host "Run the app now? (Y/N)"
if ($ans -match '^[Yy]') {
    Start-Process -FilePath $batFile
}
