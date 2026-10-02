/**
 * Validation for Kubernetes identifiers and manifest file names.
 *
 * Everything the handler receives originates as text typed into a web UI, travels through the
 * backend and arrives over a socket. The backend validates it too, but the agent must not depend on
 * that: it runs on customer servers with access to a cluster and a kubeconfig, so it treats the
 * payload as untrusted and re-checks anything that becomes a file path or a kubectl argument.
 */
import path from 'path';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';

/** RFC 1123 DNS label: namespaces and most short names. Max 63 chars. */
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** RFC 1123 DNS subdomain: resource names, which may contain dots. Max 253 chars. */
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

/** Kubernetes kinds are CamelCase alphanumerics, e.g. Deployment, StatefulSet. */
const RESOURCE_KIND = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Validates a namespace before it becomes a kubectl argument.
 *
 * A leading dash is the dangerous case: kubectl would parse a value like
 * `--kubeconfig=/tmp/evil.yaml` as a flag and silently target a different cluster or identity, even
 * though the process is spawned without a shell. The DNS label rule excludes that by construction.
 */
export function assertValidNamespace(namespace: unknown): string {
  if (typeof namespace !== 'string' || !namespace) {
    throw new DeploymentError(
      'Kubernetes namespace is missing. The deployment step must specify a namespace.',
      DeploymentErrorCodes.K8S_INVALID_IDENTIFIER,
    );
  }
  if (namespace.length > 63 || !DNS_LABEL.test(namespace)) {
    throw new DeploymentError(
      `Invalid Kubernetes namespace ${JSON.stringify(namespace)}: must be a DNS label ` +
        '(lowercase alphanumerics and hyphens, starting and ending alphanumeric, max 63 characters).',
      DeploymentErrorCodes.K8S_INVALID_IDENTIFIER,
    );
  }
  return namespace;
}

/** Validates a resource kind read from a manifest before it becomes a kubectl argument. */
export function assertValidResourceKind(kind: unknown): string {
  if (typeof kind !== 'string' || !kind || kind.length > 63 || !RESOURCE_KIND.test(kind)) {
    throw new DeploymentError(
      `Invalid Kubernetes resource kind ${JSON.stringify(kind)}: must be alphanumeric.`,
      DeploymentErrorCodes.K8S_INVALID_IDENTIFIER,
    );
  }
  return kind;
}

/** Validates a resource name read from a manifest before it becomes a kubectl argument. */
export function assertValidResourceName(name: unknown): string {
  if (typeof name !== 'string' || !name || name.length > 253 || !DNS_SUBDOMAIN.test(name)) {
    throw new DeploymentError(
      `Invalid Kubernetes resource name ${JSON.stringify(name)}: must be a DNS subdomain.`,
      DeploymentErrorCodes.K8S_INVALID_IDENTIFIER,
    );
  }
  return name;
}

/**
 * Resolves a manifest file name to a path inside the deployment folder.
 *
 * `path.join` alone is not containment: a name of `a/../../b.yaml` resolves outside the folder, so
 * a crafted payload could overwrite any file the agent user can write, the kubeconfig and the
 * agent's own files included. The name is reduced to its basename and the result is then checked to
 * be inside the folder, so neither traversal nor an absolute path can escape.
 */
export function resolveManifestPath(deployFolder: string, fileName: unknown): string {
  if (typeof fileName !== 'string' || !fileName.trim()) {
    throw new DeploymentError(
      `Invalid manifest file name ${JSON.stringify(fileName)}.`,
      DeploymentErrorCodes.K8S_INVALID_MANIFEST_NAME,
    );
  }

  // NUL truncates paths in some syscalls, so reject it outright rather than stripping it.
  if (fileName.includes('\0')) {
    throw new DeploymentError(
      'Manifest file name contains a NUL byte.',
      DeploymentErrorCodes.K8S_INVALID_MANIFEST_NAME,
    );
  }

  const base = path.basename(fileName);
  if (!base || base === '.' || base === '..' || base !== fileName) {
    throw new DeploymentError(
      `Invalid manifest file name ${JSON.stringify(fileName)}: expected a plain file name with no path separators.`,
      DeploymentErrorCodes.K8S_INVALID_MANIFEST_NAME,
    );
  }

  const resolved = path.resolve(deployFolder, base);
  const root = path.resolve(deployFolder) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new DeploymentError(
      `Manifest file name ${JSON.stringify(fileName)} resolves outside the deployment folder.`,
      DeploymentErrorCodes.K8S_INVALID_MANIFEST_NAME,
    );
  }

  return resolved;
}
