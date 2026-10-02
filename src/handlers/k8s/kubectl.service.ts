import { spawn } from 'child_process';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';

export interface KubectlResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs kubectl with the given arguments.
 *
 * Arguments are passed as an array and the process is spawned without a shell, so manifest paths,
 * namespaces and resource names coming from user configuration can never be interpreted as shell
 * syntax.
 */
export async function executeKubectl(
  args: string[],
  logger: LoggerFunc,
  deployFolder: string,
  timeoutMs: number = 60000,
): Promise<KubectlResult> {
  return new Promise((resolve) => {
    const childProcess = spawn('kubectl', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let hasTimedOut = false;

    const timeoutId = setTimeout(() => {
      hasTimedOut = true;
      if (childProcess.pid) {
        try {
          process.kill(childProcess.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      logger(deployFolder, 'error', `kubectl ${args[0]} timed out after ${timeoutMs / 1000} seconds`);
      resolve({ success: false, stdout, stderr: 'Command timed out', exitCode: null });
    }, timeoutMs);

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      if (hasTimedOut) return;
      resolve({
        success: false,
        stdout,
        stderr: `Failed to start kubectl: ${error.message}`,
        exitCode: null,
      });
    });

    childProcess.on('close', (code) => {
      clearTimeout(timeoutId);
      if (hasTimedOut) return;
      resolve({ success: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Runs kubectl and throws a DeploymentError when it fails, so callers that cannot continue do not
 * have to repeat the same error handling.
 */
export async function executeKubectlOrThrow(
  args: string[],
  logger: LoggerFunc,
  deployFolder: string,
  errorCode: string,
  timeoutMs?: number,
): Promise<KubectlResult> {
  const result = await executeKubectl(args, logger, deployFolder, timeoutMs);

  if (!result.success) {
    const detail = (result.stderr || result.stdout || 'no output').trim();
    logger(deployFolder, 'error', `kubectl ${args.join(' ')} failed: ${detail}`);
    throw new DeploymentError(`kubectl ${args.join(' ')} failed: ${detail}`, errorCode, {
      args,
      exitCode: result.exitCode,
    });
  }

  return result;
}

/**
 * Verifies kubectl is installed and can reach the cluster.
 *
 * Both halves matter: a missing binary and an unreachable or misconfigured cluster are entirely
 * different problems for whoever reads the deployment log, so they are reported separately rather
 * than as one generic failure.
 */
export async function checkKubectlAvailable(logger: LoggerFunc, deployFolder: string): Promise<void> {
  const version = await executeKubectl(['version', '--client=true', '-o', 'json'], logger, deployFolder, 15000);

  if (!version.success) {
    throw new DeploymentError(
      'kubectl is not available on this agent. Install kubectl and ensure it is on the agent PATH.',
      DeploymentErrorCodes.KUBECTL_NOT_AVAILABLE,
    );
  }

  const cluster = await executeKubectl(['cluster-info'], logger, deployFolder, 20000);

  if (!cluster.success) {
    const detail = (cluster.stderr || cluster.stdout || 'no output').trim();
    throw new DeploymentError(
      `kubectl cannot reach the cluster: ${detail}. Check the agent's kubeconfig.`,
      DeploymentErrorCodes.K8S_CLUSTER_UNREACHABLE,
    );
  }
}
