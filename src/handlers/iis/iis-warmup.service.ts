import { IisBinding } from '../../types/iis';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { executePowerShell, escapePowerShellString } from './powershell.service';

const DEFAULT_WARMUP_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 15000;

interface ProbeTarget {
  url: string;
  hostHeader: string;
}

/**
 * Picks the binding to probe. HTTP is preferred over HTTPS because it sidesteps certificate and SNI
 * handling entirely - we only care whether a worker process answers, not how it answers.
 */
function selectProbeTarget(bindings: IisBinding[]): ProbeTarget | null {
  const candidate = bindings.find((binding) => binding.protocol === 'http') ?? bindings[0];
  if (!candidate) {
    return null;
  }

  const hostHeader = candidate.hostHeader?.trim() ?? '';
  const boundIp = candidate.ipAddress && candidate.ipAddress !== '*' ? candidate.ipAddress : '127.0.0.1';

  // Connecting on the host header (when there is one) keeps both the Host header and the TLS SNI
  // name correct, which is what a host-header or SNI binding matches on.
  const connectHost = hostHeader || boundIp;

  return {
    url: `${candidate.protocol}://${connectHost}:${candidate.port}/`,
    hostHeader,
  };
}

/**
 * Polls the site until a worker process answers, so a deployment is only reported as finished once
 * the new release is actually serving. Requests that arrive during this window queue behind the
 * starting worker instead of failing, which is the point of the overlapped swap.
 *
 * A run of 503s is treated as a hard failure - that is IIS saying the app pool could not start the
 * new release, and the caller should roll back. Connection-level failures (DNS, a probe that cannot
 * reach the binding from this host) only warn: they say nothing about the app itself.
 */
export async function warmupSite(
  siteName: string,
  bindings: IisBinding[],
  logger: LoggerFunc,
  deployFolder: string,
  timeoutMs: number = DEFAULT_WARMUP_TIMEOUT_MS,
): Promise<void> {
  const target = selectProbeTarget(bindings);
  if (!target) {
    logger(deployFolder, 'warning', `No bindings to warm up site '${siteName}' on, skipping warmup`);
    return;
  }

  logger(deployFolder, 'info', `Warming up site '${siteName}' via ${target.url}`);

  const hostHeaderLine = target.hostHeader
    ? `$request.Host = '${escapePowerShellString(target.hostHeader)}'`
    : '# no host header on this binding';

  const script = `
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

    $deadline = (Get-Date).AddMilliseconds(${timeoutMs})
    $lastError = 'no response'
    $sawUnavailable = $false

    while ((Get-Date) -lt $deadline) {
      try {
        $request = [System.Net.HttpWebRequest]::Create('${escapePowerShellString(target.url)}')
        $request.Method = 'GET'
        $request.Timeout = ${PROBE_TIMEOUT_MS}
        $request.AllowAutoRedirect = $false
        ${hostHeaderLine}

        $response = $request.GetResponse()
        $status = [int]$response.StatusCode
        $response.Close()
        Write-Output "WARMUP_OK $status"
        exit 0
      } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($response) {
          $status = [int]$response.StatusCode
          $response.Close()
          if ($status -eq 503) {
            # App pool is refusing to hand the request to a worker - keep waiting, it may still come up.
            $sawUnavailable = $true
            $lastError = "HTTP 503 Service Unavailable"
          } else {
            # Any other status means a worker answered. 401/403/404/500 are the app's business.
            Write-Output "WARMUP_OK $status"
            exit 0
          }
        } else {
          $lastError = $_.Exception.Message
        }
      } catch {
        $lastError = $_.Exception.Message
      }

      Start-Sleep -Milliseconds 500
    }

    if ($sawUnavailable) {
      Write-Output "WARMUP_UNAVAILABLE $lastError"
    } else {
      Write-Output "WARMUP_UNREACHABLE $lastError"
    }
    exit 0
  `;

  const result = await executePowerShell(script, logger, deployFolder, timeoutMs + PROBE_TIMEOUT_MS + 30000);
  const output = result.stdout || result.stderr;

  if (output.includes('WARMUP_OK')) {
    logger(deployFolder, 'info', `Site '${siteName}' is serving requests (${output.trim()})`);
    return;
  }

  if (output.includes('WARMUP_UNAVAILABLE')) {
    throw new DeploymentError(
      `Site '${siteName}' still returns 503 after ${timeoutMs / 1000}s - the app pool could not start the new release`,
      DeploymentErrorCodes.IIS_START_FAILED,
      { siteName, probeUrl: target.url },
    );
  }

  logger(
    deployFolder,
    'warning',
    `Could not confirm site '${siteName}' is serving via ${target.url}: ${output.trim() || 'no output'}. ` +
      `The swap completed; verify the site manually if this keeps happening.`,
  );
}
