import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { Store, type SecretCodec } from '../src/main/store';
import { ChatService } from '../src/main/chat';
import { startMockServer } from '../scripts/mock-server';
import type { AppState } from '../src/shared/types';

const key = randomBytes(32);
const codec: SecretCodec = {
  encrypt(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  },
  decrypt(data) {
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  },
};
let directory: string;
let store: Store;
let service: ChatService;
let snapshots: AppState[];
let mock: Awaited<ReturnType<typeof startMockServer>>;
beforeAll(async () => {
  mock = await startMockServer({ delayMs: 0 });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  const root = resolve('assets/output/test-state');
  mkdirSync(root, { recursive: true });
  directory = mkdtempSync(join(root, 'case-'));
  store = new Store(directory, codec);
  snapshots = [];
  service = new ChatService(store, (snapshot) => snapshots.push(structuredClone(snapshot)));
});
afterEach(() => {
  service.stopAll();
  rmSync(directory, { recursive: true, force: true });
});

function addProvider() {
  return store.saveProvider({
    name: '本地测试',
    protocol: 'openai-responses',
    baseUrl: mock.url + '/v1',
    model: 'dola-mock-model',
    apiKey: 'fixture-private-key',
  });
}
it('主题默认跟随系统，保存服务和刷新模型列表不会覆盖主题，重启后保留选择', () => {
  expect(store.theme).toBe('system');
  store.setTheme('dark');
  const provider = addProvider();
  store.saveModels(provider.id, [{ id: 'fixture-model', name: '人工模型' }]);
  store.saveProvider({ ...provider, name: '修改服务名称' });
  expect(new Store(directory, codec).snapshot().theme).toBe('dark');
  store.removeProvider(provider.id);
  const reopened = new Store(directory, codec);
  expect(reopened.theme).toBe('dark');
  expect(reopened.providers).toHaveLength(0);
});

it('密钥加密保存，设置与 IPC 快照不包含明文，重开可继续使用', () => {
  const provider = addProvider();
  expect(
    readFileSync(join(directory, 'keys.bin')).includes(Buffer.from('fixture-private-key')),
  ).toBe(false);
  expect(readFileSync(join(directory, 'settings.json'), 'utf8')).not.toContain(
    'fixture-private-key',
  );
  expect(JSON.stringify(store.snapshot())).not.toContain('fixture-private-key');
  const reopened = new Store(directory, codec);
  expect(reopened.key(provider.id)).toBe('fixture-private-key');
  expect(reopened.snapshot().providers[0].hasKey).toBe(true);
});

it('获取模型支持未保存配置，复用已保存密钥，并且不保存草稿', async () => {
  expect(
    await service.listModels({
      protocol: 'openai-chat',
      baseUrl: mock.url,
      apiKey: 'fixture-new-key',
    }),
  ).toHaveLength(3);
  expect(store.providers).toHaveLength(0);
  const provider = addProvider();
  expect(
    await service.listModels({
      id: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
    }),
  ).toHaveLength(3);
  expect(mock.requests.at(-1)!.headers.authorization).toBe('Bearer fixture-private-key');
  expect(store.providers).toHaveLength(1);
});

it('更换服务域名后获取模型需要重新填写密钥，错误内容不回显密钥', async () => {
  const provider = addProvider();
  const before = mock.requests.length;
  await expect(
    service.listModels({ ...provider, baseUrl: 'https://example.com/v1' }),
  ).rejects.toThrow('重新填写');
  expect(mock.requests.length).toBe(before);
  await expect(
    service.listModels({ protocol: 'anthropic', baseUrl: mock.url, apiKey: 'fixture-denied-key' }),
  ).rejects.toThrow('[已隐藏密钥]');
});

it('已保存服务的模型列表可在重启后复用，连接草稿不覆盖已有列表', async () => {
  const provider = addProvider();
  const models = await service.listModels({
    id: provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
  });
  expect(new Store(directory, codec).provider(provider.id).models).toEqual(models);
  await service.listModels({ id: provider.id, protocol: 'anthropic', baseUrl: provider.baseUrl });
  expect(store.provider(provider.id).models).toEqual(models);
  const { models: omitted, ...metadata } = store.provider(provider.id);
  store.saveProvider({ ...metadata, name: '更新服务名称' });
  expect(new Store(directory, codec).provider(provider.id).models).toEqual(models);
});

