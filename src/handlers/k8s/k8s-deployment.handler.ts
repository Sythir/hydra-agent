import fs from 'fs';
import path from 'path';
import * as k8s from '@kubernetes/client-node';
import { K8sDeploymentMessageDto } from '../../types/step-types/k8s';
import { ExecutionResultReturnType } from '../../types/ExecutionResultReturnType';
import { DeploymentHandler } from '../../types/HandlerContext';

export const handleK8sDeployment: DeploymentHandler<K8sDeploymentMessageDto> = async (
  stepMessage,
  { logger, deploymentFolder },
): Promise<ExecutionResultReturnType> => {
  for (const file of stepMessage.resourceFiles) {
    const filePath = path.join(deploymentFolder, file.name);
    fs.writeFileSync(filePath, file.data);
    logger(deploymentFolder, 'info', `Written resource file: ${file.name}`);
  }

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  try {
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    await versionApi.getCode();
  } catch (e) {
    const error = e as { message: string };
    logger(deploymentFolder, 'error', `Cannot connect to Kubernetes cluster: ${error.message}`);
    return { succeeded: false };
  }

  const client = k8s.KubernetesObjectApi.makeApiClient(kc);

  if (stepMessage.createNamespaceIfNotExists) {
    logger(deploymentFolder, 'info', `Creating namespace: ${stepMessage.namespace}`);
    const namespace = new k8s.V1Namespace();
    namespace.apiVersion = 'v1';
    namespace.kind = 'Namespace';
    namespace.metadata = new k8s.V1ObjectMeta();
    namespace.metadata.name = stepMessage.namespace;
    try {
      await client.create(namespace);
      logger(deploymentFolder, 'info', `Namespace created: ${stepMessage.namespace}`);
    } catch (e) {
      logger(deploymentFolder, 'info', `Namespace already exits: ${stepMessage.namespace}`);
    }
  }

  for (const file of stepMessage.resourceFiles) {
    const resources = k8s.loadAllYaml(file.data) as k8s.KubernetesObject[];
    for (const resource of resources) {
      try {
        await client.patch(resource, undefined, undefined, 'hydre-agent', true, k8s.PatchStrategy.ServerSideApply);
        logger(deploymentFolder, 'info', `Applied ${resource.kind}/${resource.metadata?.name}`);
      } catch (e) {
        const error = e as { body?: { message?: string }; message: string };
        logger(
          deploymentFolder,
          'error',
          `Failed to apply ${resource.kind}/${resource.metadata?.name}: ${error.body?.message ?? error.message}`,
        );
        return { succeeded: false };
      }
    }
  }

  return { succeeded: true };
};
