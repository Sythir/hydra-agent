import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { loadAll } from 'js-yaml';
import { Socket } from 'socket.io-client';
import { K8sDeploymentMessageDto, K8sResourceFile, K8sResourceRef } from '../../types/k8s';
import { LoggerFunc } from '../../utils/logMessage';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';
import { SOCKET_EVENTS } from '../../config/constants';
import { executeKubectl, executeKubectlOrThrow, checkKubectlAvailable, describeFailure } from './kubectl.service';
import {
  assertValidNamespace,
  assertValidResourceKind,
  assertValidResourceName,
  resolveManifestPath,
} from './validation';

/**
 * Apply order for the manifests the backend renders.
 *
 * Ordering is by resource kind rather than file name: the Service must exist before the workload so
 * a StatefulSet's headless Service and any readiness-gated traffic are in place when pods start.
 * Kinds not listed here are applied last, in the order they arrived.
 */
const KIND_APPLY_ORDER = ['Namespace', 'ConfigMap', 'Secret', 'Service', 'Deployment', 'StatefulSet'];

/** Only these kinds support `kubectl rollout status`. */
const ROLLOUT_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];

interface PreparedManifest {
  file: K8sResourceFile;
  filePath: string;
  ref: K8sResourceRef;
  /** True when the resource already existed, so rollback must not delete it. */
  preExisting: boolean;
}

function emitProgress(socket: Socket, deploymentId: string, step: string, message: string, progress: number): void {
  socket.emit(SOCKET_EVENTS.K8S_DEPLOYMENT_PROGRESS, {
    deploymentId,
    step,
    message,
    progress: Math.min(100, Math.max(0, progress)),
  });
}

/**
 * Reads kind and name out of the rendered YAML.
 *
 * The agent needs these to wait on the right rollout and to clean up the right objects, and the
 * manifest is the only trustworthy source: guessing from the file name breaks the moment the
 * backend renders something new. Both values become kubectl arguments, so both are validated.
 *
 * `loadAll` is used rather than `load` because `load` throws outright on a multi-document stream.
 * A manifest that silently produced no ref would make the rollout wait on nothing and report
 * success without ever checking that pods started, so an unreadable manifest fails the step.
 */
function readResourceRef(file: K8sResourceFile): K8sResourceRef {
  const documents: unknown[] = [];
  try {
    loadAll(file.data, (doc) => documents.push(doc));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new DeploymentError(
      `Manifest ${file.name} is not valid YAML: ${detail}`,
      DeploymentErrorCodes.K8S_MANIFEST_INVALID,
    );
  }

  const objects = documents.filter((doc): doc is Record<string, any> => !!doc && typeof doc === 'object');

  if (objects.length !== 1) {
    throw new DeploymentError(
      `Manifest ${file.name} must contain exactly one Kubernetes object, found ${objects.length}.`,
      DeploymentErrorCodes.K8S_MANIFEST_INVALID,
    );
  }

  const [parsed] = objects;
  return {
    kind: assertValidResourceKind(parsed.kind),
    name: assertValidResourceName(parsed.metadata?.name),
  };
}

function sortByKind(manifests: PreparedManifest[]): PreparedManifest[] {
  return [...manifests].sort((a, b) => {
    const ai = KIND_APPLY_ORDER.indexOf(a.ref.kind);
    const bi = KIND_APPLY_ORDER.indexOf(b.ref.kind);
    return (ai === -1 ? KIND_APPLY_ORDER.length : ai) - (bi === -1 ? KIND_APPLY_ORDER.length : bi);
  });
}

/**
 * Deploys the backend-rendered manifests to a Kubernetes cluster with kubectl.
 *
 * The backend owns manifest construction, so this handler is deliberately thin: it writes the YAML
 * to a per-deployment folder, ensures the namespace, server-side validates with a dry run, applies
 * in dependency order, then optionally waits for the rollout. The dry run matters because a
 * half-applied set of resources is much harder to reason about than a rejected one, so anything the
 * cluster will refuse is caught before the first real write.
 *
 * The message arrives over a socket and originates from text typed into a web UI, so every value
 * that becomes a file path or a kubectl argument is validated here rather than trusted from the
 * backend. kubectl parses a leading dash as a flag even with no shell involved, so an unvalidated
 * namespace or resource name could otherwise retarget the whole command.
 */
