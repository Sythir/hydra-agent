import { spawn } from 'child_process';
import { LoggerFunc } from '../../utils/logMessage';
import { DeploymentError, DeploymentErrorCodes } from '../../types/DeploymentError';

export interface PowerShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Executes a PowerShell command and returns the result
 * @param command The PowerShell command to execute
 * @param logger Logger function for output
 * @param deployFolder Folder path for logging context
 * @param timeoutMs Timeout in milliseconds (default: 60000)
 */
export async function executePowerShell(
  command: string,
  logger: LoggerFunc,
  deployFolder: string,
  timeoutMs: number = 60000,
): Promise<PowerShellResult> {
  return new Promise((resolve) => {
    // Wrap command in try-catch for better error handling
    // $ErrorActionPreference = "Stop" converts all errors to terminating exceptions
    const wrappedCommand = `
      $ErrorActionPreference = "Stop"
      try {
        ${command}
        exit 0
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `;

    const childProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wrappedCommand], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let hasTimedOut = false;

    const timeoutId = setTimeout(() => {
      hasTimedOut = true;
      if (childProcess.pid) {
        try {
          process.kill(childProcess.pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      }
      logger(deployFolder, 'error', `PowerShell command timed out after ${timeoutMs / 1000} seconds`);
      resolve({
        success: false,
        stdout,
        stderr: 'Command timed out',
        exitCode: null,
      });
    }, timeoutMs);

    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
    });

    childProcess.on('close', (code) => {
      clearTimeout(timeoutId);
      if (hasTimedOut) return;

      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      logger(deployFolder, 'error', `PowerShell execution error: ${error.message}`);
      resolve({
        success: false,
        stdout,
        stderr: error.message,
        exitCode: null,
      });
    });
  });
}

/**
 * Executes a PowerShell command and throws on failure
 */
export async function executePowerShellOrThrow(
  command: string,
  logger: LoggerFunc,
  deployFolder: string,
  errorCode: string = DeploymentErrorCodes.IIS_POWERSHELL_ERROR,
  timeoutMs?: number,
): Promise<string> {
  const result = await executePowerShell(command, logger, deployFolder, timeoutMs);
  if (!result.success) {
    const errorMessage = result.stderr || result.stdout || 'Unknown PowerShell error';
    throw new DeploymentError(errorMessage, errorCode, { command, stderr: result.stderr, stdout: result.stdout });
  }
  return result.stdout;
}

/**
 * Checks if IIS WebAdministration module is available
 */
export async function checkIisAvailable(logger: LoggerFunc, deployFolder: string): Promise<boolean> {
  const result = await executePowerShell(
    `
    Import-Module WebAdministration -ErrorAction Stop
    if (Test-Path "IIS:\\") { Write-Output "IIS_AVAILABLE" } else { throw "IIS not available" }
    `,
    logger,
    deployFolder,
  );

  return result.success && result.stdout.includes('IIS_AVAILABLE');
}

/**
 * Escapes a string for safe use in PowerShell
 */
export function escapePowerShellString(value: string): string {
  // Escape single quotes by doubling them
  return value.replace(/'/g, "''");
}

/**
 * Generates a PowerShell script file content with proper error handling
 */
export function generatePowerShellScript(commands: string[]): string {
  return `
$ErrorActionPreference = "Stop"
Import-Module WebAdministration

try {
${commands.map((cmd) => `    ${cmd}`).join('\n')}
    Write-Output "SUCCESS"
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`.trim();
}
