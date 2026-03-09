import { Socket } from 'socket.io-client';
import { LoggerFunc } from '../utils/logMessage';
import { Message } from './DeploymentMessage';
import { ExecutionResultReturnType } from './ExecutionResultReturnType';

export interface HandlerContext {
  deploymentMessage: Message;
  logger: LoggerFunc;
  deploymentFolder: string;
  operatingSystem: 'windows' | 'linux';
  keepDeployments: number;
  socket: Socket;
}

export type DeploymentHandler<TStepMessage> = (
  stepMessage: TStepMessage,
  context: HandlerContext,
) => Promise<ExecutionResultReturnType>;
