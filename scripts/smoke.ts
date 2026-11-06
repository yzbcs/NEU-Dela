import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startMockServer } from './mock-server';
import { startMailFixture, makeTimetableFixture } from './workspace-fixtures';

const require = createRequire(import.meta.url);
const binary = process.argv[2] ? resolve(process.argv[2]) : (require('electron') as string);
const mock = await startMockServer({ delayMs: 4 });
const mailFixture = await startMailFixture();
const pdfFixture = makeTimetableFixture();
const output = resolve('assets/output/ai-validation');
mkdirSync(output, { recursive: true });
rmSync(join(output, 'desktop.json'), { force: true });
rmSync(join(output, 'desktop-error.txt'), { force: true });
const directory = mkdtempSync(join(output, 'desktop-userdata-'));
const config = join(directory, 'fixtures.json');
writeFileSync(
  config,
  JSON.stringify([
    {
      name: '本地模拟 · OpenAI',
      protocol: 'openai-responses',
      baseUrl: mock.url + '/v1',
      model: 'dola-mock-openai',
      apiKey: 'fixture-openai-key',
    },
    {
      name: '本地模拟 · Anthropic',
      protocol: 'anthropic',
      baseUrl: mock.url,
      model: 'dola-mock-claude',
      apiKey: 'fixture-anthropic-key',
    },
    {
      name: '本地模拟 · 兼容接口',
      protocol: 'openai-chat',
      baseUrl: mock.url + '/v1',
      model: 'dola-mock-compatible',
      apiKey: 'fixture-chat-key',
    },
  ]),
);
async function launch(flag: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(binary, [resolve('.'), flag], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DOLA_DATA_DIR: directory,
        DOLA_DEMO_CONFIG: config,
        DOLA_PDF_FIXTURE: pdfFixture,
        DOLA_MAIL_FIXTURE: JSON.stringify({
          imapPort: mailFixture.imapPort,
          smtpPort: mailFixture.smtpPort,
        }),
        NODE_EXTRA_CA_CERTS: mailFixture.certPath,
      },
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('桌面冒烟超时'));
    }, 90_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? done() : reject(new Error('Electron 退出码：' + code));
    });
  });
}
try {
  await launch('--smoke-ai');
  await launch('--smoke-restore');
  const summary = JSON.parse(readFileSync(join(output, 'desktop.json'), 'utf8'));
  writeFileSync(
    join(output, 'desktop.json'),
    JSON.stringify(
      {
        ...summary,
        runtime: process.argv[2] ? 'packaged' : 'development',
        localHttpRequests: mock.requests.length,
        paths: Array.from(new Set(mock.requests.map((r) => r.path))),
        realApiRequests: 0,
        localSmtpMessages: mailFixture.sent.length,
        localImapCommands: mailFixture.commands.length,
      },
      null,
      2,
    ),
  );
  console.log('桌面冒烟通过：三协议、UI、加密配置、取消、错误与重启恢复。');
  console.log('报告：assets/output/ai-validation/desktop.json');
} finally {
  await mock.close();
  await mailFixture.close();
}
