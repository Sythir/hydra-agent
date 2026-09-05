# Hydra Deploy Agent

A deployment agent that connects to the Hydra deployment gateway and executes deployments on your servers.

## Quick Start

### Linux

```bash
# Create directory and download
mkdir -p ~/HydraAgent/current
curl -L https://github.com/Sythir/hydra-agent/releases/latest/download/agent-linux -o ~/HydraAgent/current/agent
curl -L https://github.com/Sythir/hydra-agent/releases/latest/download/launcher.sh -o ~/HydraAgent/launcher.sh
chmod +x ~/HydraAgent/current/agent ~/HydraAgent/launcher.sh

# Run with your agent key
~/HydraAgent/launcher.sh --agent-key YOUR_AGENT_KEY
```

### Windows (PowerShell)

```powershell
# Create directory and download
New-Item -ItemType Directory -Path "$env:USERPROFILE\HydraAgent\current" -Force
Invoke-WebRequest -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/agent-win.exe" -OutFile "$env:USERPROFILE\HydraAgent\current\agent.exe"
Invoke-WebRequest -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/launcher.ps1" -OutFile "$env:USERPROFILE\HydraAgent\launcher.ps1"

# Run with your agent key
& "$env:USERPROFILE\HydraAgent\launcher.ps1" --agent-key YOUR_AGENT_KEY
```

---

## Installation

### Prerequisites

- A Hydra agent key (obtain from the Hydra dashboard)
- Network access to the Hydra gateway (default: `https://hydra.sythir.com`)

### Directory Structure

```
~/HydraAgent/                    # Linux: /home/user/HydraAgent
%USERPROFILE%\HydraAgent\        # Windows: C:\Users\username\HydraAgent

HydraAgent/
├── launcher.sh / launcher.ps1   # Launcher script (manages the agent process)
├── current/
│   └── agent (or agent.exe)     # Current running binary
├── backup/
│   └── agent                    # Previous version (for rollback)
├── update/
│   └── agent.new                # Downloaded update (temporary)
├── config/
│   ├── health-check.signal      # Health check signal file
│   └── restart.signal           # Restart signal file
└── logs/
    └── launcher.log             # Launcher logs
```

---

## Linux Installation

### Step 1: Create directories

```bash
mkdir -p ~/HydraAgent/current ~/HydraAgent/backup ~/HydraAgent/logs
```

### Step 2: Download the agent

```bash
# Download the binary
curl -L https://github.com/Sythir/hydra-agent/releases/latest/download/agent-linux \
  -o ~/HydraAgent/current/agent

# Download the launcher script
curl -L https://github.com/Sythir/hydra-agent/releases/latest/download/launcher.sh \
  -o ~/HydraAgent/launcher.sh

# Make executable
chmod +x ~/HydraAgent/current/agent
chmod +x ~/HydraAgent/launcher.sh
```

### Step 3: Run manually (testing)

```bash
~/HydraAgent/launcher.sh --agent-key YOUR_AGENT_KEY
```

### Step 4: Install as systemd service

Create the service file:

```bash
sudo tee /etc/systemd/system/hydra-agent.service << 'EOF'
[Unit]
Description=Hydra Deploy Agent
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/HydraAgent
ExecStart=/home/YOUR_USERNAME/HydraAgent/launcher.sh --agent-key YOUR_AGENT_KEY
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

Replace `YOUR_USERNAME` and `YOUR_AGENT_KEY` with your actual values, then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hydra-agent
sudo systemctl start hydra-agent

# Check status
sudo systemctl status hydra-agent

# View logs
journalctl -u hydra-agent -f
```

---

## Windows Installation

### Step 1: Create directories

Open PowerShell as Administrator:

```powershell
$AgentHome = "$env:USERPROFILE\HydraAgent"
New-Item -ItemType Directory -Path "$AgentHome\current" -Force
New-Item -ItemType Directory -Path "$AgentHome\backup" -Force
New-Item -ItemType Directory -Path "$AgentHome\logs" -Force
```

### Step 2: Download the agent

```powershell
$AgentHome = "$env:USERPROFILE\HydraAgent"

# Download the binary
Invoke-WebRequest `
  -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/agent-win.exe" `
  -OutFile "$AgentHome\current\agent.exe"

