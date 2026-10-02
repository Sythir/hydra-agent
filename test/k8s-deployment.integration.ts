/**
 * Integration test for the Kubernetes deployment handler.
 *
 * Drives handleK8sDeployment against a stub kubectl on PATH and asserts on the exact command
 * sequence it produced. This is the only check that covers the ordering guarantees the handler is
 * responsible for: namespace before apply, dry run before apply, Service before workload, rollout
 * wait on the right resource, and reverse-order cleanup on failure.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handleK8sDeployment } from '../src/handlers/k8s';
import { K8sDeploymentMessageDto } from '../src/types/k8s';

const stubDir = path.join(__dirname, 'stub-kubectl');
fs.chmodSync(path.join(stubDir, 'kubectl'), 0o755);

const deploymentYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-workload
spec:
  replicas: 2
`;

const serviceYaml = `apiVersion: v1
kind: Service
metadata:
  name: my-workload-svc
spec:
  type: ClusterIP
`;

const statefulSetYaml = `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-sts
spec:
  replicas: 1
`;

const noopLogger = () => {};
const fakeSocket = { emit: () => {} } as any;

interface RunResult {
  succeeded: boolean;
  output?: string;
  commands: string[];
}

async function run(
  message: K8sDeploymentMessageDto,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-log-')), 'log.txt');
  fs.writeFileSync(logFile, '');

  const previous = { ...process.env };
  process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
  process.env.KUBECTL_LOG = logFile;
  delete process.env.KUBECTL_FAIL;
  delete process.env.KUBECTL_NS_EXISTS;
  Object.assign(process.env, env);

  try {
    const result = await handleK8sDeployment(message, noopLogger, fakeSocket, `test-${Date.now()}`);
    const commands = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    return { ...result, commands };
  } finally {
    process.env = previous;
  }
}

const defaultOptions = {
  namespace: 'my-namespace',
  createNamespace: true,
  waitForRollout: true,
  rolloutTimeout: 600,
  deleteOnFailure: true,
};

const tests: { name: string; fn: () => Promise<void> }[] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push({ name, fn });

test('applies manifests and waits for the rollout on the happy path', async () => {
  const result = await run({
    resourceFiles: [
      { name: 'deployment.yaml', data: deploymentYaml },
      { name: 'service.yaml', data: serviceYaml },
    ],
    options: defaultOptions,
  });

  assert.strictEqual(result.succeeded, true, `expected success, got: ${result.output}`);

  // Service must be applied before the workload regardless of the order it arrived in.
  const serviceApply = result.commands.findIndex(
    (c) => c.startsWith('apply -f') && c.includes('service.yaml') && !c.includes('dry-run'),
  );
  const deploymentApply = result.commands.findIndex(
    (c) => c.startsWith('apply -f') && c.includes('deployment.yaml') && !c.includes('dry-run'),
  );
  assert.ok(serviceApply !== -1 && deploymentApply !== -1, 'both manifests must be applied');
  assert.ok(serviceApply < deploymentApply, 'Service must be applied before the Deployment');

  // Namespace handling precedes any apply.
  const nsCreate = result.commands.findIndex((c) => c === 'create namespace my-namespace');
  assert.ok(nsCreate !== -1, 'namespace must be created when it does not exist');
  assert.ok(nsCreate < serviceApply, 'namespace must be created before applying manifests');

  // Every manifest is server-side dry run before anything is applied for real.
  const dryRuns = result.commands.filter((c) => c.includes('--dry-run=server'));
  assert.strictEqual(dryRuns.length, 2, 'both manifests must be dry run');
  const lastDryRun = result.commands.map((c) => c.includes('--dry-run=server')).lastIndexOf(true);
  assert.ok(lastDryRun < serviceApply, 'all dry runs must precede the first real apply');

  // Rollout is awaited on the Deployment, with the configured timeout, and not on the Service.
  assert.ok(
    result.commands.includes('rollout status deployment my-workload --namespace my-namespace --timeout=600s'),
    `expected rollout wait, got: ${JSON.stringify(result.commands)}`,
  );
  assert.ok(
    !result.commands.some((c) => c.startsWith('rollout status service')),
    'must not wait on a Service rollout',
  );
});

test('derives the rollout target from the manifest kind, not the file name', async () => {
  const result = await run({
    resourceFiles: [{ name: 'statefulset.yaml', data: statefulSetYaml }],
    options: defaultOptions,
  });

  assert.strictEqual(result.succeeded, true, `expected success, got: ${result.output}`);
  assert.ok(
    result.commands.includes('rollout status statefulset my-sts --namespace my-namespace --timeout=600s'),
    `expected statefulset rollout wait, got: ${JSON.stringify(result.commands)}`,
  );
});

test('skips namespace creation when the namespace already exists', async () => {
  const result = await run(
    {
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: defaultOptions,
    },
    { KUBECTL_NS_EXISTS: '1' },
  );

  assert.strictEqual(result.succeeded, true);
  assert.ok(
    !result.commands.includes('create namespace my-namespace'),
    'must not create a namespace that already exists',
  );
});

test('does not create a namespace when createNamespace is false', async () => {
  const result = await run({
    resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
    options: { ...defaultOptions, createNamespace: false },
  });

  assert.strictEqual(result.succeeded, true);
  assert.ok(!result.commands.some((c) => c.startsWith('create namespace')));
  assert.ok(!result.commands.some((c) => c.startsWith('get namespace')));
});

test('does not wait for rollout when waitForRollout is false', async () => {
  const result = await run({
    resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
    options: { ...defaultOptions, waitForRollout: false },
  });

  assert.strictEqual(result.succeeded, true);
  assert.ok(!result.commands.some((c) => c.startsWith('rollout status')));
});

test('applies nothing when the dry run is rejected', async () => {
  const result = await run(
    {
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: defaultOptions,
    },
    { KUBECTL_FAIL: '--dry-run=server' },
  );

  assert.strictEqual(result.succeeded, false, 'a rejected manifest must fail the step');
  assert.ok(
    !result.commands.some((c) => c.startsWith('apply -f') && !c.includes('--dry-run=server')),
    'nothing may be applied after a failed dry run',
  );
  assert.ok(/rejected by the cluster/.test(result.output || ''), `unexpected error: ${result.output}`);
});

test('deletes applied resources in reverse order when the rollout fails', async () => {
  const result = await run(
    {
      resourceFiles: [
        { name: 'deployment.yaml', data: deploymentYaml },
        { name: 'service.yaml', data: serviceYaml },
      ],
      options: defaultOptions,
    },
    { KUBECTL_FAIL: 'rollout status' },
  );

  assert.strictEqual(result.succeeded, false, 'a failed rollout must fail the step');

  const deleteDeployment = result.commands.indexOf(
    'delete Deployment my-workload --namespace my-namespace --ignore-not-found',
  );
  const deleteService = result.commands.indexOf(
    'delete Service my-workload-svc --namespace my-namespace --ignore-not-found',
  );
  assert.ok(deleteDeployment !== -1, 'the Deployment must be deleted on failure');
  assert.ok(deleteService !== -1, 'the Service must be deleted on failure');
  assert.ok(deleteDeployment < deleteService, 'workload must be deleted before the Service it depends on');
});

test('leaves resources in place when deleteOnFailure is false', async () => {
  const result = await run(
    {
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: { ...defaultOptions, deleteOnFailure: false },
    },
    { KUBECTL_FAIL: 'rollout status' },
  );

  assert.strictEqual(result.succeeded, false);
  assert.ok(!result.commands.some((c) => c.startsWith('delete ')), 'must not delete when not asked to');
});

test('fails with a clear error when kubectl is missing', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-missing-'));
  const previous = { ...process.env };
  // A PATH with no kubectl at all, which is what an unprepared agent host looks like.
  process.env.PATH = logDir;
  try {
    const result = await handleK8sDeployment(
      { resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }], options: defaultOptions },
      noopLogger,
      fakeSocket,
      'test-missing',
    );
    assert.strictEqual(result.succeeded, false);
    assert.ok(/kubectl is not available/.test(result.output || ''), `unexpected error: ${result.output}`);
  } finally {
    process.env = previous;
  }
});

test('fails when no manifests are supplied', async () => {
  const result = await run({ resourceFiles: [], options: defaultOptions });
  assert.strictEqual(result.succeeded, false);
  assert.ok(/No Kubernetes manifests/.test(result.output || ''), `unexpected error: ${result.output}`);
});

/**
 * Hostile input tests. Every value below arrives over a socket from the backend, originating as
 * text typed into a web UI, so the agent must reject it rather than hand it to kubectl or the
 * filesystem.
 */
