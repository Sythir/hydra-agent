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

$AgentHome = if ($env:AGENT_HOME) { $env:AGENT_HOME } else { $PSScriptRoot }
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
$AgentStdOutLog = Join-Path $LogsDir "agent-stdout.log"
$AgentStdErrLog = Join-Path $LogsDir "agent-stderr.log"
$AgentFailedLog = Join-Path $LogsDir "agent-failed-update.log"

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

# The agent binary resolves its update/config/logs directories from AGENT_HOME, falling back to the
# working directory. Both must point at the same place as this script or the agent downloads the
# new binary and writes restart.signal somewhere the launcher never looks, and no update ever
# applies. This matters most under the Scheduled Task, where the agent runs as SYSTEM.
$env:AGENT_HOME = $AgentHome

function Start-Agent {
    $startParams = @{
        FilePath               = $CurrentBinary
        PassThru               = $true
        NoNewWindow            = $true
        Wait                   = $false
        WorkingDirectory       = $AgentHome
        # Without these, -NoNewWindow throws "the handle is invalid" when there's no attached
        # console (Task Scheduler running with no user logged on, or any non-interactive session).
        RedirectStandardOutput = $AgentStdOutLog
        RedirectStandardError  = $AgentStdErrLog
    }

    if ($AgentArgs -and $AgentArgs.Count -gt 0) {
        $startParams.ArgumentList = $AgentArgs
    }

    try {
        $proc = Start-Process @startParams

        # A Process object from Start-Process -PassThru does not hold the native process handle
        # open, so once the process exits the kernel object is released and .ExitCode reads back
        # as $null. Touching .Handle forces .NET to cache the handle while the process is still
        # alive, which is the only way the exit code survives WaitForExit(). Without this the
        # agent's update exit code (100) is lost, the switch below falls through to the "crashed"
        # branch, and updates are applied without a health check or rollback.
        if ($proc) {
            try {
                $null = $proc.Handle
            } catch {
                Write-Log "WARN" "Could not cache process handle: $($_.Exception.Message)"
            }
        }

        return $proc
    } catch {
        Write-Log "ERROR" "Failed to start agent: $($_.Exception.Message)"
        return $null
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
        Write-Log "ERROR" "No restart signal found at $RestartSignal (agent and launcher disagree on AGENT_HOME?)"
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

    # NOTE: the update lock is deliberately NOT removed here. The agent only sends the health-check
    # signal when it starts up with the lock still in place, so clearing it before the new binary
    # runs makes every health check time out and every update roll back. It is cleared once the
    # health check has settled, one way or the other.

    Write-Log "INFO" "Binary replacement complete"
    return $true
}

function Clear-Signals {
    Remove-Item $HealthCheckSignal -Force -ErrorAction SilentlyContinue
    Remove-Item $RestartSignal -Force -ErrorAction SilentlyContinue
    Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue
}

$restartCount = 0
$stopLauncher = $false
Clear-Signals

Write-Log "INFO" "Hydra Agent Launcher started (AGENT_HOME: $AgentHome)"

while (-not $stopLauncher) {
    if (Test-Path $RestartSignal) {
        if (Invoke-Update) {
            # A binary swap applied here means the agent asked for an update but its exit code was
            # not seen as 100 (or the signal landed while the launcher was between starts). The new
            # binary is a fresh attempt, not a continuation of a crash loop, so the restart budget
            # is reset. Otherwise accumulated "crashes" from lost exit codes kill the launcher.
            $restartCount = 0
        }
        Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $CurrentBinary)) {
        Write-Log "ERROR" "Agent binary not found at $CurrentBinary"
        Write-Log "INFO" "Waiting for binary to be installed..."
        Start-Sleep -Seconds 10
        continue
    }

    Write-Log "INFO" "Starting agent..."

    $process = Start-Agent

    if (-not $process) {
        $restartCount++
        if ($restartCount -ge $MaxRestartAttempts) {
            Write-Log "ERROR" "Max restart attempts ($MaxRestartAttempts) reached. Exiting."
            exit 1
        }
        Start-Sleep -Seconds 5
        continue
    }

    $process.WaitForExit()
    $exitCode = $process.ExitCode

    if ($null -eq $exitCode) {
        # Should not happen now that Start-Agent caches the process handle, but never silently fall
        # through to the "crashed" branch: a lost exit code there applies updates with no health
        # check and burns the restart budget. Infer intent from the restart signal instead.
        if (Test-Path $RestartSignal) {
            Write-Log "WARN" "Agent exit code unavailable but restart signal present - treating as update restart"
            $exitCode = 100
        } else {
            Write-Log "ERROR" "Agent exit code unavailable - treating as crash"
            $exitCode = -1
        }
    }

    Write-Log "INFO" "Agent exited with code: $exitCode"

    # NOTE: 'break'/'continue' inside a PowerShell switch act on the switch, not on the enclosing
    # while loop, so the loop is controlled with $stopLauncher instead.
    switch ($exitCode) {
        0 {
            Write-Log "INFO" "Agent exited normally"
            $stopLauncher = $true
        }
        100 {
            Write-Log "INFO" "Update restart requested"
            $restartCount = 0

            if (Invoke-Update) {
                Write-Log "INFO" "Starting updated agent for health check"

                $process = Start-Agent

                if ($process -and (Test-HealthCheck)) {
                    Write-Log "INFO" "Update successful"
                    Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue

                    $process.WaitForExit()
                    $newExitCode = $process.ExitCode
                    if ($null -eq $newExitCode) {
                        $newExitCode = if (Test-Path $RestartSignal) { 100 } else { -1 }
                        Write-Log "WARN" "Post-update exit code unavailable - inferred $newExitCode"
                    }

                    if ($newExitCode -eq 0) {
                        Write-Log "INFO" "Agent exited normally after update"
                        $stopLauncher = $true
                    } elseif ($newExitCode -ne 100) {
                        Write-Log "WARN" "Agent exited unexpectedly after update with code: $newExitCode"
                    }
                } else {
                    Write-Log "ERROR" "Health check failed, initiating rollback"

                    if (Test-Path $AgentStdErrLog) {
                        # Start-Process truncates the redirect targets on every start, so keep a
                        # copy of why the new binary failed before the rollback overwrites it.
                        Copy-Item $AgentStdErrLog $AgentFailedLog -Force -ErrorAction SilentlyContinue
                        Write-Log "INFO" "Saved failing agent output to $AgentFailedLog"
                    }

                    if ($process) {
                        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
                    }
                    Start-Sleep -Seconds 2
                    Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue

                    if (Invoke-Rollback) {
                        Write-Log "INFO" "Rollback successful, restarting with previous version"
                    } else {
                        Write-Log "ERROR" "Rollback failed - no backup available"
                        exit 1
                    }
                }
            } else {
                Write-Log "ERROR" "Update failed, restarting current version"
                Remove-Item $UpdateLock -Force -ErrorAction SilentlyContinue
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