# Download the launcher script
Invoke-WebRequest `
  -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/launcher.ps1" `
  -OutFile "$AgentHome\launcher.ps1"
```

### Step 3: Run manually (testing)

```powershell
& "$env:USERPROFILE\HydraAgent\launcher.ps1" --agent-key YOUR_AGENT_KEY
```

### Step 4: Install as a Windows Scheduled Task (survives RDP logoff)

> Running `launcher.ps1` by hand in an RDP session (even as an Administrator) will **always**
> stop when that session logs off — admin rights don't change that. The process only survives
> logoff if it's registered as a Scheduled Task (or service) that runs with no user logged on.

Download the installer alongside `launcher.ps1` and run it from an **elevated** PowerShell prompt:

```powershell
$AgentHome = "$env:USERPROFILE\HydraAgent"

Invoke-WebRequest `
  -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/install-windows-service.ps1" `
  -OutFile "$AgentHome\install-windows-service.ps1"

& "$AgentHome\install-windows-service.ps1" -AgentKey YOUR_AGENT_KEY
```

This registers a Scheduled Task (`HydraAgent`) that:

- starts at boot (`AtStartup` trigger),
- runs as `SYSTEM` with `LogonType ServiceAccount` — the setting that actually keeps it running with
  nobody logged on, not just tolerant of an RDP disconnect,
- has no execution time limit (Task Scheduler kills tasks after 72h by default otherwise),
- restarts automatically up to 3 times on failure.

Check status:

```powershell
Get-ScheduledTask -TaskName HydraAgent | Get-ScheduledTaskInfo
```

To run the agent as a specific domain/local account instead of `SYSTEM`, pass `-User` and `-Password`
(that account needs "Log on as a batch job" rights):

```powershell
& "$AgentHome\install-windows-service.ps1" -AgentKey YOUR_AGENT_KEY -User "DOMAIN\svc-hydra" -Password (Read-Host -AsSecureString)
```

To uninstall:

```powershell
Invoke-WebRequest `
  -Uri "https://github.com/Sythir/hydra-agent/releases/latest/download/uninstall-windows-service.ps1" `
  -OutFile "$AgentHome\uninstall-windows-service.ps1"

& "$AgentHome\uninstall-windows-service.ps1"
```

#### Alternative: NSSM

If you'd rather use [NSSM](https://nssm.cc/) (Non-Sucking Service Manager) instead of Task Scheduler:

```powershell
# Download NSSM
Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
Expand-Archive -Path "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm"
Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" "C:\Windows\System32\"

# Install the service (replace YOUR_AGENT_KEY with your actual key)
nssm install HydraAgent powershell.exe
nssm set HydraAgent AppParameters "-ExecutionPolicy Bypass -File `"$env:USERPROFILE\HydraAgent\launcher.ps1`" --agent-key YOUR_AGENT_KEY"
nssm set HydraAgent AppDirectory "$env:USERPROFILE\HydraAgent"
nssm set HydraAgent DisplayName "Hydra Deploy Agent"
nssm set HydraAgent Description "Deployment agent for Hydra"
nssm set HydraAgent Start SERVICE_AUTO_START
nssm set HydraAgent ObjectName LocalSystem

# Start the service
nssm start HydraAgent
```

NSSM services run as `LocalSystem` by default regardless of who's logged in, so this also survives
RDP logoff.

---

## Configuration

### Command Line Arguments

| Argument                   | Required | Description                                                    |
| -------------------------- | -------- | -------------------------------------------------------------- |
| `--agent-key <key>`        | Yes      | Your agent authentication key                                  |
| `--keep-deployments <n>`   | No       | Number of old deployments to keep (default: 5)                 |
| `--timeout <n>`            | No       | Deployment script timeout in seconds (default: 60)             |
| `--deployment-dir <dir>`   | No       | Custom directory for deployments (default: ~/HydraDeploys)     |

### Optional Environment Variables

