import { ChildProcess, execSync } from 'child_process';

let activeDeploymentId: string | null = null;
let activeChild: ChildProcess | null = null;
const cancelledIds = new Set<string>();

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