it('新对话与已有对话均使用所选模型，独立记忆且不改服务默认模型或历史归属', async () => {
  const provider = addProvider();
  const id = store.createChat(provider.id, 'dola-mock-claude');
  const otherId = store.createChat(provider.id);
  await service.send(id, '第一轮');
  expect(mock.requests.at(-1)!.body.model).toBe('dola-mock-claude');
  service.selectModel(id, provider.id, 'dola-mock-compatible');
  await service.send(id, '换模型后的第二轮');
  expect(mock.requests.at(-1)!.body.model).toBe('dola-mock-compatible');
  expect(mock.requests.at(-1)!.body.input).toHaveLength(3);
  const reopened = new Store(directory, codec);
  expect(reopened.chat(id).model).toBe('dola-mock-compatible');
  expect(reopened.chat(id).messages[1].model).toBe('dola-mock-claude');
  expect(reopened.chat(id).messages[3].model).toBe('dola-mock-compatible');
  expect(reopened.chat(otherId).model).toBe('dola-mock-model');
  expect(reopened.provider(provider.id).model).toBe('dola-mock-model');
});

it('旧配置中的输出 Token 设置不再限制 OpenAI 对话，原配置仍可读取', async () => {
  const provider = addProvider();
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({ providers: [{ ...provider, maxOutputTokens: 8192 }] }),
  );
  const reopened = new Store(directory, codec);
  const restoredService = new ChatService(reopened, () => {});
  await restoredService.send(reopened.createChat(provider.id), '使用已有配置');
  expect(reopened.chats[0].messages.at(-1)?.state).toBe('complete');
  expect(mock.requests.at(-1)!.body.max_output_tokens).toBeUndefined();
});

it('编辑服务留空保留密钥，删除服务后清除对应凭据', () => {
  const provider = addProvider();
  store.saveProvider({ ...provider, name: '改名', apiKey: '' });
  expect(store.key(provider.id)).toBe('fixture-private-key');
  store.removeProvider(provider.id);
  expect(new Store(directory, codec).key(provider.id)).toBe('');
});

it('发送两轮消息时保留历史、模型归属与结果，重开后内容仍在', async () => {
  const provider = addProvider();
  const id = store.createChat(provider.id);
  await service.send(id, '第一轮');
  await service.send(id, '第二轮');
  const chat = new Store(directory, codec).chat(id);
  expect(chat.messages).toHaveLength(4);
  expect(chat.messages[3].state).toBe('complete');
  expect(chat.messages[3].model).toBe('dola-mock-model');
  expect(mock.requests.at(-1)!.body.input).toHaveLength(3);
  expect(snapshots.some((s) => s.chats[0].messages.at(-1)?.state === 'streaming')).toBe(true);
});

it('请求失败保留用户问题，并把 assistant 标记为 error', async () => {
  const provider = addProvider();
  const id = store.createChat(provider.id);
  await service.send(id, '[http401]');
  const chat = new Store(directory, codec).chat(id);
  expect(chat.messages[0].text).toBe('[http401]');
  expect(chat.messages[1].state).toBe('error');
  expect(chat.messages[1].error).toContain('API Key');
});

it('停止生成保留部分文字，重开仍为 stopped', async () => {
  const provider = addProvider();
  const id = store.createChat(provider.id);
  const task = service.send(id, '[slow]');
  while (!store.chat(id).messages.at(-1)?.text) await new Promise((r) => setTimeout(r, 5));
  service.stop(id);
  await task;
  const reply = new Store(directory, codec).chat(id).messages.at(-1)!;
  expect(reply.state).toBe('stopped');
  expect(reply.text.length).toBeGreaterThan(0);
});

it('同一会话运行中不能重复发送，避免重复请求和历史交错', async () => {
  const provider = addProvider();
  const id = store.createChat(provider.id);
  const task = service.send(id, '[slow]');
  await expect(service.send(id, '第二个请求')).rejects.toThrow('等待');
  expect(() => service.selectModel(id, provider.id, 'dola-mock-compatible')).toThrow('生成结束后');
  service.stop(id);
  await task;
  expect(store.chat(id).messages.filter((m) => m.role === 'user')).toHaveLength(1);
});
