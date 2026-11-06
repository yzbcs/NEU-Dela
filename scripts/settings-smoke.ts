import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { join, resolve } from 'node:path';
import { startMockServer } from './mock-server';

const binary = process.argv[2]
  ? resolve(process.argv[2])
  : (createRequire(import.meta.url)('electron') as string);
const output = resolve('assets/output/settings-validation');
mkdirSync(join(output, 'runtime'), { recursive: true });
const directory = mkdtempSync(join(output, 'runtime', 'run-'));
const mock = await startMockServer({ delayMs: 2 });
let mailConnections = 0;
const mail = tcpServer((socket) => {
  mailConnections++;
  socket.destroy();
});
await new Promise<void>((done) => mail.listen(0, '127.0.0.1', done));
const mailPort = (mail.address() as { port: number }).port;
// This endpoint exposes only the loopback fixture's observations to the Electron test process.
const metrics = httpServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      modelRequests: mock.requests.length,
      lastModel: mock.requests.at(-1)?.body?.model ?? null,
      mailConnections,
      mailPort,
    }),
  );
});
await new Promise<void>((done) => metrics.listen(0, '127.0.0.1', done));
const metricsUrl = `http://127.0.0.1:${(metrics.address() as { port: number }).port}`;
const config = join(directory, 'fixtures.json');
writeFileSync(
  config,
  JSON.stringify(
    ['A', 'B'].map((letter) => ({
      name: '人工服务 ' + letter,
      protocol: 'openai-responses',
      baseUrl: mock.url + '/v1',
      model: 'dola-mock-' + letter.toLowerCase(),
      models: [{ id: 'dola-mock-' + letter.toLowerCase(), name: '人工模型 ' + letter }],
      apiKey: 'fixture-settings-key-' + letter,
    })),
  ),
);

async function launch(restore = false) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOLA_DATA_DIR: directory,
    DOLA_SETTINGS_METRICS_URL: metricsUrl,
  };
  for (const name of [
    'ELECTRON_RENDERER_URL',
    'DOLA_MAIL_FIXTURE',
    'DOLA_PDF_FIXTURE',
    'DOLA_DEMO_CONFIG',
  ])
    delete env[name];
  if (!restore) env.DOLA_DEMO_CONFIG = config;
  await new Promise<void>((done, reject) => {
    const flag = restore ? '--smoke-settings-restore' : '--smoke-settings';
    const child = spawn(binary, [resolve('.'), flag], { stdio: 'inherit', env });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('设置验证超过 120 秒，已停止测试进程'));
    }, 120_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? done() : reject(new Error('设置验证退出码：' + code));
    });
  });
}

try {
  await launch();
  await launch(true);
  const reportPath = join(output, 'report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  Object.assign(report, {
    version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version,
    runtime: process.argv[2] ? 'packaged-mac' : 'development-electron',
    realApiRequests: 0,
    localHttpRequests: mock.requests.length,
    mailConnections,
  });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (!report.passed || !report.restartPassed) throw new Error('设置验证未全部通过');
  console.log(`设置验证通过：${report.checks.length} 项及重启恢复；真实模型请求 0 次。`);
} finally {
  await mock.close();
  await Promise.all([
    new Promise<void>((done) => {
      metrics.close(() => done());
      metrics.closeAllConnections();
    }),
    new Promise<void>((done) => mail.close(() => done())),
  ]);
}
