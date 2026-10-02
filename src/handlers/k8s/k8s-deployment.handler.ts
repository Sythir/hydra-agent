import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { load } from 'js-yaml';
import { Socket } from 'socket.io-client';
import { K8sDeploymentMessageDto, K8sResourceFile, K8sResourceRef } from '../../types/k8s';
import { LoggerFunc } from '../../utils/logMessage';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { SOCKET_EVENTS } from '../../config/constants';
import { executeKubectl, executeKubectlOrThrow, checkKubectlAvailable } from './kubectl.service';

/**
 * Apply order for the manifests the backend renders.
 *
 * The Service must exist before the workload so that a StatefulSet's headless Service and any
 * readiness-gated traffic are in place when pods start. Files not listed here are applied last, in
 * the order they arrived.
 */
const APPLY_ORDER = ['service.yaml', 'deployment.yaml', 'statefulset.yaml'];

function emitProgress(socket: Socket, deploymentId: string, step: string, message: string, progress: number): void {
  socket.emit(SOCKET_EVENTS.K8S_DEPLOYMENT_PROGRESS, {
    deploymentId,
    step,
    message,
    progress: Math.min(100, Math.max(0, progress)),
  });
}

function sortResourceFiles(files: K8sResourceFile[]): K8sResourceFile[] {
  return [...files].sort((a, b) => {
    const ai = APPLY_ORDER.indexOf(a.name);
    const bi = APPLY_ORDER.indexOf(b.name);
    return (ai === -1 ? APPLY_ORDER.length : ai) - (bi === -1 ? APPLY_ORDER.length : bi);
  });
}

/**
 * Reads kind and name straight out of the rendered YAML.
 *
 * The agent needs these to wait on the right rollout and to clean up the right objects, and the
 * manifest is the only trustworthy source: guessing from the file name breaks the moment the
 * backend renders something new.
 */
function readResourceRef(file: K8sResourceFile): K8sResourceRef | null {
  try {
    const parsed = load(file.data) as { kind?: unknown; metadata?: { name?: unknown } } | undefined;
    const kind = parsed?.kind;
    const name = parsed?.metadata?.name;
    if (typeof kind !== 'string' || typeof name !== 'string' || !kind || !name) return null;
    return { kind, name };
  } catch {
    return null;
  }
}

/** Only these kinds support `kubectl rollout status`. */
const ROLLOUT_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];

/**
 * Deploys the backend-rendered manifests to a Kubernetes cluster with kubectl.
 *
 * The backend owns manifest construction, so this handler is deliberately thin: it writes the YAML
 * to a per-deployment folder, ensures the namespace, server-side validates with a dry run, applies
 * in dependency order, then optionally waits for the rollout. The dry run matters because a
 * half-applied set of resources is much harder to reason about than a rejected one, so anything the
 * cluster will refuse is caught before the first real write.
 */