test('rejects a manifest file name that escapes the deployment folder', async () => {
  for (const name of ['../../../../escape.yaml', 'a/../../b.yaml', '/etc/passwd', 'sub/dir.yaml', '..']) {
    const result = await run({
      resourceFiles: [{ name, data: deploymentYaml }],
      options: defaultOptions,
    });
    assert.strictEqual(result.succeeded, false, `file name ${name} must be rejected`);
    assert.ok(
      /manifest file name|outside the deployment folder/i.test(result.output || ''),
      `unexpected error for ${name}: ${result.output}`,
    );
    // Nothing may be applied when a name is rejected.
    assert.ok(!result.commands.some((c) => c.startsWith('apply')), `${name} must not reach kubectl`);
  }
});

test('does not write outside the deployment folder when given a traversing name', async () => {
  const marker = path.join(os.tmpdir(), `hydra-traversal-${Date.now()}.yaml`);
  const relative = path.relative(path.join(os.tmpdir(), 'hydra-k8s', 'probe'), marker);
  await run({ resourceFiles: [{ name: relative, data: deploymentYaml }], options: defaultOptions });
  assert.ok(!fs.existsSync(marker), `traversing name wrote to ${marker}`);
});

test('rejects a namespace that kubectl would read as a flag', async () => {
  for (const ns of ['--kubeconfig=/tmp/evil.yaml', '-n', '--as=system:admin', 'UPPER', '../escape', '']) {
    const result = await run({
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: { ...defaultOptions, namespace: ns },
    });
    assert.strictEqual(result.succeeded, false, `namespace ${JSON.stringify(ns)} must be rejected`);
    assert.ok(
      !result.commands.some((c) => c.includes(ns) && ns.length > 2),
      `namespace ${ns} must never reach kubectl`,
    );
  }
});

