import crypto from 'crypto';

export const createDeployHash = () => {
  const currentDateTime = new Date().toISOString();
  return crypto.createHash('sha256').update(currentDateTime).digest('hex');
};
