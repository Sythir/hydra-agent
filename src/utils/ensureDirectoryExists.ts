import fs from 'fs';

function ensureDirectoryExists(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    // Recursively create directories
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

export { ensureDirectoryExists };
