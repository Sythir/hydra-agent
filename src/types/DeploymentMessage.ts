import { IisDeploymentMessageDto } from './step-types/iis';
import { K8sDeploymentMessageDto } from './step-types/k8s';
import { ScriptDeploymentMessageDto } from './step-types/script';

interface Step {
  id: string;
  name: string;
  type: string;
  message: ScriptDeploymentMessageDto | IisDeploymentMessageDto | K8sDeploymentMessageDto | null;
}

export interface Message {
  id: string;
  deployment: { id: string };
  application: {
    id: string;
    name: string;
    code: string;
    appId: string;
    registry: { url: string; name: string; type: string };
  };
  project: { id: string; name: string; code: string };
  environment: { id: string; name: string };
  version: { id: string; version: string };

  steps: Step[];
}
