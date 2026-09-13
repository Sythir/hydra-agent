import { IisBinding, ExistingBinding } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShellOrThrow, escapePowerShellString } from './powershell.service';

/**
 * Stores that are searched when locating an SSL certificate by thumbprint. IIS serves certificates
 * from both; which one holds a given certificate depends on how it was imported (IIS Manager's
 * "Web Hosting" option, win-acme and Certify The Web all use WebHosting), so the store is never
 * assumed - assigning a certificate from the wrong store fails with the misleading
 * "A specified logon session does not exist (0x80070520)".
 */
const CERTIFICATE_STORES = ['My', 'WebHosting'];

export interface ResolvedCertificate {
  thumbprint: string;
  store: string;
}

interface CertificateLocation {
  thumbprint: string;
  store: string;
  hasPrivateKey: boolean;
}

interface CertificateRequest {
  key: string;
  thumbprint: string;
  preferredStore?: string;
  description: string;
}

/** Strips the invisible characters that ride along when a thumbprint is copied out of certmgr. */
export function normalizeThumbprint(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

function certificateKey(port: number, hostHeader: string | undefined): string {
  return `${port}:${hostHeader || ''}`;
}

function bindingKey(protocol: string, ipAddress: string | undefined, port: number, hostHeader: string | undefined): string {
  return `${protocol}|${ipAddress || '*'}:${port}:${hostHeader || ''}`;
}

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
      $store = $null
      if ($binding.protocol -eq 'https') {
        try {
          $cert = $binding.certificateHash
          if ($cert -is [byte[]]) {
            $cert = ($cert | ForEach-Object { $_.ToString('X2') }) -join ''
          }
          $store = $binding.certificateStoreName
        } catch {}
      }
      @{
        protocol = $binding.protocol
        ipAddress = $info[0]
        port = [int]$info[1]
        hostHeader = if ($info.Length -gt 2) { $info[2] } else { '' }
        thumbprint = $cert
        certificateStoreName = $store
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
): Promise<Map<string, ExistingBinding>> {
  const bindings = await getExistingBindings(siteName, logger, deployFolder);
  const httpsBindings = new Map<string, ExistingBinding>();

  for (const binding of bindings) {
    if (binding.protocol === 'https' && binding.thumbprint) {
      httpsBindings.set(certificateKey(binding.port, binding.hostHeader), binding);
    }
  }

  return httpsBindings;
}

/**
 * Reports every store that holds each thumbprint, so the caller can tell "certificate is missing"
 * apart from "certificate is present but its private key is not".
 */
async function findCertificateLocations(
  thumbprints: string[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<CertificateLocation[]> {
  if (thumbprints.length === 0) {
    return [];
  }

  const wanted = thumbprints.map((thumbprint) => `'${escapePowerShellString(thumbprint)}'`).join(',');
  const stores = CERTIFICATE_STORES.map((store) => `'${store}'`).join(',');

  const result = await executePowerShellOrThrow(
    `
    $wanted = @(${wanted})
    $found = @()
    foreach ($store in @(${stores})) {
      $storePath = "Cert:\\LocalMachine\\$store"
      if (-not (Test-Path $storePath)) { continue }
      foreach ($cert in Get-ChildItem $storePath) {
        if ($wanted -contains $cert.Thumbprint.ToUpper()) {
          $found += @{
            thumbprint = $cert.Thumbprint.ToUpper()
            store = $store
            hasPrivateKey = [bool]$cert.HasPrivateKey
          }
        }
      }
    }
    ConvertTo-Json -Compress -InputObject @($found)
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );

  try {
    if (!result || result === 'null' || result === '') {
      return [];
    }
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    logger(deployFolder, 'warning', 'Could not parse certificate store listing');
    return [];
  }
}

/**
 * Locates each requested certificate and picks the store it will be assigned from. Throws before
 * any binding is touched when a certificate is missing or unusable.
 */
export async function resolveCertificateStores(
  requests: CertificateRequest[],
  logger: LoggerFunc,
  deployFolder: string,
): Promise<Map<string, ResolvedCertificate>> {
  const resolved = new Map<string, ResolvedCertificate>();
  if (requests.length === 0) {
    return resolved;
  }

  const thumbprints = Array.from(
    new Set(requests.map((request) => normalizeThumbprint(request.thumbprint)).filter((thumbprint) => thumbprint !== '')),
  );
  const locations = await findCertificateLocations(thumbprints, logger, deployFolder);
  const searched = CERTIFICATE_STORES.map((store) => `LocalMachine\\${store}`).join(' or ');

  const problems: string[] = [];

  for (const request of requests) {
    const thumbprint = normalizeThumbprint(request.thumbprint);
    if (!thumbprint) {
      problems.push(`${request.description}: '${request.thumbprint}' is not a valid certificate thumbprint`);
      continue;
    }

    const matches = locations.filter((location) => location.thumbprint === thumbprint);
    if (matches.length === 0) {
      problems.push(`${request.description}: certificate ${thumbprint} was not found in ${searched}`);
      continue;
    }

    const usable = matches.filter((location) => location.hasPrivateKey);
    if (usable.length === 0) {
      problems.push(
        `${request.description}: certificate ${thumbprint} exists in ${matches
          .map((location) => location.store)
          .join(', ')} but has no usable private key`,
      );
      continue;
    }

    const preferred = request.preferredStore
      ? usable.find((location) => location.store.toLowerCase() === request.preferredStore!.toLowerCase())
      : undefined;
    const chosen = preferred ?? usable[0];

    if (request.preferredStore && !preferred) {
      logger(
        deployFolder,
        'warning',
        `${request.description}: certificate not present in store '${request.preferredStore}', using '${chosen.store}' instead`,
      );
    }

    logger(
      deployFolder,
      'info',
      `${request.description}: certificate ${thumbprint.substring(0, 8)}... resolved to store '${chosen.store}'`,
    );
    resolved.set(request.key, { thumbprint, store: chosen.store });
  }

  if (problems.length > 0) {
    const details = problems.join('; ');
    logger(deployFolder, 'error', `SSL certificate validation failed: ${details}`);
    throw new DeploymentError(
      `SSL certificate validation failed: ${details}`,
      DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
      { problems },
    );
  }

  return resolved;
}

async function collectCertificateRequests(
  siteName: string,
  bindings: IisBinding[],
  preserveSslCertificates: boolean,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<CertificateRequest[]> {
  const httpsBindings = bindings.filter((binding) => binding.protocol === 'https');
  if (httpsBindings.length === 0) {
    return [];
  }

  let existing = new Map<string, ExistingBinding>();
  if (preserveSslCertificates) {
    try {
      existing = await getExistingHttpsBindings(siteName, logger, deployFolder);
      logger(deployFolder, 'info', `Found ${existing.size} existing HTTPS binding(s) with certificates`);
    } catch (error) {
      // The site may not exist yet on a first deployment - there is then nothing to preserve.
      logger(
        deployFolder,
        'warning',
        `Could not read existing bindings of site '${siteName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const requests: CertificateRequest[] = [];
  for (const binding of httpsBindings) {
    const key = certificateKey(binding.port, binding.hostHeader);
    const preserved = existing.get(key);
    const thumbprint = binding.sslCertificateThumbprint || preserved?.thumbprint;
    if (!thumbprint) {
      continue;
    }
    requests.push({
      key,
      thumbprint,
      preferredStore: binding.sslCertificateStoreName || preserved?.certificateStoreName || undefined,
      description: `HTTPS binding ${binding.ipAddress || '*'}:${binding.port}:${binding.hostHeader || '(none)'}`,
    });
  }

  return requests;
}

/**
 * Pre-flight check: every certificate the deployment will need must exist and be usable before the
 * live bindings are torn down.
 */
export async function assertCertificatesAvailable(
  siteName: string,
  bindings: IisBinding[],
  preserveSslCertificates: boolean,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const requests = await collectCertificateRequests(siteName, bindings, preserveSslCertificates, logger, deployFolder);
  if (requests.length === 0) {
    return;
  }
  logger(deployFolder, 'info', `Validating ${requests.length} SSL certificate(s) before changing bindings`);
  await resolveCertificateStores(requests, logger, deployFolder);
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

export async function removeBinding(
  siteName: string,
  protocol: string,
  ipAddress: string,
  port: number,
  hostHeader: string,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(deployFolder, 'info', `Removing ${protocol} binding: ${ipAddress || '*'}:${port}:${hostHeader || '(none)'}`);
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    Remove-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol '${escapePowerShellString(protocol)}' -IPAddress '${escapePowerShellString(ipAddress || '*')}' -Port ${port} -HostHeader '${escapePowerShellString(hostHeader || '')}' -Confirm:$false
    Write-Output "Binding removed"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );
}

async function createBinding(
  siteName: string,
  protocol: string,
  ipAddress: string,
  port: number,
  hostHeader: string,
  sslFlags: number,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const sslFlagsArgument = protocol === 'https' ? ` -SslFlags ${sslFlags}` : '';
  await executePowerShellOrThrow(
    `
    Import-Module WebAdministration
    New-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol '${escapePowerShellString(protocol)}' -Port ${port} -IPAddress '${escapePowerShellString(ipAddress || '*')}' -HostHeader '${escapePowerShellString(hostHeader || '')}'${sslFlagsArgument}
    Write-Output "Binding added"
    `,
    logger,
    deployFolder,
    DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
  );
}

async function assignCertificate(
  siteName: string,
  port: number,
  hostHeader: string,
  certificate: ResolvedCertificate,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  logger(
    deployFolder,
    'info',
    `Assigning SSL certificate ${certificate.thumbprint.substring(0, 8)}... from store '${certificate.store}'`,
  );

  try {
    await executePowerShellOrThrow(
      `
      Import-Module WebAdministration
      $binding = Get-WebBinding -Name '${escapePowerShellString(siteName)}' -Protocol 'https' -Port ${port} -HostHeader '${escapePowerShellString(hostHeader || '')}'
      if ($binding) {
        $binding.AddSslCertificate('${escapePowerShellString(certificate.thumbprint)}', '${escapePowerShellString(certificate.store)}')
        Write-Output "SSL certificate assigned"
      } else {
        throw "Could not find HTTPS binding to assign certificate"
      }
      `,
      logger,
      deployFolder,
      DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 0x80070520 reads as a logon-session error but means IIS could not use the certificate from
    // the given store - wrong store, or a private key it cannot open.
    const hint = message.includes('0x80070520')
      ? ` (certificate ${certificate.thumbprint} could not be used from store '${certificate.store}'; verify the certificate is in that LocalMachine store and its private key is readable by the account running the agent)`
      : '';
    throw new DeploymentError(
      `Failed to assign SSL certificate to ${port}:${hostHeader || '(none)'}: ${message}${hint}`,
      DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
      { thumbprint: certificate.thumbprint, store: certificate.store },
    );
  }
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
  await createBinding(siteName, 'http', binding.ipAddress, binding.port, binding.hostHeader, 0, logger, deployFolder);
}

export async function addHttpsBinding(
  siteName: string,
  binding: IisBinding,
  certificate: ResolvedCertificate | undefined,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<void> {
  const sslFlags = binding.requireSni ? 1 : 0;
  logger(
    deployFolder,
    'info',
    `Adding HTTPS binding: ${binding.ipAddress}:${binding.port}:${binding.hostHeader || '(none)'} (SNI: ${binding.requireSni ? 'enabled' : 'disabled'})`,
  );

  await createBinding(siteName, 'https', binding.ipAddress, binding.port, binding.hostHeader, sslFlags, logger, deployFolder);

  if (certificate) {
    await assignCertificate(siteName, binding.port, binding.hostHeader, certificate, logger, deployFolder);
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

  if (preserveSslCertificates) {
    logger(deployFolder, 'info', 'Preserving existing SSL certificates');
  }

  // Resolve every certificate before removing anything: a certificate problem must not leave the
  // site without bindings.
  const requests = await collectCertificateRequests(siteName, bindings, preserveSslCertificates, logger, deployFolder);
  const certificates = await resolveCertificateStores(requests, logger, deployFolder);

  await removeAllBindings(siteName, logger, deployFolder);

  for (const binding of bindings) {
    if (binding.protocol === 'https') {
      await addHttpsBinding(siteName, binding, certificates.get(certificateKey(binding.port, binding.hostHeader)), logger, deployFolder);
    } else {
      await addHttpBinding(siteName, binding, logger, deployFolder);
    }
  }

  logger(deployFolder, 'info', 'All bindings configured successfully');
}

async function resolveCertificateForRestore(
  binding: ExistingBinding,
  logger: LoggerFunc,
  deployFolder: string,
): Promise<ResolvedCertificate | undefined> {
  if (!binding.thumbprint) {
    return undefined;
  }

  const key = certificateKey(binding.port, binding.hostHeader);
  try {
    const resolved = await resolveCertificateStores(
      [
        {
          key,
          thumbprint: binding.thumbprint,
          preferredStore: binding.certificateStoreName || undefined,
          description: `Original HTTPS binding ${binding.ipAddress || '*'}:${binding.port}:${binding.hostHeader || '(none)'}`,
        },
      ],
      logger,
      deployFolder,
    );
    const certificate = resolved.get(key);
    if (certificate) {
      return certificate;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(deployFolder, 'warning', `Could not resolve original certificate store, falling back: ${message}`);
  }

  return {
    thumbprint: normalizeThumbprint(binding.thumbprint),
    store: binding.certificateStoreName || CERTIFICATE_STORES[0],
  };
}

/**
 * Restores the bindings a site had before the deployment. Additive by design: bindings that are
 * already correct are left alone and only unexpected ones are removed, so a failure part way
 * through cannot leave the site with fewer bindings than it started with. Every binding is
 * attempted even if an earlier one fails; the collected failures are reported at the end.
 */
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

  const current = await getExistingBindings(siteName, logger, deployFolder);
  const wanted = new Set(bindings.map((binding) => bindingKey(binding.protocol, binding.ipAddress, binding.port, binding.hostHeader)));
  const present = new Set(current.map((binding) => bindingKey(binding.protocol, binding.ipAddress, binding.port, binding.hostHeader)));

  const failures: string[] = [];

  for (const binding of current) {
    const key = bindingKey(binding.protocol, binding.ipAddress, binding.port, binding.hostHeader);
    if (wanted.has(key)) {
      continue;
    }
    try {
      await removeBinding(siteName, binding.protocol, binding.ipAddress, binding.port, binding.hostHeader, logger, deployFolder);
    } catch (error) {
      failures.push(`could not remove ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const binding of bindings) {
    const key = bindingKey(binding.protocol, binding.ipAddress, binding.port, binding.hostHeader);

    if (!present.has(key)) {
      try {
        await createBinding(
          siteName,
          binding.protocol,
          binding.ipAddress,
          binding.port,
          binding.hostHeader,
          binding.sslFlags ?? 0,
          logger,
          deployFolder,
        );
        logger(deployFolder, 'info', `Restored ${binding.protocol} binding: ${key}`);
      } catch (error) {
        failures.push(`could not restore ${key}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    if (binding.protocol !== 'https' || !binding.thumbprint) {
      continue;
    }

    try {
      const certificate = await resolveCertificateForRestore(binding, logger, deployFolder);
      if (certificate) {
        await assignCertificate(siteName, binding.port, binding.hostHeader, certificate, logger, deployFolder);
      }
    } catch (error) {
      failures.push(`could not restore certificate for ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new DeploymentError(
      `Original bindings only partially restored: ${failures.join('; ')}`,
      DeploymentErrorCodes.IIS_BINDING_CONFIG_FAILED,
      { failures },
    );
  }

  logger(deployFolder, 'info', 'Original bindings restored successfully');
}
