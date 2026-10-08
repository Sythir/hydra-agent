import path from 'path';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

/**
 * Default installation directory for win-acme (portable edition).
 * Placed under ProgramData so it persists across deployments and is accessible to SYSTEM.
 */
const WIN_ACME_DIR = 'C:\\ProgramData\\win-acme';
const WIN_ACME_EXE = path.join(WIN_ACME_DIR, 'wacs.exe');

/**
 * win-acme names its release assets with the full version, e.g.
 * `win-acme.v2.2.9.1701.x64.pluggable.zip`. There is deliberately no version-independent file name,
 * so `/releases/latest/download/<name>` cannot be used with a guess: GitHub redirects to the newest
 * tag, but the asset name still has to match exactly, and `win-acme.v2.x64.pluggable.zip` returns a
 * 404 from every release there has ever been.
 *
 * The asset is therefore resolved from the releases API at install time, with a pinned version as
 * the fallback for hosts that cannot reach the API (unauthenticated GitHub API calls are rate
 * limited per IP, which a busy deployment server can hit).
 */
const WIN_ACME_RELEASES_API = 'https://api.github.com/repos/win-acme/win-acme/releases/latest';
const WIN_ACME_FALLBACK_VERSION = 'v2.2.9.1701';
const WIN_ACME_FALLBACK_URL =
  `https://github.com/win-acme/win-acme/releases/download/${WIN_ACME_FALLBACK_VERSION}/` +
  `win-acme.${WIN_ACME_FALLBACK_VERSION}.x64.pluggable.zip`;

export interface ManagedSslResult {
  thumbprint: string;
  expiryDate: string;
  domain: string;
}

/**
 * Checks whether win-acme is already installed at the expected location.
 */
export async function isWinAcmeInstalled(logger: LoggerFunc, deployFolder: string): Promise<boolean> {
  const result = await executePowerShellOrThrow(
    `
    if (Test-Path '${escapePowerShellString(WIN_ACME_EXE)}') {
      Write-Output 'true'
    } else {
      Write-Output 'false'
    }
    `,
    logger,
    deployFolder,
  );
  return result.trim() === 'true';
}

/**
 * Downloads and extracts the win-acme portable edition.
 */
