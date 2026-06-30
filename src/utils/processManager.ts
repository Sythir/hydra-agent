import { ChildProcess, execSync } from 'child_process';

let activeDeploymentId: string | null = null;
let activeChild: ChildProcess | null = null;
const cancelledIds = new Set<string>();

/**
 * Force-kills a spawned deploy script and its whole process tree.
 *
 * Needed because `spawn` is used with `shell: true`, so the direct child is a
 * shell that itself spawns the script — killing the shell alone leaves orphans.
 * - Unix: kill the process group via the negative PID.
 * - Windows: `taskkill /T` kills the process tree.
 */
export function killProcessTree(child: ChildProcess) {
  if (!child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function setActiveDeployment(id: string) {
  activeDeploymentId = id;
}

export function setActiveChild(child: ChildProcess | null) {
  activeChild = child;
}

export function clearActive() {
  activeDeploymentId = null;
  activeChild = null;
}

/**
 * Cancels the actively-running deployment if its id matches. Returns true when a
 * running process was killed, false otherwise (e.g. the id is queued or unknown,
 * in which case the caller handles queue removal).
 */
export function requestCancel(id: string): boolean {
  if (activeDeploymentId === id && activeChild) {
    cancelledIds.add(id);
    killProcessTree(activeChild);
    return true;
  }
  return false;
}

export function isCancelled(id: string) {
  return cancelledIds.has(id);
}

export function clearCancelled(id: string) {
  cancelledIds.delete(id);
}
