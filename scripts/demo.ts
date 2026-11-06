import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startMockServer } from './mock-server';

const mock = await startMockServer({ delayMs: 28 });
const directory = resolve('assets/output/demo');
mkdirSync(directory, { recursive: true });
const config = join(directory, 'providers.json');
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
  ]),
);
console.log('本地模拟服务已启动；只使用人工测试密钥，不连接外部模型。');
const child = spawn(
  process.execPath,
  [resolve('node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--watch'],
  {
    stdio: 'inherit',
    env: { ...process.env, DOLA_DATA_DIR: join(directory, 'userdata'), DOLA_DEMO_CONFIG: config },
  },
);
async function stop() {
  child.kill('SIGTERM');
  await mock.close();
}
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
child.on('exit', async (code) => {
  await mock.close();
  process.exit(code ?? 0);
});
