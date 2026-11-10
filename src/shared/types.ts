export type Protocol = 'openai-responses' | 'openai-chat' | 'anthropic';
export type Theme = 'light' | 'dark' | 'system';

export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  models?: ModelOption[];
  supportsImages?: boolean;
  hasKey: boolean;
}

export type ProviderInput = Omit<Provider, 'id' | 'hasKey'> & {
  id?: string;
  apiKey?: string;
};

export type ProviderConnectionInput = Pick<ProviderInput, 'id' | 'protocol' | 'baseUrl' | 'apiKey'>;

export interface ModelOption {
  id: string;
  name: string;
}

export interface WorkspaceSource {
  kind: 'timetable' | 'todos' | 'note' | 'resource' | 'mail' | 'campus' | 'overview' | 'attachment';
  id?: string;
  path?: string;
  label: string;
  citation: number;
}
export interface ReadActivity {
  id: string;
  label: string;
  status: 'reading' | 'done' | 'error' | 'stopped';
  detail?: string;
}

export type WorkspaceCreation = {
  id: string;
  status: 'created' | 'undone';
  detail: string;
} & (
  | { kind: 'todo'; record: import('./workspace').Todo }
  | { kind: 'course'; record: import('./workspace').Course }
  | { kind: 'note'; record: import('./workspace').Note }
);

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  state: 'complete' | 'streaming' | 'stopped' | 'error' | 'incomplete';
  error?: string;
  model?: string;
  providerName?: string;
  usage?: { input: number; output: number };
  sources?: WorkspaceSource[];
  activity?: ReadActivity[];
  creations?: WorkspaceCreation[];
  attachments?: ChatAttachment[];
  timetableDrafts?: TimetableProposal[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  kind: 'pdf' | 'text' | 'image';
  size: number;
}
export interface TimetableProposal {
  id: string;
  timetable: import('./workspace').TimetableImport;
}

export interface Chat {
  id: string;
  title: string;
  titleSummaryVersion?: number;
  providerId: string | null;
  model: string;
  messages: ChatMessage[];
  updatedAt: string;
}

import type { Workspace, WorkspaceApi } from './workspace';
export interface AppState {
  theme: Theme;
  providers: Provider[];
  chats: Chat[];
  workspace: Workspace;
}

export interface DolaApi {
  workspace: WorkspaceApi;
  load(): Promise<AppState>;
  setTheme(theme: Theme): Promise<void>;
  saveProvider(input: ProviderInput): Promise<Provider>;
  listModels(input: ProviderConnectionInput): Promise<ModelOption[]>;
  removeProvider(id: string): Promise<void>;
  probeProvider(id: string): Promise<{ text: string; milliseconds: number }>;
  probeProviderInput(input: ProviderInput): Promise<{ text: string; milliseconds: number }>;
  createChat(providerId?: string, model?: string): Promise<string>;
  selectProvider(chatId: string, providerId: string, model?: string): Promise<void>;
  removeChat(id: string): Promise<void>;
  send(chatId: string, text: string, attachmentIds?: string[]): Promise<void>;
  chooseChatAttachments(): Promise<ChatAttachment[]>;
  discardChatAttachments(ids: string[]): Promise<void>;
  openChatAttachment(id: string): Promise<void>;
  stop(chatId: string): Promise<void>;
  undoCreation(chatId: string, messageId: string, creationId: string): Promise<void>;
  onOpenTodo(listener: (id: string) => void): () => void;
  onChange(listener: (state: AppState) => void): () => void;
}

export const protocolLabels: Record<Protocol, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-chat': 'OpenAI Chat Completions',
  anthropic: 'Anthropic Messages',
};

export const providerDefaults = {
  openai: {
    name: 'OpenAI',
    protocol: 'openai-responses' as const,
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  },
  anthropic: {
    name: 'Anthropic',
    protocol: 'anthropic' as const,
    baseUrl: 'https://api.anthropic.com',
    model: '',
  },
};
