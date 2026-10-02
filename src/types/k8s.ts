/**
 * Types for the Kubernetes deployment step.
 *
 * The backend renders the manifests itself and sends them as plain YAML, so the agent never has to
 * understand the Kubernetes object model. It only writes the files out and drives kubectl.
 */

export interface K8sResourceFile {
  /** File name, e.g. 'deployment.yaml'. Determines apply order via APPLY_ORDER. */
  name: string;
  /** Rendered YAML content. */
  data: string;
}

export interface K8sDeploymentOptions {
  /** Target namespace for every kubectl invocation. */
  namespace: string;
  /** Create the namespace first if it does not already exist. */
  createNamespace: boolean;
  /** Block until the rollout finishes, failing the step if it does not. */
  waitForRollout: boolean;
  /** Seconds to wait for the rollout before declaring failure. */
  rolloutTimeout: number;
  /** Delete the applied resources again when the rollout fails. */
  deleteOnFailure: boolean;
}

export interface K8sDeploymentMessageDto {
  resourceFiles: K8sResourceFile[];
  options: K8sDeploymentOptions;
}

export interface K8sDeploymentProgress {
  deploymentId: string;
  step: string;
  message: string;
  progress: number;
}

/**
 * A resource identified from an applied manifest, used to wait on rollouts and to clean up after a
 * failure.
 */
export interface K8sResourceRef {
  kind: string;
  name: string;
}
