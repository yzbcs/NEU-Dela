import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const binary = process.argv[2] ? resolve(process.argv[2]) : (require('electron') as string);
const output = resolve('assets/output/design-validation');
const runtime = join(output, 'runtime');
mkdirSync(runtime, { recursive: true });
const directory = mkdtempSync(join(runtime, 'run-'));
for (const name of ['report.json', 'design-error.txt', 'design-error.png'])
  rmSync(join(output, name), { force: true });
const env: NodeJS.ProcessEnv = { ...process.env, DOLA_DATA_DIR: directory };
for (const key of [
  'DOLA_DEMO_CONFIG',
  'DOLA_MAIL_FIXTURE',
  'DOLA_PDF_FIXTURE',
  'ELECTRON_RENDERER_URL',
])
  delete env[key];

await new Promise<void>((done, reject) => {
  const child = spawn(binary, [resolve('.'), '--smoke-design'], { stdio: 'inherit', env });
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error('设计验证超过 90 秒，已停止测试进程'));
  }, 90_000);
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timeout);
    code === 0 ? done() : reject(new Error('设计验证 Electron 退出码：' + code));
  });
});
const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
if (!report.passed)
  throw new Error('设计验证未通过，见 assets/output/design-validation/report.json');
console.log(`设计验证通过：${report.checks.length} 项检查、${report.screenshots.length} 张截图。`);
console.log('报告：assets/output/design-validation/report.json');