export async function handleK8sDeployment(
  message: K8sDeploymentMessageDto,
  logger: LoggerFunc,
  socket: Socket,
  deploymentId: string,
): Promise<ExecutionResultReturnType> {
  const deployFolder = path.join(os.tmpdir(), 'hydra-k8s', deploymentId);
  const applied: K8sResourceRef[] = [];
  const options = message.options;
  const namespace = options?.namespace || 'default';

  try {
    await fs.mkdir(deployFolder, { recursive: true });

    const resourceFiles = message.resourceFiles ?? [];
    if (resourceFiles.length === 0) {
      throw new DeploymentError(
        'No Kubernetes manifests were supplied for this step.',
        DeploymentErrorCodes.K8S_NO_RESOURCE_FILES,
      );
    }

    emitProgress(socket, deploymentId, 'prepare', 'Checking kubectl and cluster access', 5);
    await checkKubectlAvailable(logger, deployFolder);

    // Write manifests to disk. Applying from files rather than stdin means the exact manifest that
    // was applied is still on the agent afterwards, which is what makes a failed deploy debuggable.
    emitProgress(socket, deploymentId, 'prepare', 'Writing manifests', 15);
    const ordered = sortResourceFiles(resourceFiles);
    const written: { file: K8sResourceFile; filePath: string; ref: K8sResourceRef | null }[] = [];

    for (const file of ordered) {
      const filePath = path.join(deployFolder, file.name);
      try {
        await fs.writeFile(filePath, file.data, 'utf8');
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        throw new DeploymentError(
          `Failed to write manifest ${file.name}: ${detail}`,
          DeploymentErrorCodes.K8S_MANIFEST_WRITE_FAILED,
        );
      }
      written.push({ file, filePath, ref: readResourceRef(file) });
      logger(deployFolder, 'info', `Prepared manifest ${file.name}`);
    }

    // Namespace first: every later apply targets it, so creating it afterwards is useless.
    if (options?.createNamespace) {
      emitProgress(socket, deploymentId, 'namespace', `Ensuring namespace ${namespace}`, 25);
      const exists = await executeKubectl(['get', 'namespace', namespace], logger, deployFolder, 20000);

      if (exists.success) {
        logger(deployFolder, 'info', `Namespace ${namespace} already exists`);
      } else {
        logger(deployFolder, 'info', `Creating namespace ${namespace}`);
        await executeKubectlOrThrow(
          ['create', 'namespace', namespace],
          logger,
          deployFolder,
          DeploymentErrorCodes.K8S_NAMESPACE_CREATE_FAILED,
          30000,
        );
      }
    }

    // Server-side dry run. This catches schema errors, admission webhook rejections and immutable
    // field conflicts while nothing has been changed yet.
    emitProgress(socket, deploymentId, 'validate', 'Validating manifests against the cluster', 35);
    for (const { file, filePath } of written) {
      const dryRun = await executeKubectl(
        ['apply', '-f', filePath, '-n', namespace, '--dry-run=server'],
        logger,
        deployFolder,
        60000,
      );

      if (!dryRun.success) {
        const detail = (dryRun.stderr || dryRun.stdout || 'no output').trim();
        throw new DeploymentError(
          `Manifest ${file.name} was rejected by the cluster: ${detail}`,
          DeploymentErrorCodes.K8S_MANIFEST_INVALID,
        );
      }
      logger(deployFolder, 'info', `Validated ${file.name}`);
    }

    // Apply for real.
    const applyBase = 45;
    const applySpan = 30;
    for (let index = 0; index < written.length; index++) {
      const { file, filePath, ref } = written[index];
      emitProgress(
        socket,
        deploymentId,
        'apply',
        `Applying ${file.name}`,
        applyBase + Math.round((applySpan * index) / written.length),
      );

      const result = await executeKubectl(['apply', '-f', filePath, '-n', namespace], logger, deployFolder, 120000);

      if (!result.success) {
        const detail = (result.stderr || result.stdout || 'no output').trim();
        throw new DeploymentError(
          `Failed to apply ${file.name}: ${detail}`,
          DeploymentErrorCodes.K8S_APPLY_FAILED,
        );
      }

      if (ref) applied.push(ref);
      logger(deployFolder, 'info', result.stdout.trim() || `Applied ${file.name}`);
    }

    // Wait for the rollout. Without this the step reports success as soon as the API server accepts
    // the manifest, which says nothing about whether the new pods actually started.
    if (options?.waitForRollout) {
      const timeout = options.rolloutTimeout > 0 ? options.rolloutTimeout : 300;
      const rolloutTargets = applied.filter((ref) => ROLLOUT_KINDS.includes(ref.kind));

      for (const ref of rolloutTargets) {
        emitProgress(socket, deploymentId, 'rollout', `Waiting for ${ref.kind}/${ref.name} to roll out`, 80);
        logger(deployFolder, 'info', `Waiting up to ${timeout}s for ${ref.kind}/${ref.name} to roll out`);

        const rollout = await executeKubectl(
          [
            'rollout',
            'status',
            `${ref.kind.toLowerCase()}/${ref.name}`,
            '-n',
            namespace,
            `--timeout=${timeout}s`,
          ],
          logger,
          deployFolder,
          // Give kubectl a little longer than its own timeout so its message wins over ours.
          (timeout + 30) * 1000,
        );

        if (!rollout.success) {
          const detail = (rollout.stderr || rollout.stdout || 'no output').trim();
          throw new DeploymentError(
            `Rollout of ${ref.kind}/${ref.name} did not complete: ${detail}`,
            DeploymentErrorCodes.K8S_ROLLOUT_FAILED,
          );
        }
        logger(deployFolder, 'info', rollout.stdout.trim() || `${ref.kind}/${ref.name} rolled out`);
      }
    }

    emitProgress(socket, deploymentId, 'done', 'Kubernetes deployment complete', 100);
    logger(deployFolder, 'info', 'Kubernetes deployment completed successfully');
    return { succeeded: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    logger(deployFolder, 'error', `Kubernetes deployment failed: ${detail}`);

    if (options?.deleteOnFailure && applied.length > 0) {
      logger(deployFolder, 'info', 'Rolling back: deleting resources applied by this deployment');
      // Reverse order so the workload goes before the Service it depends on.
      for (const ref of [...applied].reverse()) {
        const remove = await executeKubectl(
          ['delete', `${ref.kind.toLowerCase()}/${ref.name}`, '-n', namespace, '--ignore-not-found'],
          logger,
          deployFolder,
          60000,
        );
        if (remove.success) {
          logger(deployFolder, 'info', `Deleted ${ref.kind}/${ref.name}`);
        } else {
          // Report but keep going: a failed cleanup must not mask the original error.
          logger(
            deployFolder,
            'warning',
            `Could not delete ${ref.kind}/${ref.name}: ${(remove.stderr || 'no output').trim()}`,
          );
        }
      }
    }

    return { succeeded: false, output: detail };
  }
}