export async function handleK8sDeployment(
  message: K8sDeploymentMessageDto,
  logger: LoggerFunc,
  socket: Socket,
  deploymentId: string,
): Promise<ExecutionResultReturnType> {
  const deployFolder = path.join(os.tmpdir(), 'hydra-k8s', deploymentId);
  const newlyApplied: K8sResourceRef[] = [];
  let namespace = 'default';

  try {
    // Manifests routinely contain Secret objects and registry credentials, so the folder is private
    // to the agent user rather than world-readable under the shared temp directory.
    await fs.mkdir(deployFolder, { recursive: true, mode: 0o700 });
    // mkdir ignores mode when the directory already exists, so set it explicitly.
    await fs.chmod(deployFolder, 0o700);

    const options = message.options;
    if (!options) {
      throw new DeploymentError(
        'Kubernetes deployment options are missing from the step message.',
        DeploymentErrorCodes.K8S_INVALID_IDENTIFIER,
      );
    }

    // Deploying into the wrong namespace is destructive, so a missing or malformed value fails the
    // step rather than silently falling back to 'default'.
    namespace = assertValidNamespace(options.namespace);

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
    // was applied is available while the deployment runs, which is what makes a failure debuggable.
    emitProgress(socket, deploymentId, 'prepare', 'Writing manifests', 15);
    const prepared: PreparedManifest[] = [];

    for (const file of resourceFiles) {
      const ref = readResourceRef(file);
      const filePath = resolveManifestPath(deployFolder, file.name);
      try {
        await fs.writeFile(filePath, file.data, { encoding: 'utf8', mode: 0o600 });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        throw new DeploymentError(
          `Failed to write manifest ${file.name}: ${detail}`,
          DeploymentErrorCodes.K8S_MANIFEST_WRITE_FAILED,
        );
      }
      prepared.push({ file, filePath, ref, preExisting: false });
      logger(deployFolder, 'info', `Prepared manifest ${file.name} (${ref.kind}/${ref.name})`);
    }

    const ordered = sortByKind(prepared);

    // Namespace first: every later apply targets it, so creating it afterwards is useless.
    if (options.createNamespace) {
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
    for (const { file, filePath } of ordered) {
      const dryRun = await executeKubectl(
        ['apply', '-f', filePath, '--namespace', namespace, '--dry-run=server'],
        logger,
        deployFolder,
        60000,
      );

      if (!dryRun.success) {
        throw new DeploymentError(
          `Manifest ${file.name} was rejected by the cluster: ${describeFailure(dryRun)}`,
          DeploymentErrorCodes.K8S_MANIFEST_INVALID,
        );
      }
      logger(deployFolder, 'info', `Validated ${file.name}`);
    }

    // Record which resources already exist. `kubectl apply` is an upsert, so without this the
    // rollback below would delete a pre-existing, previously healthy resource that this deployment
    // merely updated.
    for (const manifest of ordered) {
      const existing = await executeKubectl(
        ['get', manifest.ref.kind, manifest.ref.name, '--namespace', namespace],
        logger,
        deployFolder,
        20000,
      );
      manifest.preExisting = existing.success;
    }

    // Apply for real.
    const applyBase = 45;
    const applySpan = 30;
    for (let index = 0; index < ordered.length; index++) {
      const { file, filePath, ref, preExisting } = ordered[index];
      emitProgress(
        socket,
        deploymentId,
        'apply',
        `Applying ${file.name}`,
        applyBase + Math.round((applySpan * index) / ordered.length),
      );

      const result = await executeKubectl(
        ['apply', '-f', filePath, '--namespace', namespace],
        logger,
        deployFolder,
        120000,
      );

      if (!result.success) {
        throw new DeploymentError(
          `Failed to apply ${file.name}: ${describeFailure(result)}`,
          DeploymentErrorCodes.K8S_APPLY_FAILED,
        );
      }

      if (!preExisting) newlyApplied.push(ref);
      logger(deployFolder, 'info', result.stdout.trim() || `Applied ${file.name}`);
    }

    // Wait for the rollout. Without this the step reports success as soon as the API server accepts
    // the manifest, which says nothing about whether the new pods actually started.
    if (options.waitForRollout) {
      const timeout = options.rolloutTimeout > 0 ? options.rolloutTimeout : 300;
      const rolloutTargets = ordered.filter((m) => ROLLOUT_KINDS.includes(m.ref.kind));

      for (let index = 0; index < rolloutTargets.length; index++) {
        const { ref } = rolloutTargets[index];
        emitProgress(
          socket,
          deploymentId,
          'rollout',
          `Waiting for ${ref.kind}/${ref.name} to roll out`,
          75 + Math.round((20 * index) / rolloutTargets.length),
        );
        logger(deployFolder, 'info', `Waiting up to ${timeout}s for ${ref.kind}/${ref.name} to roll out`);

        const rollout = await executeKubectl(
          ['rollout', 'status', ref.kind.toLowerCase(), ref.name, '--namespace', namespace, `--timeout=${timeout}s`],
          logger,
          deployFolder,
          // Give kubectl a little longer than its own timeout so its message wins over ours.
          (timeout + 30) * 1000,
        );

        if (!rollout.success) {
          throw new DeploymentError(
            `Rollout of ${ref.kind}/${ref.name} did not complete: ${describeFailure(rollout)}`,
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

    // Only resources this deployment actually created are removed. Anything that already existed is
    // left alone: deleting it would destroy a working resource rather than roll back to it.
    if (message.options?.deleteOnFailure && newlyApplied.length > 0) {
      logger(deployFolder, 'info', 'Rolling back: deleting resources created by this deployment');
      // Reverse order so the workload goes before the Service it depends on.
      for (const ref of [...newlyApplied].reverse()) {
        const remove = await executeKubectl(
          ['delete', ref.kind, ref.name, '--namespace', namespace, '--ignore-not-found'],
          logger,
          deployFolder,
          60000,
        );
        if (remove.success) {
          logger(deployFolder, 'info', `Deleted ${ref.kind}/${ref.name}`);
        } else {
          // Report but keep going: a failed cleanup must not mask the original error.
          logger(deployFolder, 'warning', `Could not delete ${ref.kind}/${ref.name}: ${describeFailure(remove)}`);
        }
      }
    }

    return { succeeded: false, output: detail };
  } finally {
    // The manifests may contain secrets and the agent runs indefinitely, so the folder is never
    // left behind. A cleanup failure is swallowed deliberately: losing a temp directory must not
    // change the deployment's reported outcome.
    await fs.rm(deployFolder, { recursive: true, force: true }).catch(() => undefined);
  }
}
