export interface K8sDeploymentMessageDto {
  resourceFiles: { name: string; data: string }[];
  createNamespaceIfNotExists: boolean;
  namespace: string;
}
