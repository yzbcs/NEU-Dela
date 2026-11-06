import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const binary = process.argv[2]
  ? resolve(process.argv[2])
  : (createRequire(import.meta.url)('electron') as string);
const output = resolve('assets/output/local-files-validation');
mkdirSync(join(output, 'runtime'), { recursive: true });
const directory = mkdtempSync(join(output, 'runtime', 'run-'));
const env: NodeJS.ProcessEnv = { ...process.env, DOLA_DATA_DIR: directory };
for (const key of [
  'DOLA_DEMO_CONFIG',
  'DOLA_MAIL_FIXTURE',
  'DOLA_PDF_FIXTURE',
  'ELECTRON_RENDERER_URL',
])
  delete env[key];

async function launch(flag: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(binary, [resolve('.'), flag], { stdio: 'inherit', env });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('本地资料验证超过 90 秒，已停止测试进程'));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? done() : reject(new Error('本地资料验证退出码：' + code));
    });
  });
}

await launch('--smoke-local-files');
await launch('--smoke-local-files-restore');
const reportPath = join(output, 'report.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
Object.assign(report, {
  version: JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version,
  runtime: process.argv[2]
    ? `packaged-${process.platform}-${process.arch}`
    : 'development-electron',
  realApiRequests: 0,
});
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
if (!report.passed || !report.restartPassed) throw new Error('本地资料验证未全部通过');
console.log(`本地资料验证通过：${report.checks.length} 项检查及重启恢复，真实模型请求 0 次。`);
console.log('报告：assets/output/local-files-validation/report.json');