export async function installWinAcme(logger: LoggerFunc, deployFolder: string): Promise<void> {
  logger(deployFolder, 'info', 'Installing win-acme (portable edition)...');

  await executePowerShellOrThrow(
    `
    $installDir = '${escapePowerShellString(WIN_ACME_DIR)}'
    $zipPath = Join-Path $env:TEMP 'win-acme.zip'

    if (-not (Test-Path $installDir)) {
      New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    # Resolve the real asset name from the releases API. win-acme embeds the full version in the
    # file name, so it cannot be hardcoded without going stale at the next release.
    $downloadUrl = $null
    try {
      $release = Invoke-RestMethod -Uri '${WIN_ACME_RELEASES_API}' -UseBasicParsing -Headers @{ 'User-Agent' = 'hydra-agent' }
      $asset = $release.assets |
        Where-Object { $_.name -like 'win-acme.v*.x64.pluggable.zip' } |
        Select-Object -First 1
      if ($asset) {
        $downloadUrl = $asset.browser_download_url
        Write-Output "Resolved win-acme $($release.tag_name): $($asset.name)"
      } else {
        Write-Output 'No matching x64 pluggable asset in the latest release, using the pinned version'
      }
    } catch {
      Write-Output "Could not query the win-acme releases API ($($_.Exception.Message)), using the pinned version"
    }

    if (-not $downloadUrl) {
      $downloadUrl = '${WIN_ACME_FALLBACK_URL}'
    }

    Write-Output "Downloading win-acme from $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

    # Expand-Archive reports a confusing error on a truncated or HTML error page, so check that the
    # download actually looks like a zip before extracting.
    if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -lt 100000) {
      throw "win-acme download failed or is too small to be the expected archive: $downloadUrl"
    }

    Expand-Archive -Path $zipPath -DestinationPath $installDir -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path '${escapePowerShellString(WIN_ACME_EXE)}')) {
      throw 'win-acme installation failed: wacs.exe not found after extraction'
    }

    Write-Output 'win-acme installed successfully'
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
  );

  logger(deployFolder, 'info', 'win-acme installed successfully');
}

/**
 * Ensures win-acme is available, installing it if necessary.
 */
export async function ensureWinAcme(logger: LoggerFunc, deployFolder: string): Promise<void> {
  const installed = await isWinAcmeInstalled(logger, deployFolder);
  if (!installed) {
    await installWinAcme(logger, deployFolder);
  } else {
    logger(deployFolder, 'info', 'win-acme is already installed');
  }
}

/**
 * Requests a Let's Encrypt certificate for the given hostname using win-acme.
 *
 * win-acme handles its own renewal schedule via a Windows scheduled task created on first run.
 * This function issues the initial certificate and returns the thumbprint so the binding service
 * can assign it to the IIS binding.
 */
export async function provisionCertificate(
  hostname: string,
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<ManagedSslResult> {
  logger(deployFolder, 'info', `Provisioning Let's Encrypt certificate for: ${hostname}`);

  await ensureWinAcme(logger, deployFolder);

  // Unattended invocation:
  //   --source manual --host: issue for exactly this hostname (--target is the pre-2.1.18 alias)
  //   --validation selfhosting: win-acme's own listener answers the HTTP-01 challenge on port 80
  //   --store certificatestore --certificatestore WebHosting: the store IIS binds from
  //   --installation none: this agent assigns the binding itself, in configureBindings, using the
  //     thumbprint returned below. Unattended mode has NO default installation plugin, and omitting
  //     the switch makes win-acme stop and ask which one to use, which never returns.
  //   --notaskscheduler: the scheduled task is created on a later renewal run, not here; prompting
  //     for it is another way an unattended run can block.
  //   --friendlyname: pins a name we can find the certificate by, instead of guessing its subject.
  const friendlyName = `hydra-${hostname}`;
  const result = await executePowerShellOrThrow(
    '$wacsExe = \'' + escapePowerShellString(WIN_ACME_EXE) + '\'\n' +
    '$output = & $wacsExe --source manual --host \'' + escapePowerShellString(hostname) + '\' ' +
    '--friendlyname \'' + escapePowerShellString(friendlyName) + '\' ' +
    '--validation selfhosting --store certificatestore --certificatestore WebHosting ' +
    '--installation none --notaskscheduler ' +
    '--closeonfinish --nocache --accepttos --emailaddress \'admin@' + escapePowerShellString(hostname) + '\' 2>&1\n' +
    '$exitCode = $LASTEXITCODE\n' +
    '$outputStr = $output -join [Environment]::NewLine\n' +
    'Write-Output $outputStr\n' +
    'if ($exitCode -ne 0) {\n' +
    '  throw "win-acme exited with code $exitCode`n$outputStr"\n' +
    '}\n',
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
    // Issuing a certificate involves ACME round trips and HTTP-01 validation, which is well beyond
    // the default PowerShell timeout.
    300000,
  );

  // Read the certificate straight out of the store rather than scraping stdout.
  //
  // win-acme never prints the thumbprint: only the `script` installation plugin exposes it, via a
  // {CertThumbprint} placeholder. The previous code matched any 40 hex characters in the output,
  // which matched nothing on a successful run, so every provisioning attempt failed at the parse
  // step even when the certificate had been issued correctly.
  const lookup = await executePowerShellOrThrow(
    `
    $friendly = '${escapePowerShellString(friendlyName)}'
    # Not $host: that is a read-only automatic variable and assigning it throws.
    $targetHost = '${escapePowerShellString(hostname)}'

    $cert = Get-ChildItem 'Cert:\\LocalMachine\\WebHosting', 'Cert:\\LocalMachine\\My' -ErrorAction SilentlyContinue |
      Where-Object { $_.FriendlyName -eq $friendly -or $_.Subject -eq "CN=$targetHost" } |
      Where-Object { $_.NotAfter -gt (Get-Date) } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1

    if (-not $cert) {
      throw "No valid certificate for $targetHost found in the WebHosting or My store after provisioning"
    }

    Write-Output "$($cert.Thumbprint)|$($cert.NotAfter.ToString('o'))"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
  );

  const [rawThumbprint, rawExpiry] = lookup.trim().split('|');
  const thumbprint = (rawThumbprint || '').trim().toUpperCase();

  if (!/^[0-9A-F]{40}$/.test(thumbprint)) {
    logger(deployFolder, 'error', `win-acme output:\n${result.trim().slice(-2000)}`);
    throw new DeploymentError(
      `Certificate for ${hostname} was not found in the certificate store after provisioning`,
      DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
      { hostname, output: result.slice(-2000) },
    );
  }

  const expiryDate = (rawExpiry || '').trim();
  logger(deployFolder, 'info', `Certificate provisioned with thumbprint: ${thumbprint.substring(0, 8)}...`);
  if (expiryDate) {
    logger(deployFolder, 'info', `Certificate expires: ${expiryDate}`);
  }

  return {
    thumbprint,
    expiryDate,
    domain: hostname,
  };
}
