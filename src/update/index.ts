export { handleAgentUpdate } from './updateHandler';
export { signalHealthy, isPostUpdateStartup } from './healthCheck';
export { downloadBinary, verifyChecksum } from './downloadBinary';
export {
  isUpdateLocked,
  acquireUpdateLock,
  releaseUpdateLock,
  writeRestartSignal,
  ensureUpdateDirectories,
} from './signals';
