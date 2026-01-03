<#
.SYNOPSIS
    Hydra Agent Launcher Script for Windows
.DESCRIPTION
    Manages the agent process, handles updates, and performs rollbacks
#>

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$AgentArgs
)

$AgentHome = if ($env:AGENT_HOME) { $env:AGENT_HOME } else { Join-Path $env:USERPROFILE "HydraAgent" }
$CurrentDir = Join-Path $AgentHome "current"
$BackupDir = Join-Path $AgentHome "backup"
$UpdateDir = Join-Path $AgentHome "update"
$ConfigDir = Join-Path $AgentHome "config"
$LogsDir = Join-Path $AgentHome "logs"

$BinaryName = "agent.exe"
$CurrentBinary = Join-Path $CurrentDir $BinaryName
$BackupBinary = Join-Path $BackupDir $BinaryName
$NewBinary = Join-Path $UpdateDir "$BinaryName.new"
$RestartSignal = Join-Path $ConfigDir "restart.signal"
$HealthCheckSignal = Join-Path $ConfigDir "health-check.signal"
$UpdateLock = Join-Path $UpdateDir "update.lock"
$LogFile = Join-Path $LogsDir "launcher.log"

$HealthCheckTimeout = 30
$HealthCheckInterval = 2
$MaxRestartAttempts = 3

function Write-Log {
    param(
        [string]$Level,
        [string]$Message
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Write-Host $logEntry

    if (-not (Test-Path $LogsDir)) {
        New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
    }
    Add-Content -Path $LogFile -Value $logEntry -ErrorAction SilentlyContinue
}

@($CurrentDir, $BackupDir, $UpdateDir, $ConfigDir, $LogsDir) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}

function Test-HealthCheck {
    $elapsed = 0
    Write-Log "INFO" "Starting health check (timeout: ${HealthCheckTimeout}s)"

    while ($elapsed -lt $HealthCheckTimeout) {
        if (Test-Path $HealthCheckSignal) {
            Write-Log "INFO" "Health check passed"
            Remove-Item $HealthCheckSignal -Force -ErrorAction SilentlyContinue
            return $true
        }
        Start-Sleep -Seconds $HealthCheckInterval
        $elapsed += $HealthCheckInterval
    }

    Write-Log "ERROR" "Health check failed - timeout after ${HealthCheckTimeout}s"
    return $false
}

function Invoke-Rollback {
    Write-Log "WARN" "Initiating rollback..."

    if (Test-Path $BackupBinary) {
        Copy-Item $BackupBinary $CurrentBinary -Force
        Write-Log "INFO" "Rollback complete - restored previous version"
        return $true
    }

    Write-Log "ERROR" "No backup binary available for rollback"
    return $false
}

function Invoke-Update {
    if (-not (Test-Path $RestartSignal)) {
        return $false
    }

    Write-Log "INFO" "Update signal detected, performing binary replacement"

    $newBinaryPath = Get-Content $RestartSignal -First 1
    Remove-Item $RestartSignal -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $newBinaryPath)) {
        Write-Log "ERROR" "New binary not found at: $newBinaryPath"
        return $false
    }

    if (Test-Path $CurrentBinary) {
        Write-Log "INFO" "Backing up current binary"
        Copy-Item $CurrentBinary $BackupBinary -Force
    }

    Move-Item $newBinaryPath $CurrentBinary -Force

    Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue

    Write-Log "INFO" "Binary replacement complete"
    return $true
}

function Clear-Signals {
    Remove-Item $HealthCheckSignal -Force -ErrorAction SilentlyContinue
    Remove-Item $RestartSignal -Force -ErrorAction SilentlyContinue
    Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue
}

$restartCount = 0
Clear-Signals

Write-Log "INFO" "Hydra Agent Launcher started"

while ($true) {
    if (Test-Path $RestartSignal) {
        Invoke-Update | Out-Null
    }

    if (-not (Test-Path $CurrentBinary)) {
        Write-Log "ERROR" "Agent binary not found at $CurrentBinary"
        Write-Log "INFO" "Waiting for binary to be installed..."
        Start-Sleep -Seconds 10
        continue
    }

    Write-Log "INFO" "Starting agent..."

    $process = Start-Process -FilePath $CurrentBinary -ArgumentList $AgentArgs -PassThru -NoNewWindow -Wait:$false

    $process.WaitForExit()
    $exitCode = $process.ExitCode

    Write-Log "INFO" "Agent exited with code: $exitCode"

    switch ($exitCode) {
        0 {
            Write-Log "INFO" "Agent exited normally"
            break
        }
        100 {
            Write-Log "INFO" "Update restart requested"
            $restartCount = 0

            if (Invoke-Update) {
                Write-Log "INFO" "Starting updated agent for health check"

                $process = Start-Process -FilePath $CurrentBinary -ArgumentList $AgentArgs -PassThru -NoNewWindow -Wait:$false

                if (Test-HealthCheck) {
                    Write-Log "INFO" "Update successful"
                    $process.WaitForExit()
                    $newExitCode = $process.ExitCode

                    if ($newExitCode -eq 100) {
                        continue
                    } elseif ($newExitCode -eq 0) {
                        Write-Log "INFO" "Agent exited normally after update"
                        break
                    } else {
                        Write-Log "WARN" "Agent exited unexpectedly after update with code: $newExitCode"
                    }
                } else {
                    Write-Log "ERROR" "Health check failed, initiating rollback"
                    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2

                    if (Invoke-Rollback) {
                        Write-Log "INFO" "Rollback successful, restarting with previous version"
                    } else {
                        Write-Log "ERROR" "Rollback failed - no backup available"
                        exit 1
                    }
                }
            } else {
                Write-Log "ERROR" "Update failed, restarting current version"
            }
        }
        default {
            $restartCount++

            if ($restartCount -ge $MaxRestartAttempts) {
                Write-Log "ERROR" "Max restart attempts ($MaxRestartAttempts) reached. Exiting."
                exit 1
            }

            Write-Log "WARN" "Agent crashed. Restart attempt $restartCount of $MaxRestartAttempts"
            Start-Sleep -Seconds 5
        }
    }
}

Write-Log "INFO" "Hydra Agent Launcher stopped"
