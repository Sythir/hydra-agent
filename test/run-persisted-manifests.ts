/**
 * Feeds the manifests that were rendered from database-persisted step values into the real agent
 * handler, against a stub kubectl, and prints the exact kubectl commands produced.
 *
 * This is the last link in the chain: UI field -> API save -> database -> backend render -> agent
 * kubectl invocation.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleK8sDeployment } from '../src/handlers/k8s';

const manifestDir = process.argv[2];
const optionsJson = process.argv[3];

const resourceFiles = fs
  .readdirSync(manifestDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((name) => ({ name, data: fs.readFileSync(path.join(manifestDir, name), 'utf8') }));

const options = JSON.parse(optionsJson);

const stubDir = path.join(__dirname, 'stub-kubectl');
fs.chmodSync(path.join(stubDir, 'kubectl'), 0o755);
const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-real-')), 'log.txt');
fs.writeFileSync(logFile, '');

process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.KUBECTL_LOG = logFile;

(async () => {
  const result = await handleK8sDeployment(
    { resourceFiles, options },
    () => {},
    { emit: () => {} } as any,
    'persisted-e2e',
  );

  console.log(`manifests from the database: ${resourceFiles.map((f) => f.name).join(', ')}`);
  console.log(`options from the database: ${optionsJson}`);
  console.log(`\nsucceeded: ${result.succeeded}${result.output ? ` (${result.output})` : ''}`);
  console.log('\nkubectl commands the agent issued:');
  for (const line of fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean)) {
    console.log(`  kubectl ${line}`);
  }
  process.exit(result.succeeded ? 0 : 1);
})();
