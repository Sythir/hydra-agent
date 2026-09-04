import { IisBinding, ExistingBinding } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

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
        sslFlags = [int]$binding.sslFlags
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

export interface BindingConflict {
  siteName: string;
  protocol: string;
  bindingInformation: string;
}

function bindingInformationOf(binding: IisBinding): string {
  return `${binding.ipAddress || '*'}:${binding.port}:${binding.hostHeader || ''}`;
}

/**
 * Finds bindings on OTHER sites that are identical to the ones we are about to configure.
 * IIS accepts such a configuration but HTTP.SYS refuses the URL registration, which surfaces
 * as "Cannot create a file when that file already exists. (0x800700B7)" when starting the site.
 */
export async function findBindingConflicts(
  siteName: string,
  bindings: IisBinding[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<BindingConflict[]> {
  if (bindings.length === 0) {
    return [];
  }

  const result = await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    $target = '${escapePowerShellString(siteName)}'
    $all = @()
    foreach ($site in Get-Website) {
      if ($site.Name -eq $target) { continue }
      foreach ($b in $site.Bindings.Collection) {
        $all += @{
          siteName = $site.Name
          protocol = $b.protocol
          bindingInformation = $b.bindingInformation
        }
      }
    }
    $all | ConvertTo-Json -Compress
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );

  let otherBindings: BindingConflict[] = [];
  try {
    if (result && result !== 'null' && result !== '') {
      const parsed = JSON.parse(result);
      otherBindings = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    logger(deployFolder, 'warning', 'Could not parse bindings of other sites, skipping conflict check');
    return [];
  }

  const wanted = new Map<string, IisBinding>();
  for (const binding of bindings) {
    wanted.set(`${binding.protocol}|${bindingInformationOf(binding)}`, binding);
  }

  return otherBindings.filter(
    (other) => other.bindingInformation && wanted.has(`${other.protocol}|${other.bindingInformation}`),
  );
}

/**
 * Fails the deployment before anything is changed when another site already owns one of the
 * requested bindings, instead of letting Start-Website fail later with an opaque HRESULT.
 */
export async function assertNoBindingConflicts(
  siteName: string,
  bindings: IisBinding[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const conflicts = await findBindingConflicts(siteName, bindings, logger, deployFolder);
  if (conflicts.length === 0) {
    return;
  }

  const details = conflicts
    .map((conflict) => `${conflict.protocol} ${conflict.bindingInformation} is already used by site '${conflict.siteName}'`)
    .join('; ');

  logger(deployFolder, 'error', `Binding conflict detected: ${details}`);
  throw new DeploymentError(
    `Cannot configure bindings for site '${siteName}': ${details}. Remove or change the conflicting binding(s) first.`,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
    { conflicts },
  );
}

export async function removeAllBindings(
  siteName: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Removing all existing bindings from site: ${siteName}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Get-WebBinding -Name '${escapePowerShellString(siteName)}' | Remove-WebBinding -Confirm:$false
    $remaining = @(Get-WebBinding -Name '${escapePowerShellString(siteName)}').Count
    if ($remaining -gt 0) {
      throw "Failed to remove all bindings, $remaining binding(s) remain"
    }
    Write-Output "All bindings removed"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );
}

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

export async function addHttpsBinding(
  siteName: string,
  binding: IisBinding,
  thumbprint: string | undefined,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const sslFlags = binding.requireSni ? 1 : 0;
  logger(
    deployFolder,
    'info',
    `Adding HTTPS binding: ${binding.ipAddress}:${binding.port}:${binding.hostHeader || '(none)'} (SNI: ${binding.requireSni ? 'enabled' : 'disabled'})`,
  );

  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${binding.port} -IPAddress '${escapePowerShellString(binding.ipAddress)}' -HostHeader '${escapePowerShellString(binding.hostHeader || '')}' -SslFlags ${sslFlags}
    Write-Output "HTTPS binding added"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );

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

  let existingCerts = new Map<string, string>();
  if (preserveSslCertificates) {
    logger(deployFolder, 'info', 'Preserving existing SSL certificates');
    existingCerts = await getExistingHttpsBindings(siteName, logger, deployFolder);
    logger(deployFolder, 'info', `Found ${existingCerts.size} existing HTTPS binding(s) with certificates`);
  }

  await removeAllBindings(siteName, logger, deployFolder);

  for (const binding of bindings) {
    if (binding.protocol === 'https') {
      const key = `${binding.port}:${binding.hostHeader || ''}`;
      const thumbprint = binding.sslCertificateThumbprint || existingCerts.get(key);
      await addHttpsBinding(siteName, binding, thumbprint, logger, deployFolder);
    } else {
      await addHttpBinding(siteName, binding, logger, deployFolder);
    }
  }

  logger(deployFolder, 'info', 'All bindings configured successfully');
}

export async function restoreBindings(
  siteName: string,
  bindings: ExistingBinding[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  if (bindings.length === 0) {
    logger(deployFolder, 'info', 'No original bindings to restore');
    return;
  }

  logger(deployFolder, 'info', `Restoring ${bindings.length} original binding(s) for site: ${siteName}`);

  await removeAllBindings(siteName, logger, deployFolder);

  for (const binding of bindings) {
    if (binding.protocol === 'https') {
      const sslFlags = binding.sslFlags ?? 0;
      await executePowerShellOrThrow(
        `
        Import-Module WebAdministration
        New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${binding.port} -IPAddress '${escapePowerShellString(binding.ipAddress)}' -HostHeader '${escapePowerShellString(binding.hostHeader || '')}' -SslFlags ${sslFlags}
        Write-Output "HTTPS binding restored"
        `,
        logger,
        deployFolder,
        DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
      );

      if (binding.thumbprint) {
        await executePowerShellOrThrow(
          `
          Import-Module WebAdministration
          $b = Get-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${binding.port} -HostHeader '${escapePowerShellString(binding.hostHeader || '')}'
          if ($b) {
            $b.AddSslCertificate('${escapePowerShellString(binding.thumbprint)}', 'My')
            Write-Output "SSL certificate restored"
          } else {
            throw "Could not find HTTPS binding to restore certificate"
          }
          `,
          logger,
          deployFolder,
          DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
        );
      }
    } else {
      await executePowerShellOrThrow(
        `
        Import-Module WebAdministration
        New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'http' -Port ${binding.port} -IPAddress '${escapePowerShellString(binding.ipAddress)}' -HostHeader '${escapePowerShellString(binding.hostHeader || '')}'
        Write-Output "HTTP binding restored"
        `,
        logger,
        deployFolder,
        DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
      );
    }
  }

  logger(deployFolder, 'info', 'Original bindings restored successfully');
}
