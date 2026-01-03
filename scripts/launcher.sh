#!/bin/bash
set -e

# Hydra Agent Launcher Script
# Manages the agent process, handles updates, and performs rollbacks

AGENT_HOME="${AGENT_HOME:-$HOME/HydraAgent}"
CURRENT_DIR="$AGENT_HOME/current"
BACKUP_DIR="$AGENT_HOME/backup"
UPDATE_DIR="$AGENT_HOME/update"
CONFIG_DIR="$AGENT_HOME/config"
LOGS_DIR="$AGENT_HOME/logs"

BINARY_NAME="agent"
CURRENT_BINARY="$CURRENT_DIR/$BINARY_NAME"
BACKUP_BINARY="$BACKUP_DIR/$BINARY_NAME"
NEW_BINARY="$UPDATE_DIR/${BINARY_NAME}.new"
RESTART_SIGNAL="$CONFIG_DIR/restart.signal"
HEALTH_CHECK_SIGNAL="$CONFIG_DIR/health-check.signal"
UPDATE_LOCK="$UPDATE_DIR/update.lock"
LOG_FILE="$LOGS_DIR/launcher.log"

HEALTH_CHECK_TIMEOUT=30
HEALTH_CHECK_INTERVAL=2
MAX_RESTART_ATTEMPTS=3

log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

mkdir -p "$CURRENT_DIR" "$BACKUP_DIR" "$UPDATE_DIR" "$CONFIG_DIR" "$LOGS_DIR"

health_check() {
    local timeout=$HEALTH_CHECK_TIMEOUT
    local elapsed=0

    log "INFO" "Starting health check (timeout: ${timeout}s)"

    while [ $elapsed -lt $timeout ]; do
        if [ -f "$HEALTH_CHECK_SIGNAL" ]; then
            log "INFO" "Health check passed"
            rm -f "$HEALTH_CHECK_SIGNAL"
            return 0
        fi
        sleep $HEALTH_CHECK_INTERVAL
        elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
    done

    log "ERROR" "Health check failed - timeout after ${timeout}s"
    return 1
}

rollback() {
    log "WARN" "Initiating rollback..."

    if [ -f "$BACKUP_BINARY" ]; then
        cp "$BACKUP_BINARY" "$CURRENT_BINARY"
        chmod +x "$CURRENT_BINARY"
        log "INFO" "Rollback complete - restored previous version"
        return 0
    else
        log "ERROR" "No backup binary available for rollback"
        return 1
    fi
}

perform_update() {
    if [ ! -f "$RESTART_SIGNAL" ]; then
        return 1
    fi

    log "INFO" "Update signal detected, performing binary replacement"

    local new_binary_path=$(head -1 "$RESTART_SIGNAL")
    rm -f "$RESTART_SIGNAL"

    if [ ! -f "$new_binary_path" ]; then
        log "ERROR" "New binary not found at: $new_binary_path"
        return 1
    fi

    if [ -f "$CURRENT_BINARY" ]; then
        log "INFO" "Backing up current binary"
        cp "$CURRENT_BINARY" "$BACKUP_BINARY"
    fi

    mv "$new_binary_path" "$CURRENT_BINARY"
    chmod +x "$CURRENT_BINARY"

    rm -f "$UPDATE_LOCK"

    log "INFO" "Binary replacement complete"
    return 0
}

cleanup_signals() {
    rm -f "$HEALTH_CHECK_SIGNAL" "$RESTART_SIGNAL" "$UPDATE_LOCK"
}

restart_count=0
cleanup_signals

log "INFO" "Hydra Agent Launcher started"

while true; do
    if [ -f "$RESTART_SIGNAL" ]; then
        perform_update || true
    fi

    if [ ! -f "$CURRENT_BINARY" ]; then
        log "ERROR" "Agent binary not found at $CURRENT_BINARY"
        log "INFO" "Waiting for binary to be installed..."
        sleep 10
        continue
    fi

    log "INFO" "Starting agent..."

    "$CURRENT_BINARY" "$@" &
    AGENT_PID=$!

    wait $AGENT_PID || true
    EXIT_CODE=$?

    log "INFO" "Agent exited with code: $EXIT_CODE"

    case $EXIT_CODE in
        0)
            log "INFO" "Agent exited normally"
            break
            ;;
        100)
            log "INFO" "Update restart requested"
            restart_count=0

            if perform_update; then
                log "INFO" "Starting updated agent for health check"

                "$CURRENT_BINARY" "$@" &
                AGENT_PID=$!

                if health_check; then
                    log "INFO" "Update successful"
                    wait $AGENT_PID || true
                    NEW_EXIT_CODE=$?

                    if [ $NEW_EXIT_CODE -eq 100 ]; then
                        continue
                    elif [ $NEW_EXIT_CODE -eq 0 ]; then
                        log "INFO" "Agent exited normally after update"
                        break
                    else
                        log "WARN" "Agent exited unexpectedly after update with code: $NEW_EXIT_CODE"
                    fi
                else
                    log "ERROR" "Health check failed, initiating rollback"
                    kill $AGENT_PID 2>/dev/null || true
                    sleep 2

                    if rollback; then
                        log "INFO" "Rollback successful, restarting with previous version"
                    else
                        log "ERROR" "Rollback failed - no backup available"
                        exit 1
                    fi
                fi
            else
                log "ERROR" "Update failed, restarting current version"
            fi
            ;;
        *)
            restart_count=$((restart_count + 1))

            if [ $restart_count -ge $MAX_RESTART_ATTEMPTS ]; then
                log "ERROR" "Max restart attempts ($MAX_RESTART_ATTEMPTS) reached. Exiting."
                exit 1
            fi

            log "WARN" "Agent crashed. Restart attempt $restart_count of $MAX_RESTART_ATTEMPTS"
            sleep 5
            ;;
    esac
done

log "INFO" "Hydra Agent Launcher stopped"
