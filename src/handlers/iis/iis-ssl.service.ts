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

  // Use win-acme in unattended mode:
  //   --target manual: specify the hostname explicitly
  //   --validation selfhosting: use the built-in HTTP validation server (port 80 must be open)
  //   --store certificatestore: store the cert in the Windows certificate store
  //   --certificatestore WebHosting: use the WebHosting store (standard for IIS)
  //   --installation iis: bind the certificate to the IIS site
  //   --installationsiteid: bind to the correct IIS site
  const result = await executePowerShellOrThrow(
    '$wacsExe = \'' + escapePowerShellString(WIN_ACME_EXE) + '\'\n' +
    '$output = & $wacsExe --target manual --host \'' + escapePowerShellString(hostname) + '\' ' +
    '--validation selfhosting --store certificatestore --certificatestore WebHosting ' +
    '--closeonfinish --nocache --accepttos --emailaddress \'admin@' + escapePowerShellString(hostname) + '\' 2>&1\n' +
    '$exitCode = $LASTEXITCODE\n' +
    '$outputStr = $output -join [Environment]::NewLine\n' +
    'Write-Output $outputStr\n' +
    'if ($exitCode -ne 0) {\n' +
    '  throw "win-acme exited with code $exitCode"\n' +
    '}\n',
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
  );

  // Parse the thumbprint from win-acme output.
  // win-acme outputs lines like: "Store with CertificateStore: [thumbprint]"
  // or "Certificate [hostname] created" with thumbprint in the log.
  const thumbprintMatch = result.match(/([0-9A-Fa-f]{40})/);
  if (!thumbprintMatch) {
    logger(deployFolder, 'error', `Could not parse certificate thumbprint from win-acme output`);
    throw new DeploymentError(
      `Failed to parse certificate thumbprint from win-acme output for ${hostname}`,
      DeploymentErrorCodes.IIS_SSL_PROVISIONING_FAILED,
      { hostname, output: result.substring(0, 500) },
    );
  }

  const thumbprint = thumbprintMatch[1].toUpperCase();
  logger(deployFolder, 'info', `Certificate provisioned with thumbprint: ${thumbprint.substring(0, 8)}...`);

  // Read the expiry date from the certificate store
  const expiryResult = await executePowerShellOrThrow(
    `
    $cert = Get-ChildItem 'Cert:\\LocalMachine\\WebHosting' | Where-Object { $_.Thumbprint -eq '${escapePowerShellString(thumbprint)}' }
    if ($cert) {
      Write-Output $cert.NotAfter.ToString('o')
    } else {
      $cert = Get-ChildItem 'Cert:\\LocalMachine\\My' | Where-Object { $_.Thumbprint -eq '${escapePowerShellString(thumbprint)}' }
      if ($cert) {
        Write-Output $cert.NotAfter.ToString('o')
      } else {
        Write-Output ''
      }
    }
    `,
    logger,
    deployFolder,
  );

  const expiryDate = expiryResult.trim();
  if (expiryDate) {
    logger(deployFolder, 'info', `Certificate expires: ${expiryDate}`);
  }

  return {
    thumbprint,
    expiryDate: expiryDate || '',
    domain: hostname,
  };
}
