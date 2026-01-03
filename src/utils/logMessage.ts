import fs from 'fs';
import path from 'path';
import { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '../config/constants';

export type LoggerFunc = (folderName: string, type: 'info' | 'warning' | 'error', message: string) => void;

export const createLogger = (deploymentId: string, socket: Socket) => {
  return (folderName: string, type: 'info' | 'warning' | 'error', message: string): void => {
    if (!message) throw new Error('Message is required');
    const folderLocation = folderName;
    if (!fs.existsSync(folderLocation)) {
      fs.mkdirSync(folderLocation, { recursive: true });
    }

    const logFilePath = path.join(folderLocation, 'logs.txt');

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logFilePath, logEntry, 'utf8');

    socket.emit(SOCKET_EVENTS.LOG, {
      deploymentId,
      type,
      timestamp: new Date().toISOString(),
      log: message,
    });
  };
};