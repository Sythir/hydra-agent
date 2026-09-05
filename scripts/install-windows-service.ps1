<#
.SYNOPSIS
    Installs the Hydra Agent as a Windows Scheduled Task that starts at boot and keeps
    running whether or not a user is logged on (survives RDP disconnect/logoff).
.DESCRIPTION
    Registers launcher.ps1 as a Scheduled Task with an AtStartup trigger, RunLevel Highest,
    and LogonType ServiceAccount so it runs independently of any interactive session. Must be
    run from an elevated (Administrator) PowerShell prompt.
.EXAMPLE
    .\install-windows-service.ps1 -AgentKey YOUR_AGENT_KEY
.EXAMPLE
    .\install-windows-service.ps1 -AgentKey YOUR_AGENT_KEY -User "DOMAIN\svc-hydra" -Password (Read-Host -AsSecureString)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AgentKey,

    [string]$AgentHome = $(if ($env:AGENT_HOME) { $env:AGENT_HOME } else { $PSScriptRoot }),

    [string]$TaskName = "HydraAgent",

    # SYSTEM has the rights the agent needs for things like IIS management and requires no
    # password. Pass a domain/local account + -Password only if you specifically need the
    # agent to run as something other than SYSTEM.
    [string]$User = "SYSTEM",

    [System.Security.SecureString]$Password,

    [int]$KeepDeployments,

    [int]$Timeout,

    [string]$DeploymentDir
)

$ErrorActionPreference = "Stop"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run from an elevated (Administrator) PowerShell prompt."
}

$LauncherPath = Join-Path $AgentHome "launcher.ps1"
if (-not (Test-Path $LauncherPath)) {
    throw "launcher.ps1 not found at $LauncherPath. Set -AgentHome to the HydraAgent installation directory."
}

$launcherArgs = "-ExecutionPolicy Bypass -NoProfile -File `"$LauncherPath`" --agent-key $AgentKey"
if ($KeepDeployments) { $launcherArgs += " --keep-deployments $KeepDeployments" }
if ($Timeout) { $launcherArgs += " --timeout $Timeout" }
if ($DeploymentDir) { $launcherArgs += " --deployment-dir `"$DeploymentDir`"" }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Existing task '$TaskName' found - removing before reinstall."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $launcherArgs -WorkingDirectory $AgentHome
$Trigger = New-ScheduledTaskTrigger -AtStartup

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$builtInServiceAccounts = @("SYSTEM", "NT AUTHORITY\SYSTEM", "LOCAL SERVICE", "NT AUTHORITY\LOCAL SERVICE", "NETWORK SERVICE", "NT AUTHORITY\NETWORK SERVICE")

if ($builtInServiceAccounts -contains $User) {
    # LogonType ServiceAccount is what makes this run with literally no one logged on, not
    # just tolerate an RDP disconnect - built-in accounts need no stored password for it.
    $Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Hydra Deploy Agent" | Out-Null
} else {
    if (-not $Password) {
        throw "Running as '$User' requires -Password (that account needs 'Log on as a batch job' rights)."
    }
    $Credential = New-Object System.Management.Automation.PSCredential($User, $Password)
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -User $User -Password $Credential.GetNetworkCredential().Password -RunLevel Highest -Settings $Settings -Description "Hydra Deploy Agent" | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host ""
Write-Host "Task '$TaskName' installed and started."
Write-Host "  State:       $($task.State)"
Write-Host "  Last result: $($info.LastTaskResult)"
Write-Host "  Runs as:     $User (survives RDP logoff and reboot)"
Write-Host "  AGENT_HOME:  $AgentHome"
Write-Host ""
Write-Host "Logs: $(Join-Path $AgentHome 'logs\launcher.log')"
