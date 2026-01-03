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

### Step 4: Install as Windows Service

Using [NSSM](https://nssm.cc/) (Non-Sucking Service Manager):

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

# Start the service
nssm start HydraAgent
```

Or using Task Scheduler:

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -File `"$env:USERPROFILE\HydraAgent\launcher.ps1`" --agent-key YOUR_AGENT_KEY"

$Trigger = New-ScheduledTaskTrigger -AtStartup

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName "HydraAgent" `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -RunLevel Highest `
  -User "SYSTEM"

# Start immediately
Start-ScheduledTask -TaskName "HydraAgent"
```

---

## Configuration

### Command Line Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--agent-key <key>` | Yes | Your agent authentication key |
| `--keep-deployments <n>` | No | Number of old deployments to keep (default: 5) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `https://hydra.sythir.com/api/deployment-gateway` | Gateway URL |
| `AGENT_HOME` | `~/HydraAgent` | Agent installation directory |
| `DEPLOY_LOGS_DIRECTORY` | - | Custom directory for deployment logs |
| `DEPLOY_TIMEOUT_IN_SECONDS` | `60` | Deployment script timeout |

### Example with all options

```bash
# Linux
~/HydraAgent/launcher.sh --agent-key abc123 --keep-deployments 10

# Windows
& "$env:USERPROFILE\HydraAgent\launcher.ps1" --agent-key abc123 --keep-deployments 10
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
# If using NSSM
nssm stop HydraAgent
nssm remove HydraAgent confirm

# If using Task Scheduler
Unregister-ScheduledTask -TaskName "HydraAgent" -Confirm:$false

# Remove files
Remove-Item -Recurse -Force "$env:USERPROFILE\HydraAgent"
```

---

## Support

- Issues: https://github.com/Sythir/hydra-agent/issues
