import fs from 'fs';
import https from 'https';
import http from 'http';
import crypto from 'crypto';

type ProgressCallback = (progress: number) => void;

export async function downloadBinary(
  url: string,
  destination: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(
      url,
      {
        headers: { 'User-Agent': 'HydraAgent' },
      },
      (response) => {
        // Handle redirects (GitHub releases redirect to S3)
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(destination);
            return downloadBinary(redirectUrl, destination, onProgress)
              .then(resolve)
              .catch(reject);
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destination, () => {});
          reject(new Error(`Download failed with status: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            onProgress(progress);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    );

    request.on('error', (err) => {
      file.close();
      fs.unlink(destination, () => {});
      reject(err);
    });

    // Set timeout for slow/stalled downloads (5 minutes)
    request.setTimeout(300000, () => {
      request.destroy();
      file.close();
      fs.unlink(destination, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

export async function verifyChecksum(
  filePath: string,
  expectedChecksum: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actualChecksum = hash.digest('hex');
      resolve(actualChecksum.toLowerCase() === expectedChecksum.toLowerCase());
    });
    stream.on('error', reject);
  });
}