| Variable                    | Default                                           | Description                          |
| --------------------------- | ------------------------------------------------- | ------------------------------------ |
| `HOST`                      | `https://hydra.sythir.com/api/deployment-gateway` | Gateway URL                          |
| `AGENT_HOME`                | Launcher script directory                         | Agent installation directory         |
| `DEPLOYMENT_DIRECTORY`      | `~/HydraDeploys`                                  | Custom directory for deployments     |
| `DEPLOY_LOGS_DIRECTORY`     | -                                                 | Custom directory for deployment logs |
| `DEPLOY_TIMEOUT_IN_SECONDS` | `60`                                              | Deployment script timeout            |

### Example with all options

```bash
# Linux
~/HydraAgent/launcher.sh --agent-key abc123 --keep-deployments 10 --timeout 120 --deployment-dir /var/deployments

# Windows
& "$env:USERPROFILE\HydraAgent\launcher.ps1" --agent-key abc123 --keep-deployments 10 --timeout 120 --deployment-dir "C:\Deployments"
```

---

## Auto-Updates

The agent supports automatic updates triggered from the Hydra server.

### How it works

1. Server sends update command with download URL
2. Agent downloads new binary and verifies checksum
3. Agent exits with code 100 (signals update)
4. Launcher replaces binary and restarts agent
5. Health check verifies new version started successfully
6. If health check fails, launcher rolls back to previous version

### AGENT_HOME

Updates are handed from the agent to the launcher through files under `AGENT_HOME`
(`update/agent.exe.new`, `config/restart.signal`, `update/update.lock`), so **both sides must
resolve the same directory**. The launchers take `AGENT_HOME` from their own location and export it
to the agent, which falls back to its working directory if the variable is unset.

Do not run the agent binary directly from an unrelated working directory without setting
`AGENT_HOME` — it will download updates into a tree the launcher never inspects, and the update will
report as `restarting` on the server but never apply.

---

## Logs

### Launcher logs

```bash
# Linux
tail -f ~/HydraAgent/logs/launcher.log

# Windows
Get-Content "$env:USERPROFILE\HydraAgent\logs\launcher.log" -Wait
```

### Systemd logs (Linux)

```bash
journalctl -u hydra-agent -f
```

---

## Troubleshooting

### Agent won't connect

1. Verify `--agent-key` is correct
2. Check network connectivity to the gateway:
   ```bash
   curl -I https://hydra.sythir.com/api/deployment-gateway
   ```
3. Check firewall rules allow outbound HTTPS

### Update fails

1. Check launcher logs: `~/HydraAgent/logs/launcher.log`
2. Verify write permissions to `~/HydraAgent/` directory
3. Check disk space

If the launcher logs `No restart signal found at ... (agent and launcher disagree on AGENT_HOME?)`,
the agent wrote the update somewhere else. Confirm the installed `AGENT_HOME` (the installer prints
it) and that the agent is started through the launcher rather than directly.

If a new binary starts but never passes the health check, the launcher rolls back and keeps that
run's output at `logs/agent-failed-update.log`.

If the server reports `Update already in progress` and no update is running, delete
`AGENT_HOME/update/update.lock`. Locks older than 15 minutes are ignored automatically.

### Agent keeps restarting

The launcher will exit after 3 consecutive crashes. Check:

1. Launcher logs for error messages
2. Correct `--agent-key` is provided
3. Binary has execute permissions (Linux)

### Manual rollback

```bash
# Linux
cp ~/HydraAgent/backup/agent ~/HydraAgent/current/agent
sudo systemctl restart hydra-agent
```

```powershell
# Windows
Copy-Item "$env:USERPROFILE\HydraAgent\backup\agent.exe" "$env:USERPROFILE\HydraAgent\current\agent.exe" -Force
nssm restart HydraAgent
```

---

## Uninstall

### Linux

```bash
sudo systemctl stop hydra-agent
sudo systemctl disable hydra-agent
sudo rm /etc/systemd/system/hydra-agent.service
sudo systemctl daemon-reload
rm -rf ~/HydraAgent
```

### Windows

```powershell
# If using Task Scheduler (install-windows-service.ps1)
& "$env:USERPROFILE\HydraAgent\uninstall-windows-service.ps1"

# If using NSSM
nssm stop HydraAgent
nssm remove HydraAgent confirm

# Remove files
Remove-Item -Recurse -Force "$env:USERPROFILE\HydraAgent"
```

---

## Support

- Issues: https://github.com/Sythir/hydra-agent/issues
