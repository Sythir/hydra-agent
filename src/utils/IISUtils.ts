import path from "path";
import fs from 'fs/promises';
import fileSystem from 'fs';
import unzipper from 'unzipper';

export const downloadNugetPackage = async (url: string, destination: string) => {
  if (!url) {
    console.error("Error: URL cannot be empty.");
    return;
  }

  console.log(`Starting download from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with status: ${response.status} ${response.statusText}`);
    }
    const filename = path.basename(new URL(url).pathname);
    const destinationPath = path.join(destination, 'app.zip');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(destinationPath, buffer);

    console.log(`Successfully downloaded ${filename} to ${destinationPath}`);

  } catch (error) {
    console.error(`An error occurred during download:`, error);
    throw error;
  }
}

export const unzipPackage = async (pathToZip: string, outputDir: string): Promise<void> => {
  return new Promise((resolve, reject) =>
    fileSystem.createReadStream(pathToZip)
      .pipe(unzipper.Extract({ path: outputDir }))
      .on('close', () => {
        console.log(`Successfully unzipped "${pathToZip}" to "${outputDir}"`);
        resolve();
      })
      .on('error', (err: Error) => {
        console.error("An error occurred during unzipping:", err);
        reject(err);
      }));
}