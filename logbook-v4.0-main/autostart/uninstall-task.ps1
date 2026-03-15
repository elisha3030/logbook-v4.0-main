# ============================================================
# Logbook System - Task Scheduler Uninstaller
#
# Run this script (as Administrator) to remove the scheduled
# task created by install-task.ps1.
#
# Usage:
#   Right-click this file → "Run with PowerShell"
#   - OR -
#   powershell -ExecutionPolicy Bypass -File uninstall-task.ps1
# ============================================================

#Requires -RunAsAdministrator

$taskName = "LogbookSystem"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Task '$taskName' has been removed."
} else {
    Write-Host "Task '$taskName' was not found. Nothing to remove."
}
