import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startMockServer } from './mock-server';

const binary = process.argv[2]
  ? resolve(process.argv[2])
  : (createRequire(import.meta.url)('electron') as string);
const output = resolve('assets/output/actions-validation');
mkdirSync(join(output, 'runtime'), { recursive: true });
const directory = mkdtempSync(join(output, 'runtime', 'run-'));
const mock = await startMockServer({ delayMs: 2 });
const config = join(directory, 'fixtures.json');
writeFileSync(
  config,
  JSON.stringify([
    {
      name: '本地模拟 · 操作验证',
      protocol: 'openai-responses',
      baseUrl: mock.url + '/v1',
      model: 'dola-mock-model',
      apiKey: 'fixture-actions-key',
    },
  ]),
);
async function launch(flag: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOLA_DATA_DIR: directory,
    DOLA_DEMO_CONFIG: config,
  };
  delete env.ELECTRON_RENDERER_URL;
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(binary, [resolve('.'), flag], { stdio: 'inherit', env });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('操作验证超过90秒'));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolveRun() : reject(new Error('操作验证退出码：' + code));
    });
  });
}
try {
  await launch('--smoke-actions');
  await launch('--smoke-actions-restore');
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  Object.assign(report, {
    version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version,
    runtime: process.argv[2] ? 'packaged-mac' : 'development-electron',
    realApiRequests: 0,
    localHttpRequests: mock.requests.length,
  });
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('操作验证通过：' + report.checks.length + ' 项及重启恢复；真实模型请求0次。');
} finally {
  await mock.close();
}
