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
 * Describes a kubectl invocation for logs and error messages.
 *
 * Only the subcommand and non-flag-looking tokens are included. Everything that starts with a dash
 * is replaced, because a kubectl flag can legitimately carry a token or a kubeconfig path and these
 * strings end up in deployment logs that are shown in the web UI.
 */
export function describeArgs(args: string[]): string {
  return args.map((arg) => (arg.startsWith('-') && arg.includes('=') ? `${arg.split('=')[0]}=<redacted>` : arg)).join(' ');
}

/** Reduces a result to a short human-readable reason. */
export function describeFailure(result: KubectlResult): string {
  return (result.stderr || result.stdout || 'no output').trim();
}

/**
 * Runs kubectl with the given arguments.
 *
 * Arguments are passed as an array and the process is spawned without a shell, so manifest paths,
 * namespaces and resource names can never be interpreted as shell syntax. Note that this alone does
 * not make a value safe: kubectl still parses a leading dash as a flag, so callers must validate
 * identifiers (see validation.ts) before passing them.
 */
export async function executeKubectl(
  args: string[],
  logger: LoggerFunc,
  deployFolder: string,
  timeoutMs: number = 60000,
): Promise<KubectlResult> {
  return new Promise((resolve) => {
    // detached puts kubectl in its own process group so the timeout path can kill any helper it
    // spawned (credential and exec auth plugins) rather than orphaning them on a long-lived agent.
    const childProcess = spawn('kubectl', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    // A spawn failure emits both 'error' and 'close', so a single guard is needed rather than one
    // flag per path, otherwise the first result is overwritten by a less informative second one.
    let settled = false;

    const settle = (result: KubectlResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      childProcess.stdout?.removeAllListeners();
      childProcess.stderr?.removeAllListeners();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      if (childProcess.pid) {
        try {
          // Negative pid targets the whole process group.
          process.kill(-childProcess.pid, 'SIGKILL');
        } catch {
          try {
            process.kill(childProcess.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }
      logger(deployFolder, 'error', `kubectl ${args[0]} timed out after ${timeoutMs / 1000} seconds`);
      settle({ success: false, stdout, stderr: 'Command timed out', exitCode: null });
    }, timeoutMs);

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('error', (error) => {
      settle({
        success: false,
        stdout,
        stderr: `Failed to start kubectl: ${error.message}`,
        exitCode: null,
      });
    });

    childProcess.on('close', (code) => {
      settle({ success: code === 0, stdout, stderr, exitCode: code });
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
    const summary = `kubectl ${describeArgs(args)} failed: ${describeFailure(result)}`;
    logger(deployFolder, 'error', summary);
    throw new DeploymentError(summary, errorCode, { command: args[0], exitCode: result.exitCode });
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
    throw new DeploymentError(
      `kubectl cannot reach the cluster: ${describeFailure(cluster)}. Check the agent's kubeconfig.`,
      DeploymentErrorCodes.K8S_CLUSTER_UNREACHABLE,
    );
  }
}
