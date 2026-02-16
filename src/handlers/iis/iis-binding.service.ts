import { IisBinding, ExistingBinding } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

/**
 * Gets all existing bindings for a website
 */
export async function getExistingBindings(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<ExistingBinding[]> {
  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $bindings = Get-WebBinding -Name '${escapePowerShellString(siteName)}' | ForEach-Object {
      $binding = $_
      $info = $binding.bindingInformation -split ':'
      $cert = $null
      if ($binding.protocol -eq 'https') {
        try {
          $cert = $binding.certificateHash
        } catch {}
      }
      @{
        protocol = $binding.protocol
        ipAddress = $info[0]
        port = [int]$info[1]
        hostHeader = if ($info.Length -gt 2) { $info[2] } else { '' }
        thumbprint = $cert
      }
    }
    $bindings | ConvertTo-Json -Compress
    `,
    logger,
    deployFolder,
  );

  try {
    if (!result || result === 'null' || result === '') {
      return [];
    }
    const parsed = JSON.parse(result);
    // PowerShell returns single object instead of array when there's only one item
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    logger(deployFolder, 'warning', 'Could not parse existing bindings, assuming none exist');
    return [];
  }
}

export async function getExistingHttpsBindings(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<Map<string, string>> {
  const bindings = await getExistingBindings(siteName, logger, deployFolder);
  const httpsBindings = new Map<string, string>();

  for (const binding of bindings) {
    if (binding.protocol === 'https' && binding.thumbprint) {
      const key = `${binding.port}:${binding.hostHeader || ''}`;
      httpsBindings.set(key, binding.thumbprint);
    }
  }

  return httpsBindings;
}

/**
 * Removes all bindings from a website
 */
export async function removeAllBindings(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Removing all existing bindings from site: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Get-WebBinding -Name '${escapePowerShellString(siteName)}' | Remove-WebBinding
    Write-Output "All bindings removed"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );
}

/**
 * Adds an HTTP binding to a website
 */
export async function addHttpBinding(
  siteName: string,
  binding: IisBinding,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(
    deployFolder,
    'info',
    `Adding HTTP binding: ${binding.ipAddress}:${binding.port}:${binding.hostHeader || '(none)'}`,
  );
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'http' -Port ${binding.port} -IPAddress '${escapePowerShellString(binding.ipAddress)}' -HostHeader '${escapePowerShellString(binding.hostHeader || '')}'
    Write-Output "HTTP binding added"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );
}

/**
 * Adds an HTTPS binding with SSL certificate to a website
 */
export async function addHttpsBinding(
  siteName: string,
  binding: IisBinding,
  thumbprint: string | undefined,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(
    deployFolder,
    'info',
    `Adding HTTPS binding: ${binding.ipAddress}:${binding.port}:${binding.hostHeader || '(none)'}`,
  );

  // First create the binding
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${binding.port} -IPAddress '${escapePowerShellString(binding.ipAddress)}' -HostHeader '${escapePowerShellString(binding.hostHeader || '')}'
    Write-Output "HTTPS binding added"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );

  // Then assign the certificate if provided
  if (thumbprint) {
    logger(deployFolder, 'info', `Assigning SSL certificate with thumbprint: ${thumbprint.substring(0, 8)}...`);
    await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $binding = Get-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${binding.port} -HostHeader '${escapePowerShellString(binding.hostHeader || '')}'
      if ($binding) {
        $binding.AddSslCertificate('${escapePowerShellString(thumbprint)}', 'My')
        Write-Output "SSL certificate assigned"
      } else {
        throw "Could not find HTTPS binding to assign certificate"
      }
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
    );
  } else {
    logger(deployFolder, 'warning', 'No SSL certificate thumbprint provided for HTTPS binding');
  }
}

/**
 * Configures all bindings for a website, optionally preserving SSL certificates
 */
export async function configureBindings(
  siteName: string,
  bindings: IisBinding[],
  preserveSslCertificates: boolean,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  if (bindings.length === 0) {
    logger(deployFolder, 'info', 'No bindings to configure');
    return;
  }

  logger(deployFolder, 'info', `Configuring ${bindings.length} binding(s) for site: ${siteName}`);

  // Step 1: Capture existing HTTPS certificates if preservation is enabled
  let existingCerts = new Map<string, string>();
  if (preserveSslCertificates) {
    logger(deployFolder, 'info', 'Preserving existing SSL certificates');
    existingCerts = await getExistingHttpsBindings(siteName, logger, deployFolder);
    logger(deployFolder, 'info', `Found ${existingCerts.size} existing HTTPS binding(s) with certificates`);
  }

  // Step 2: Remove all existing bindings
  await removeAllBindings(siteName, logger, deployFolder);

  // Step 3: Add new bindings
  for (const binding of bindings) {
    if (binding.protocol === 'https') {
      // Use incoming thumbprint if provided, otherwise use preserved thumbprint
      const key = `${binding.port}:${binding.hostHeader || ''}`;
      const thumbprint = binding.sslCertificateThumbprint || existingCerts.get(key);
      await addHttpsBinding(siteName, binding, thumbprint, logger, deployFolder);
    } else {
      await addHttpBinding(siteName, binding, logger, deployFolder);
    }
  }

  logger(deployFolder, 'info', 'All bindings configured successfully');
}
