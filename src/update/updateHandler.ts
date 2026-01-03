import fs from 'fs/promises';
import { Socket } from 'socket.io-client';
import { PATHS, getNewBinaryPath } from '../config/paths';
import { SOCKET_EVENTS } from '../config/constants';
import { AgentUpdateMessage, UPDATE_STATUS } from '../types/update';
import { downloadBinary, verifyChecksum } from './downloadBinary';
import {
  isUpdateLocked,
  acquireUpdateLock,
  releaseUpdateLock,
  writeRestartSignal,
  ensureUpdateDirectories,
} from './signals';

interface UpdateContext {
  socket: Socket;
  message: AgentUpdateMessage;
  currentVersion: string;
}

function emitStatus(
  socket: Socket,
  updateId: string,
  status: string,
  currentVersion: string,
  targetVersion: string,
  error?: string,
  progress?: number
) {
  socket.emit(SOCKET_EVENTS.AGENT_UPDATE_STATUS, {
    updateId,
    status,
    currentVersion,
    targetVersion,
    error,
    progress,
  });
}

export async function handleAgentUpdate(ctx: UpdateContext): Promise<void> {
  const { socket, message, currentVersion } = ctx;
  const { updateId, targetVersion, downloadUrl, checksum } = message;

  const emit = (status: string, error?: string, progress?: number) =>
    emitStatus(socket, updateId, status, currentVersion, targetVersion, error, progress);

  try {
    if (await isUpdateLocked()) {
      emit(UPDATE_STATUS.FAILED, 'Update already in progress');
      return;
    }

    await acquireUpdateLock(updateId);

    await ensureUpdateDirectories();

    console.log(`Downloading update from: ${downloadUrl}`);
    emit(UPDATE_STATUS.DOWNLOADING);

    const newBinaryPath = getNewBinaryPath();
    let lastProgress = 0;

    await downloadBinary(downloadUrl, newBinaryPath, (progress) => {
      if (progress - lastProgress >= 10 || progress === 100) {
        emit(UPDATE_STATUS.DOWNLOADING, undefined, progress);
        lastProgress = progress;
      }
    });

    if (process.platform !== 'win32') {
      await fs.chmod(newBinaryPath, 0o755);
    }

    if (checksum) {
      console.log('Verifying checksum...');
      const isValid = await verifyChecksum(newBinaryPath, checksum);
      if (!isValid) {
        await fs.unlink(newBinaryPath);
        await releaseUpdateLock();
        emit(UPDATE_STATUS.FAILED, 'Checksum verification failed');
        return;
      }
      console.log('Checksum verified');
    }

    emit(UPDATE_STATUS.DOWNLOADED);

    await writeRestartSignal(targetVersion, newBinaryPath);

    emit(UPDATE_STATUS.RESTARTING);

    console.log(`Update downloaded. Signaling launcher for restart to ${targetVersion}`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    process.exit(100);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Update failed: ${errorMessage}`);
    emit(UPDATE_STATUS.FAILED, errorMessage);
    await releaseUpdateLock();
  }
}
