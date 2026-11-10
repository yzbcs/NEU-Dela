import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { providerInput, sdkBaseUrl } from '../shared/validation';
import { emptyWorkspace, type Workspace } from '../shared/workspace';
import {
  chatTitleVersion,
  hasLegacyAutomaticTitle,
  summarizeChatTitle,
} from '../shared/chat-title';
import type {
  AppState,
  Chat,
  ModelOption,
  Provider,
  ProviderConnectionInput,
  ProviderInput,
  Theme,
} from '../shared/types';

export interface SecretCodec {
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

export class Store {
  theme: Theme = 'system';
  workspace: Workspace = emptyWorkspace();
  providers: Provider[] = [];
  chats: Chat[] = [];
  private keys: Record<string, string> = {};

  constructor(
    private directory: string,
    private codec: SecretCodec,
  ) {
    mkdirSync(directory, { recursive: true });
    if (existsSync(this.path('workspace.json')))
      this.workspace = {
        ...emptyWorkspace(),
        ...JSON.parse(readFileSync(this.path('workspace.json'), 'utf8')),
      };
    if (existsSync(this.path('settings.json'))) {
      const settings = JSON.parse(readFileSync(this.path('settings.json'), 'utf8'));
      this.providers = settings.providers;
      this.theme = settings.theme ?? 'system';
      if (!settings.imageInputDefaultsApplied) {
        this.providers = this.providers.map((provider) => ({ ...provider, supportsImages: true }));
        this.saveSettings();
      }
    }
    if (existsSync(this.path('keys.bin'))) {
      this.keys = JSON.parse(codec.decrypt(readFileSync(this.path('keys.bin'))));
    }
    if (existsSync(this.path('chats.json'))) {
      this.chats = JSON.parse(readFileSync(this.path('chats.json'), 'utf8'));
      for (const chat of this.chats)
        for (const message of chat.messages) {
          if (message.state === 'streaming') {
            message.state = 'stopped';
            message.error = '上次生成因应用退出而中断，可以继续提问。';
          }
        }
      let updatedTitles = false;
      for (const chat of this.chats) {
        if (!chat.messages.length || (chat.titleSummaryVersion ?? 0) >= chatTitleVersion) continue;
        if (hasLegacyAutomaticTitle(chat)) chat.title = summarizeChatTitle(chat.messages);
        chat.titleSummaryVersion = chatTitleVersion;
        updatedTitles = true;
      }
      if (updatedTitles) this.saveChats();
    }
  }

  private path(name: string) {
    return join(this.directory, name);
  }
  private write(name: string, bytes: string | Buffer) {
    const path = this.path(name);
    writeFileSync(path + '.tmp', bytes);
    renameSync(path + '.tmp', path);
  }
  snapshot(): AppState {
    return {
      theme: this.theme,
      providers: this.providers.map((p) => ({ ...p, hasKey: Boolean(this.keys[p.id]) })),
      chats: this.chats,
      workspace: this.workspace,
    };
  }
  provider(id: string): Provider {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) throw new Error('模型服务不存在，请重新选择');
    return provider;
  }
  key(id: string) {
    return this.keys[id] ?? '';
  }
  setSecret(id: string, value: string) {
    const keys = { ...this.keys };
    if (value) keys[id] = value;
    else delete keys[id];
    this.write('keys.bin', this.codec.encrypt(JSON.stringify(keys)));
    this.keys = keys;
  }
  saveWorkspace() {
    this.write('workspace.json', JSON.stringify(this.workspace, null, 2));
  }
  private saveSettings() {
    this.write(
      'settings.json',
      JSON.stringify(
        { providers: this.providers, theme: this.theme, imageInputDefaultsApplied: true },
        null,
        2,
      ),
    );
  }
  setTheme(theme: Theme) {
    this.theme = theme;
    this.saveSettings();
  }
  get dataDirectory() {
    return this.directory;
  }
  redact(text: string): string {
    for (const key of Object.values(this.keys))
      if (key) text = text.replaceAll(key, '[已隐藏密钥]');
    return text;
  }
  connectionKey(input: ProviderConnectionInput): string {
    const saved = input.id ? this.provider(input.id) : undefined;
    if (saved && new URL(saved.baseUrl).origin !== new URL(input.baseUrl).origin && !input.apiKey) {
      throw new Error('更换服务地址后，请重新填写该服务的 API Key');
    }
    const key = input.apiKey || (saved ? this.key(saved.id) : '');
    if (!key) throw new Error('请填写 API Key；本地模拟服务可填写测试密钥');
    return key;
  }
  chat(id: string): Chat {
    const chat = this.chats.find((c) => c.id === id);
    if (!chat) throw new Error('会话不存在');
    return chat;
  }
  saveProvider(raw: ProviderInput): Provider {
    const input = providerInput.parse(raw);
    const previous = input.id ? this.provider(input.id) : undefined;
    const id = input.id ?? randomUUID();
    const { apiKey, ...metadata } = input;
    const key = this.connectionKey(input);
    const keys = { ...this.keys, [id]: key };
    const encrypted = this.codec.encrypt(JSON.stringify(keys));
    this.write('keys.bin', encrypted);
    this.keys = keys;
    const sameConnection =
      previous &&
      previous.protocol === input.protocol &&
      sdkBaseUrl(previous.baseUrl, previous.protocol) === sdkBaseUrl(input.baseUrl, input.protocol);
    const provider: Provider = {
      ...metadata,
      id,
      hasKey: true,
      models: input.models ?? (sameConnection ? previous.models : undefined),
    };
    this.providers = [...this.providers.filter((p) => p.id !== id), provider];
    this.saveSettings();
    return provider;
  }
  removeProvider(id: string) {
    this.provider(id);
    const keys = { ...this.keys };
    delete keys[id];
    this.write('keys.bin', this.codec.encrypt(JSON.stringify(keys)));
    this.keys = keys;
    this.providers = this.providers.filter((p) => p.id !== id);
    this.saveSettings();
  }
  saveModels(id: string, models: ModelOption[]) {
    this.provider(id).models = models;
    this.saveSettings();
  }
  saveChats() {
    this.write('chats.json', JSON.stringify(this.chats, null, 2));
  }
  createChat(providerId?: string, model?: string): string {
    const provider = providerId ? this.provider(providerId) : this.providers[0];
    const id = randomUUID();
    this.chats.unshift({
      id,
      title: '新对话',
      providerId: provider?.id ?? null,
      model: model ?? provider?.model ?? '',
      messages: [],
      updatedAt: new Date().toISOString(),
    });
    this.saveChats();
    return id;
  }
}
