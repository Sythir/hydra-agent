/**
 * Runs the real agent handler against a real Kubernetes cluster with the real kubectl.
 *
 * No stub anywhere in this path: the manifests come from the backend builder, the handler is the
 * production one, and kubectl talks to an actual API server. This is what proves the step works end
 * to end rather than merely issuing plausible-looking commands.
 */
import fs from 'fs';
import path from 'path';
import { handleK8sDeployment } from '../src/handlers/k8s';

const scenarioDir = process.argv[2];

const resourceFiles = fs
  .readdirSync(scenarioDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((name) => ({ name, data: fs.readFileSync(path.join(scenarioDir, name), 'utf8') }));

const options = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'options.json'), 'utf8'));

const logger = (_folder: string, type: string, message: string) => {
  console.log(`    [${type}] ${message}`);
};

(async () => {
  console.log(`manifests: ${resourceFiles.map((f) => f.name).join(', ')}`);
  console.log(`options:   ${JSON.stringify(options)}`);
  console.log('--- handler output ---');

  const started = Date.now();
  const result = await handleK8sDeployment(
    { resourceFiles, options },
    logger as any,
    { emit: () => {} } as any,
    `live-${path.basename(scenarioDir)}`,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log('--- result ---');
  console.log(`succeeded: ${result.succeeded} (${seconds}s)`);
  if (result.output) console.log(`output: ${result.output}`);
  process.exit(result.succeeded ? 0 : 1);
})();