test('rejects a manifest whose kind or name would be read as a flag', async () => {
  const hostileKind = `apiVersion: apps/v1\nkind: --kubeconfig=/tmp/evil\nmetadata:\n  name: ok\n`;
  const hostileName = `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: --all\n`;
  for (const data of [hostileKind, hostileName]) {
    const result = await run({
      resourceFiles: [{ name: 'deployment.yaml', data }],
      options: defaultOptions,
    });
    assert.strictEqual(result.succeeded, false, 'hostile kind/name must be rejected');
    assert.ok(/Invalid Kubernetes/i.test(result.output || ''), `unexpected error: ${result.output}`);
    assert.ok(!result.commands.some((c) => c.startsWith('apply')), 'must not reach kubectl');
  }
});

test('fails rather than silently skipping the rollout on a multi-document manifest', async () => {
  const result = await run({
    resourceFiles: [{ name: 'deployment.yaml', data: `${deploymentYaml}---\n${serviceYaml}` }],
    options: defaultOptions,
  });
  assert.strictEqual(result.succeeded, false, 'a multi-object manifest must fail loudly');
  assert.ok(/exactly one Kubernetes object/i.test(result.output || ''), `unexpected error: ${result.output}`);
});

test('does not delete a pre-existing resource when the rollout fails', async () => {
  // KUBECTL_NS_EXISTS makes the stub report every `get` as success, i.e. the resource already
  // existed, so a failed rollout must leave it alone rather than destroying a working resource.
  const result = await run(
    {
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: defaultOptions,
    },
    { KUBECTL_FAIL: 'rollout status', KUBECTL_NS_EXISTS: '1' },
  );

  assert.strictEqual(result.succeeded, false);
  assert.ok(
    !result.commands.some((c) => c.startsWith('delete ')),
    `pre-existing resource must not be deleted: ${JSON.stringify(result.commands)}`,
  );
});

test('removes the deployment folder when it finishes', async () => {
  const deploymentId = `cleanup-${Date.now()}`;
  const folder = path.join(os.tmpdir(), 'hydra-k8s', deploymentId);
  const previous = { ...process.env };
  process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
  try {
    await handleK8sDeployment(
      { resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }], options: defaultOptions },
      noopLogger,
      fakeSocket,
      deploymentId,
    );
  } finally {
    process.env = previous;
  }
  assert.ok(!fs.existsSync(folder), `deployment folder left behind at ${folder}`);
});

test('fails when the cluster is unreachable', async () => {
  const result = await run(
    {
      resourceFiles: [{ name: 'deployment.yaml', data: deploymentYaml }],
      options: defaultOptions,
    },
    { KUBECTL_FAIL: 'cluster-info' },
  );
  assert.strictEqual(result.succeeded, false);
  assert.ok(/cannot reach the cluster/.test(result.output || ''), `unexpected error: ${result.output}`);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
