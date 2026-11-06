import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Chat, ChatMessage, Provider } from '../shared/types';
import type { Store } from './store';
import { buildSystemPrompt, createPiRuntime } from './ai';

export function savedSessionPath(store: Store, chatId: string) {
  return SessionManager.findById(
    store.dataDirectory,
    chatId,
    join(store.dataDirectory, 'pi-sessions'),
  );
}

export async function createChatSession(options: {
  store: Store;
  chat: Chat;
  history: ChatMessage[];
  provider: Provider;
  apiKey: string;
  tools: ToolDefinition[];
  workspaceContext?: string;
}) {
  const { store, chat, history, provider, apiKey, tools, workspaceContext } = options;
  const cwd = store.dataDirectory;
  const directory = join(cwd, 'pi-sessions');
  mkdirSync(directory, { recursive: true });
  const existing = savedSessionPath(store, chat.id);
  const manager = existing
    ? SessionManager.open(existing, directory, cwd)
    : SessionManager.create(cwd, directory, { id: chat.id });
  const { modelRuntime, model } = await createPiRuntime(provider, apiKey);

  // Older chats contain visible messages and creation receipts, but no tool transcript.
  // Import those once; new turns are persisted by Pi with their full tool results.
  if (!existing) {
    for (const message of history) {
      const text =
        message.text +
        (message.creations?.length
          ? '\n\n工作台实际操作记录：' + JSON.stringify(message.creations)
          : '');
      if (!text) continue;
      if (message.role === 'user') {
        manager.appendMessage({
          role: 'user',
          content: text,
          timestamp: Date.parse(message.createdAt),
        });
      } else {
        const input = message.usage?.input ?? 0;
        const output = message.usage?.output ?? 0;
        manager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text }],
          api: model.api,
          provider: model.provider,
          model: message.model || model.id,
          timestamp: Date.parse(message.createdAt),
          stopReason: 'stop',
          usage: {
            input,
            output,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: input + output,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        });
      }
    }
  }

  const contextReserve = Math.min(8192, Math.floor(model.contextWindow / 4));
  const settings = SettingsManager.inMemory({
    compaction: {
      enabled: true,
      reserveTokens: contextReserve,
      keepRecentTokens: contextReserve,
    },
    retry: {
      enabled: false,
      maxRetries: 0,
      provider: { maxRetries: 0, timeoutMs: 120_000 },
    },
    cacheWarming: 'off',
    enableAnalytics: false,
    enableInstallTelemetry: false,
  });
  const agentDir = join(cwd, 'pi');
  const resources = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => buildSystemPrompt(workspaceContext),
    extensionFactories: [
      (pi) => {
        pi.on('before_agent_start', (event) => {
          // Campus tools use record IDs; the coding harness's local cwd is irrelevant.
          event.systemPromptOptions.cwd = '校园工作台';
        });
      },
    ],
  });
  await resources.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: 'off',
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: resources,
    tools: tools.map((tool) => tool.name),
    customTools: tools,
  });
  session.agent.toolExecution = 'sequential';
  // OpenAI-compatible services keep their own output default, as in existing Dola chats.
  // Messages requires max_tokens; Pi continues to supply it for Anthropic.
  if (provider.protocol !== 'anthropic') {
    session.agent.onPayload = (payload) => {
      const request = payload as Record<string, unknown>;
      delete request.max_tokens;
      delete request.max_completion_tokens;
      delete request.max_output_tokens;
      return request;
    };
  }
  return session;
}
