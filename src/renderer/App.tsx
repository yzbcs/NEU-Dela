import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  FileText,
  GraduationCap,
  KeyRound,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  X,
  Zap,
  Sun,
  Moon,
  Monitor,
  LayoutDashboard,
  UserRound,
  Database,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AppState,
  Chat,
  ChatMessage,
  ModelOption,
  Protocol,
  Provider,
  ProviderInput,
  WorkspaceSource,
  WorkspaceCreation,
} from '../shared/types';
import { protocolLabels, providerDefaults } from '../shared/types';
import { SelectMenu } from './components/SelectMenu';
import { emptyWorkspace, type Page } from '../shared/workspace';
import { TodosPage, TimetablePage, CampusPage, Modal } from './WorkspacePages';
import { LibraryPage } from './LibraryPage';
import { flushNoteEdits } from './components/useNoteEditor';
import { DashboardPage } from './DashboardPage';
import { MailPage } from './MailPage';
import { WorkspaceSearch } from './components/WorkspaceSearch';
import { WorkspaceCreationCard } from './components/WorkspaceCreationCard';
import { StartupScreen } from './components/StartupScreen';
import type { WorkspaceSearchResult } from '../shared/search';
import appIcon from '../../assets/icon.png';
import './workspace.css';

const empty: AppState = { theme: 'system', providers: [], chats: [], workspace: emptyWorkspace() };
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={'brand ' + (small ? 'brand-small' : '')}>
      <span className="brand-mark">
        <img src={appIcon} alt={small ? 'NEU-Dela' : ''} draggable={false} />
      </span>
      {!small && (
        <span>
          <strong>NEU-Dela</strong>
          <small>东北大学 · 学生工作台</small>
        </span>
      )}
    </div>
  );
}

function ProviderForm({
  provider,
  kind,
  onSave,
  saving,
  onRemove,
}: {
  provider?: Provider;
  kind: 'openai' | 'anthropic';
  onSave: (input: ProviderInput, test: boolean) => Promise<Provider | undefined>;
  onRemove: (id: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<ProviderInput>(
    provider ? { ...provider, apiKey: '' } : { ...providerDefaults[kind], apiKey: '' },
  );
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(provider?.models ?? []);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [manualModel, setManualModel] = useState(!provider?.models?.length);
  const [modelNotice, setModelNotice] = useState('');
  const update = <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) => {
    setDraft((old) => ({ ...old, [key]: value }));
    if (key === 'protocol' || key === 'baseUrl' || key === 'apiKey') {
      setModels([]);
      setManualModel(true);
      setModelNotice('');
    }
  };
  async function fetchModels() {
    setFetchingModels(true);
    setModelNotice('');
    try {
      const available = await window.dola.listModels({
        id: provider?.id,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey || undefined,
      });
      setModels(available);
      setManualModel(available.length === 0);
      if (available.length) {
        setDraft((old) => ({ ...old, model: old.model || available[0].id }));
      } else setModelNotice('服务没有返回可选模型，请手动填写模型 ID。');
    } catch (error) {
      setModelNotice('获取失败：' + errorText(error) + ' 可以继续手动填写模型 ID。');
    } finally {
      setFetchingModels(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    void onSave(
      {
        id: provider?.id,
        name: draft.name,
        protocol: draft.protocol,
        baseUrl: draft.baseUrl,
        model: draft.model,
        models,
        apiKey: draft.apiKey || undefined,
      },
      button?.value === 'test',
    ).then((saved) => {
      if (saved) setDraft((old) => ({ ...old, apiKey: '' }));
    });
  }
  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="form-heading">
        <div
          className={'provider-logo ' + (draft.protocol === 'anthropic' ? 'anthropic' : 'openai')}
        >
          {draft.protocol === 'anthropic' ? 'A' : <Sparkles size={24} />}
        </div>
        <div>
          <h2>{provider ? '编辑模型服务' : '添加模型服务'}</h2>
          <p>连接你选择的模型，让学习和思考继续。</p>
        </div>
        {provider && (
          <button
            type="button"
            className="icon-button danger"
            title="删除此服务"
            aria-label="删除此服务"
            onClick={() => onRemove(provider.id)}
            disabled={saving || fetchingModels}
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      <label>
        服务名称
        <input
          name="providerName"
          required
          value={draft.name}
          maxLength={80}
          onChange={(e) => update('name', e.target.value)}
          placeholder="例如：我的 OpenAI 服务"
        />
      </label>
      <label htmlFor="provider-protocol">
        接口类型
        <SelectMenu
          id="provider-protocol"
          name="protocol"
          label="接口类型"
          value={draft.protocol}
          disabled={saving || fetchingModels}
          onChange={(value) => update('protocol', value as Protocol)}
          options={[
            { value: 'openai-responses', label: 'OpenAI · Responses' },
            { value: 'openai-chat', label: 'OpenAI · Chat Completions（兼容接口）' },
            { value: 'anthropic', label: 'Anthropic · Messages' },
          ]}
        />
      </label>
      <label>
        服务地址
        <input
          name="baseUrl"
          type="url"
          required
          value={draft.baseUrl}
          disabled={saving || fetchingModels}
          onChange={(e) => update('baseUrl', e.target.value)}
          spellCheck={false}
          placeholder={
            draft.protocol === 'anthropic'
              ? 'https://api.anthropic.com'
              : 'https://api.openai.com/v1'
          }
        />
        <small>支持官方服务和对应协议的第三方服务。地址由你确认。</small>
      </label>
      <label>
        API Key
        <span className="secret-input">
          <input
            name="apiKey"
            type={showKey ? 'text' : 'password'}
            value={draft.apiKey}
            disabled={saving || fetchingModels}
            onChange={(e) => update('apiKey', e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            required={!provider?.hasKey}
            placeholder={provider?.hasKey ? '已保存，留空保留现有密钥' : '输入该服务提供的 API Key'}
          />
          <button
            type="button"
            aria-label={showKey ? '隐藏输入的密钥' : '显示输入的密钥'}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <div className="model-field">
        <label htmlFor="provider-model">模型 ID</label>
        <div className="model-field-row">
          {models.length > 0 && !manualModel ? (
            <SelectMenu
              id="provider-model"
              name="model"
              label="模型 ID"
              value={draft.model}
              onChange={(value) => update('model', value)}
              disabled={saving || fetchingModels}
              searchable
              options={[
                ...(!models.some((model) => model.id === draft.model) && draft.model
                  ? [{ value: draft.model, label: draft.model }]
                  : []),
                ...models.map((model) => ({ value: model.id, label: model.name || model.id })),
              ]}
            />
          ) : (
            <input
              id="provider-model"
              name="model"
              required
              value={draft.model}
              maxLength={200}
              onChange={(e) => update('model', e.target.value)}
              placeholder="获取模型列表，或手动填写 ID"
              spellCheck={false}
            />
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void fetchModels()}
            disabled={
              saving ||
              fetchingModels ||
              !draft.baseUrl.trim() ||
              (!draft.apiKey?.trim() && !provider?.hasKey)
            }
          >
            <RefreshCw size={14} className={fetchingModels ? 'spinning' : ''} />
            {fetchingModels ? '正在获取' : '获取模型'}
          </button>
        </div>
        {models.length > 0 && (
          <div className="model-field-help">
            <span>已获取 {models.length} 个模型</span>
            <button type="button" onClick={() => setManualModel(!manualModel)}>
              {manualModel ? '从列表选择' : '手动输入模型 ID'}
            </button>
          </div>
        )}
        {modelNotice && (
          <p className="model-notice" role="status">
            {modelNotice}
          </p>
        )}
      </div>
      <div className="privacy-note">
        <ShieldCheck size={18} />
        <p>密钥通过系统密钥存储加密保存在这台电脑。对话会发送给你选择的服务。</p>
      </div>
      <div className="form-footer">
        <button
          className="secondary-button"
          type="submit"
          value="test"
          disabled={saving || fetchingModels}
        >
          <Zap size={15} />
          {saving ? '正在处理' : '保存并测试'}
        </button>
        <button
          className="primary-button"
          type="submit"
          value="save"
          disabled={saving || fetchingModels}
        >
          <Check size={16} />
          保存服务
        </button>
      </div>
      <p className="test-explanation">测试会向所选服务发送一条简短消息，可能产生少量费用。</p>
    </form>
  );
}

function Settings({
  providers,
  onClose,
  onSave,
  saving,
  onRemove,
  onError,
}: {
  providers: Provider[];
  onClose: () => void;
  onSave: (input: ProviderInput, test: boolean) => Promise<Provider | undefined>;
  saving: boolean;
  onRemove: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(providers[0]?.id ?? 'new-openai');
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const provider = providers.find((p) => p.id === editing);
  useEffect(() => {
    if (!editing.startsWith('new-') && !providers.some((p) => p.id === editing)) {
      setEditing(providers[0]?.id ?? 'new-openai');
    }
  }, [providers, editing]);
  return (
    <section className="settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">PREFERENCES</span>
          <h1>设置</h1>
          <p>管理模型服务与应用帮助。</p>
        </div>
        <button className="secondary-button" onClick={onClose}>
          <X size={16} />
          返回
        </button>
      </header>
      <div className="settings-grid">
        <aside className="provider-list">
          <span className="section-label">
            我的服务 <span>{providers.length}</span>
          </span>
          {providers.map((p) => (
            <button
              key={p.id}
              className={'provider-item ' + (editing === p.id ? 'selected' : '')}
              onClick={() => setEditing(p.id)}
              disabled={saving}
            >
              <span className={'tiny-logo ' + (p.protocol === 'anthropic' ? 'anthropic' : '')}>
                {p.protocol === 'anthropic' ? 'A' : <Sparkles size={16} />}
              </span>
              <span>
                <strong>{p.name}</strong>
                <small>{protocolLabels[p.protocol]}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
          <div className="add-service-label">添加服务</div>
          <button
            className={'add-service ' + (editing === 'new-openai' ? 'selected' : '')}
            onClick={() => setEditing('new-openai')}
            disabled={saving}
          >
            <Plus size={16} />
            OpenAI 接口
          </button>
          <button
            className={'add-service ' + (editing === 'new-anthropic' ? 'selected' : '')}
            onClick={() => setEditing('new-anthropic')}
            disabled={saving}
          >
            <Plus size={16} />
            Anthropic 接口
          </button>
          <div className="settings-tip">
            <CircleHelp size={17} />
            <p>模型由服务提供方运行。你可以添加多个服务，在对话输入框下方切换。</p>
          </div>
        </aside>
        <ProviderForm
          key={editing}
          provider={provider}
          kind={editing === 'new-anthropic' ? 'anthropic' : 'openai'}
          saving={saving}
          onRemove={onRemove}
          onSave={async (input, test) => {
            const saved = await onSave(input, test);
            if (saved) setEditing(saved.id);
            return saved;
          }}
        />
      </div>
      <details className="settings-support">
        <summary>
          <CircleHelp size={15} />
          帮助与诊断
        </summary>
        <p className="muted">遇到问题时，可以查看本机日志，或打开应用数据文件夹。</p>
        <div className="diagnostic-actions">
          <button
            className="secondary-button"
            onClick={() =>
              window.dola.workspace.getDiagnostics().then(setDiagnostics).catch(onError)
            }
          >
            <FileText size={15} />
            查看错误日志
          </button>
          <button
            className="secondary-button"
            onClick={() => window.dola.workspace.showDataFolder().catch(onError)}
          >
            <FolderOpen size={15} />
            打开本地数据目录
          </button>
        </div>
      </details>
      {diagnostics !== null && (
        <Modal title="错误日志" onClose={() => setDiagnostics(null)} wide>
          <p className="muted">日志保存在这台电脑，已隐藏已保存的密钥和邮箱授权码。</p>
          <pre className="diagnostics-text">{diagnostics}</pre>
          <button
            className="secondary-button"
            onClick={() => navigator.clipboard.writeText(diagnostics).catch(onError)}
          >
            复制日志
          </button>
        </Modal>
      )}
    </section>
  );
}

function Message({
  message,
  onSource,
  onOpenCreation,
  onUndoCreation,
}: {
  message: ChatMessage;
  onSource: (source: WorkspaceSource) => void;
  onOpenCreation: (creation: WorkspaceCreation) => void;
  onUndoCreation: (id: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <article className={'message message-' + message.role} data-message-id={message.id}>
      {message.role === 'assistant' ? (
        <Brand small />
      ) : (
        <div className="user-avatar" role="img" aria-label="你的头像">
          <UserRound size={18} />
        </div>
      )}
      <div className="message-content">
        <div className="message-label">
          {message.role === 'user' ? '你' : 'NEU-Dela'}
          {message.role === 'assistant' && <span>{message.model}</span>}
        </div>
        {!!message.activity?.length && (
          <details className="read-activity" open={message.state === 'streaming'}>
            <summary>
              <Database size={12} />
              工作台操作记录 · {message.activity.length} 项
            </summary>
            <div>
              {message.activity.map((step) => (
                <div key={step.id} className={'read-step ' + step.status}>
                  {step.status === 'done' ? (
                    <Check size={12} />
                  ) : step.status === 'error' ? (
                    <CircleHelp size={12} />
                  ) : (
                    <span className="read-step-dot" />
                  )}
                  <span>
                    {step.detail || step.label}
                    {step.status === 'reading'
                      ? ' · 正在处理'
                      : step.status === 'stopped'
                        ? ' · 已停止'
                        : ''}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
        {message.text ? (
          <div className="markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
              }}
            >
              {message.text}
            </Markdown>
          </div>
        ) : message.state === 'streaming' ? (
          <div className="thinking">
            <i />
            <i />
            <i />
            <span>正在思考</span>
          </div>
        ) : null}
        {!!message.creations?.length && (
          <div className="workspace-creations" aria-label="已创建的工作台记录">
            {message.creations.map((creation) => (
              <WorkspaceCreationCard
                key={creation.id}
                creation={creation}
                onOpen={() => onOpenCreation(creation)}
                onUndo={() => onUndoCreation(creation.id)}
              />
            ))}
          </div>
        )}
        {message.error && (
          <div className="message-error" role="alert">
            {message.error}
          </div>
        )}
        {message.state === 'stopped' && <div className="message-state">已停止生成</div>}
        {message.state === 'incomplete' && (
          <div className="message-state">回复未完成，可能已达到输出上限，可以继续提问。</div>
        )}
        {!!message.sources?.length && (
          <div className="message-sources" aria-label="工作台参考来源">
            <span>参考了 {message.sources.length} 项工作台内容</span>
            <div>
              {message.sources.map((source) => (
                <button
                  key={source.citation}
                  onClick={() => onSource(source)}
                  title="查看工作台来源"
                >
                  [{source.citation}] {source.label}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
          </div>
        )}
        {message.role === 'assistant' && message.state !== 'streaming' && message.text && (
          <div className="message-actions">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(message.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              aria-label="复制回复"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制'}
            </button>
            {message.usage && (
              <span>
                {message.usage.input} 输入 · {message.usage.output} 输出 Token
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

const starters = [
  {
    icon: <CalendarDays size={19} />,
    title: '安排今天',
    description: '看看课表和待办，留出学习与休息的时间',
    prompt: '请读取我今天的课表和未完成待办，结合已有安排，帮我制定今天的学习计划。',
  },
  {
    icon: <BookOpen size={19} />,
    title: '整理课程笔记',
    description: '把最近记录整理成要点和待解决的问题',
    prompt:
      '请查询我的最近笔记，读取与课程学习有关的内容，整理关键要点、未完成清单和需要进一步理解的问题，并注明来源。',
  },
  {
    icon: <FolderOpen size={19} />,
    title: '查找学习资料',
    description: '从已关联的文件和笔记开始，找到需要的内容',
    prompt:
      '请先查询我的关联资料与笔记目录，按主题整理已有学习资料，并注明来源；不清楚我的目标时，先问我想学习哪方面。',
  },
];

function ChatModelPicker({
  providers,
  providerId,
  model,
  busy,
  onChange,
}: {
  providers: Provider[];
  providerId: string;
  model: string;
  busy: boolean;
  onChange: (providerId: string, model: string) => void;
}) {
  const [fetchingId, setFetchingId] = useState('');
  const [error, setError] = useState({ providerId: '', text: '' });
  const provider = providers.find((item) => item.id === providerId);
  const options = providers.flatMap((item) => {
    const models = new Map((item.models ?? []).map((available) => [available.id, available]));
    if (!models.has(item.model)) models.set(item.model, { id: item.model, name: item.model });
    if (item.id === providerId && model && !models.has(model))
      models.set(model, { id: model, name: model });
    return Array.from(models.values()).map((available) => ({
      value: JSON.stringify([item.id, available.id]),
      label: available.name || available.id,
      group: item.name,
    }));
  });
  async function refreshModels() {
    if (!provider || fetchingId === provider.id) return;
    setFetchingId(provider.id);
    setError({ providerId: provider.id, text: '' });
    try {
      const available = await window.dola.listModels({
        id: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
      });
      if (!available.length)
        setError({ providerId: provider.id, text: '服务未返回模型列表，可在设置中手动填写。' });
    } catch (error) {
      setError({ providerId: provider.id, text: '获取失败：' + errorText(error) });
    } finally {
      setFetchingId((current) => (current === provider.id ? '' : current));
    }
  }
  return (
    <div className="model-select">
      <span className="status-dot" />
      {provider && <span className="model-service-name">{provider.name}</span>}
      <SelectMenu
        name="chat-model"
        label="切换模型"
        value={JSON.stringify([providerId, model])}
        options={options}
        onChange={(value) => {
          const [id, selectedModel] = JSON.parse(value);
          onChange(id, selectedModel);
        }}
        disabled={busy || !providers.length}
        searchable
        placement="top"
        placeholder={providers.length ? '请选择模型' : '尚未配置模型'}
        onOpen={() => {
          if (provider && !provider.models) void refreshModels();
        }}
        refresh={
          provider
            ? { busy: fetchingId === provider.id, onClick: () => void refreshModels() }
            : undefined
        }
        notice={error.providerId === providerId ? error.text : ''}
      />
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [focusNoteId, setFocusNoteId] = useState<string>();
  const [focusMailId, setFocusMailId] = useState<string>();
  const [focusTodoId, setFocusTodoId] = useState<string>();
  const [focusCourseId, setFocusCourseId] = useState<string>();
  const [focusCourseDate, setFocusCourseDate] = useState<string>();
  const [focusLibrary, setFocusLibrary] = useState<{ category: string; tab: 'notes' | 'files' }>();
  const [focusResource, setFocusResource] = useState<{ resourceId: string; path: string }>();
  const [focusChatMessageId, setFocusChatMessageId] = useState<string>();
  const [focusRequest, setFocusRequest] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accessDraft, setAccessDraft] = useState<{
    chatId: string | null;
    enabled: boolean;
  } | null>(null);
  const [state, setState] = useState<AppState>(empty);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newSelection, setNewSelection] = useState<{ providerId: string; model: string } | null>(
    null,
  );
  const [settings, setSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [notificationTodoId, setNotificationTodoId] = useState<string>();
  const [query, setQuery] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Page) {
    setSettings(false);
    setFocusNoteId(undefined);
    setFocusMailId(undefined);
    setFocusTodoId(undefined);
    setFocusCourseId(undefined);
    setFocusCourseDate(undefined);
    setFocusLibrary(undefined);
    setFocusResource(undefined);
    setFocusChatMessageId(undefined);
    setPage(next);
  }
  function openNote(id: string) {
    navigate('library');
    setFocusNoteId(id);
    setFocusRequest((value) => value + 1);
  }
  function openResource(id: string, path = '') {
    const resource = state.workspace.resources.find((item) => item.id === id);
    if (!resource) {
      fail(new Error('这项资料已移除关联，请到资料与笔记重新关联。'));
      return;
    }
    if (resource.kind === 'link') {
      void window.dola.workspace.openResource(id).catch(fail);
      return;
    }
    navigate('library');
    setFocusResource({ resourceId: id, path });
    setFocusRequest((value) => value + 1);
  }
  function openCourse(id: string, date?: string) {
    navigate('timetable');
    setFocusCourseId(id);
    setFocusCourseDate(date);
    setFocusRequest((value) => value + 1);
  }
  function openTodo(id: string) {
    if (!state.workspace.todos.some((todo) => todo.id === id))
      throw new Error('这条便利贴已被删除，无法打开。');
    navigate('todos');
    setFocusTodoId(id);
    setFocusRequest((value) => value + 1);
  }
  function openCreation(creation: WorkspaceCreation) {
    const id = creation.record.id;
    if (creation.kind === 'todo') openTodo(id);
    else if (creation.kind === 'note') {
      if (!state.workspace.notes.some((note) => note.id === id))
        throw new Error('这篇笔记已被删除，无法打开。');
      openNote(id);
    } else {
      if (!state.workspace.timetable.courses.some((course) => course.id === id))
        throw new Error('这门课程已被删除，无法打开。');
      openCourse(id);
    }
  }
  async function loadWorkspace() {
    setStartupError(null);
    if (!window.dola) {
      setStartupError('请通过桌面应用打开 NEU-Dela，浏览器预览无法访问本机工作台。');
      return;
    }
    try {
      const value = await window.dola.load();
      setState(value);
      setActiveId(value.chats[0]?.id ?? null);
      setLoaded(true);
    } catch (error) {
      setStartupError(errorText(error));
    }
  }
  async function openSearch() {
    if (!loaded) return;
    try {
      await flushNoteEdits();
      setState(await window.dola.load());
      setSearchOpen(true);
    } catch (error) {
      fail(error);
    }
  }
  function openSearchResult(result: WorkspaceSearchResult) {
    setSearchOpen(false);
    if (result.kind === 'note') openNote(result.id);
    else if (result.kind === 'course') openCourse(result.id);
    else if (result.kind === 'todo') {
      navigate('todos');
      setFocusTodoId(result.id);
      setFocusRequest((value) => value + 1);
    } else if (result.kind === 'resource') {
      openResource(result.id);
    } else {
      navigate('chat');
      setActiveId(result.id);
      setFocusChatMessageId(result.messageId);
    }
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault();
        if (searchOpen) setSearchOpen(false);
        else if (!document.querySelector('[role="dialog"]')) void openSearch();
      }
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [loaded, searchOpen]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      document.documentElement.dataset.theme =
        state.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.theme;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [state.theme]);

  useEffect(() => {
    const unsubscribe = window.dola?.onChange(setState);
    const unsubscribeTodo = window.dola?.onOpenTodo(setNotificationTodoId);
    void loadWorkspace();
    return () => {
      unsubscribe?.();
      unsubscribeTodo?.();
    };
  }, []);
  useEffect(() => {
    if (!loaded || !notificationTodoId) return;
    setNotificationTodoId(undefined);
    try {
      openTodo(notificationTodoId);
    } catch (error) {
      fail(error);
    }
  }, [loaded, notificationTodoId, state.workspace.todos]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 12000 : 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const chat = state.chats.find((c) => c.id === activeId);
  const workspaceAccess =
    accessDraft?.chatId === activeId ? accessDraft.enabled : (chat?.workspaceAccess ?? true);
  const providerId = chat
    ? (chat.providerId ?? '')
    : (state.providers.find((p) => p.id === newSelection?.providerId)?.id ??
      state.providers[0]?.id ??
      '');
  const provider = state.providers.find((p) => p.id === providerId);
  const model =
    chat?.model ||
    (newSelection?.providerId === providerId ? newSelection.model : provider?.model) ||
    '';
  const busy = Boolean(
    chat?.messages.some((m) => m.state === 'streaming') || (activeId && pending.includes(activeId)),
  );
  const demo =
    state.providers.length > 0 && state.providers.every((p) => p.model.startsWith('dola-mock-'));
  useEffect(() => {
    if (focusChatMessageId)
      document
        .querySelector(`[data-message-id="${CSS.escape(focusChatMessageId)}"]`)
        ?.scrollIntoView({ block: 'center' });
    else bottom.current?.scrollIntoView({ behavior: 'instant' });
  }, [chat?.messages.at(-1)?.text, activeId, settings, page, focusChatMessageId]);

  function fail(error: unknown) {
    setNotice({ text: errorText(error), error: true });
  }
  async function saveProvider(input: ProviderInput, test: boolean) {
    setSaving(true);
    try {
      const saved = await window.dola.saveProvider(input);
      setNewSelection({ providerId: saved.id, model: saved.model });
      if (test) {
        try {
          const result = await window.dola.probeProvider(saved.id);
          setNotice({ text: '连接成功 · ' + result.milliseconds + ' ms · ' + result.text });
        } catch (error) {
          setNotice({ text: '服务已保存，连接测试失败：' + errorText(error), error: true });
        }
      } else setNotice({ text: '模型服务已保存，可以开始对话。' });
      return saved;
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      setSaving(false);
    }
  }
  async function removeProvider(id: string) {
    if (!window.confirm('删除这个模型服务？已有对话会保留。')) return;
    try {
      await window.dola.removeProvider(id);
      setNotice({ text: '模型服务已移除' });
    } catch (error) {
      fail(error);
    }
  }
  async function send() {
    setFocusChatMessageId(undefined);
    if (!prompt.trim() || busy) return;
    if (!provider) {
      setSettings(true);
      return;
    }
    const text = prompt;
    let id = activeId;
    try {
      if (workspaceAccess) await flushNoteEdits();
      if (!chat) {
        id = await window.dola.createChat(provider.id, model);
        setAccessDraft({ chatId: id, enabled: workspaceAccess });
        setActiveId(id);
      }
      setPending((old) => [...old, id!]);
      setPrompt('');
      await window.dola.send(id!, text, workspaceAccess);
    } catch (error) {
      setPrompt(text);
      fail(error);
    } finally {
      setPending((old) => old.filter((value) => value !== id));
    }
  }
  async function removeChat(item: Chat) {
    try {
      await window.dola.removeChat(item.id);
      if (activeId === item.id) setActiveId(null);
    } catch (error) {
      fail(error);
    }
  }

  function openSource(source: WorkspaceSource) {
    if (source.kind === 'note' && source.id) {
      if (!state.workspace.notes.some((note) => note.id === source.id)) {
        fail(new Error('这篇笔记已被删除，原读取记录仍保留在对话中。'));
        return;
      }
      openNote(source.id);
    } else if (source.kind === 'resource' && source.id) openResource(source.id, source.path);
    else if (source.kind === 'mail') {
      navigate('mail');
      setFocusMailId(source.id);
    } else
      navigate(
        (
          {
            timetable: 'timetable',
            todos: 'todos',
            note: 'library',
            resource: 'library',
            campus: 'campus',
            overview: 'home',
          } as const
        )[source.kind],
      );
  }
  if (!loaded) return <StartupScreen error={startupError} onRetry={() => void loadWorkspace()} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-space" />
        <Brand />
        <button
          className="new-chat"
          onClick={() => {
            setSettings(false);
            setPage('chat');
            setFocusChatMessageId(undefined);
            setActiveId(null);
            setAccessDraft(null);
            setPrompt('');
            composer.current?.focus();
          }}
        >
          <Plus size={17} />
          开启新对话
        </button>
        <button
          className="workspace-search-trigger"
          aria-label="搜索工作台"
          aria-keyshortcuts="Control+K Meta+K"
          disabled={!loaded}
          onClick={() => void openSearch()}
        >
          <Search size={16} />
          搜索工作台
          <kbd>{/Mac/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>
        <nav className="workspace-nav" aria-label="工作台导航">
          <button
            className={'nav-item ' + (!settings && page === 'home' ? 'active' : '')}
            onClick={() => navigate('home')}
          >
            <LayoutDashboard size={19} />
            工作台首页
          </button>
          <button
            className={!settings && page === 'chat' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('chat')}
          >
            <Sparkles size={19} />
            AI 助手
          </button>
          {[
            [StickyNote, '今日便利贴', 'todos'],
            [CalendarDays, '我的课表', 'timetable'],
            [Mail, '邮箱', 'mail'],
            [FolderOpen, '资料与笔记', 'library'],
            [GraduationCap, '校园入口', 'campus'],
          ].map(([Icon, label, target]) => {
            const NavIcon = Icon as typeof StickyNote;
            return (
              <button
                key={String(label)}
                className={'nav-item ' + (!settings && page === target ? 'active' : '')}
                onClick={() => navigate(target as Page)}
              >
                <NavIcon size={19} />
                {String(label)}
              </button>
            );
          })}
        </nav>
        <div className="history-heading">
          <span>最近对话</span>
          <span>{state.chats.length}</span>
        </div>
        {state.chats.length > 4 && (
          <label className="history-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="查找对话"
            />
          </label>
        )}
        <div className="history">
          {state.chats
            .filter((c) => c.title.includes(query))
            .map((item) => (
              <div
                key={item.id}
                className={'history-row ' + (!settings && activeId === item.id ? 'current' : '')}
              >
                <button
                  onClick={() => {
                    setActiveId(item.id);
                    setFocusChatMessageId(undefined);
                    setSettings(false);
                    setPage('chat');
                    if (item.id !== activeId) setPrompt('');
                  }}
                >
                  <MessageSquare size={15} />
                  <span>{item.title}</span>
                </button>
                <button
                  className="history-delete"
                  aria-label={'删除对话 ' + item.title}
                  onClick={() => void removeChat(item)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          {!state.chats.length && (
            <p className="history-empty">
              从一个问题开始，
              <br />
              把思考留在这里。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="appearance">
            <span>外观</span>
            <div className="theme-switcher" role="group" aria-label="外观主题">
              {(
                [
                  ['light', Sun, '浅色', '浅色模式'],
                  ['dark', Moon, '深色', '深色模式'],
                  ['system', Monitor, '系统', '跟随系统'],
                ] as const
              ).map(([value, Icon, label, title]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={title}
                  title={title}
                  aria-pressed={state.theme === value}
                  disabled={!loaded}
                  onClick={() => void window.dola.setTheme(value).catch(fail)}
                >
                  <Icon size={13} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            className={settings ? 'nav-item active' : 'nav-item'}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
            设置
            <ChevronRight size={15} />
          </button>
          <div className="campus">
            <span>
              <GraduationCap size={18} />
            </span>
            <div>
              东北大学
              <small>NEU-Dela · 校园工作台</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        {settings ? (
          <Settings
            providers={state.providers}
            onClose={() => setSettings(false)}
            onSave={saveProvider}
            saving={saving}
            onRemove={removeProvider}
            onError={fail}
          />
        ) : page !== 'chat' ? (
          page === 'home' ? (
            <DashboardPage
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              onOpenNote={openNote}
              onOpenCourse={openCourse}
            />
          ) : page === 'todos' ? (
            <TodosPage
              key={focusRequest}
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              focusTodoId={focusTodoId}
            />
          ) : page === 'timetable' ? (
            <TimetablePage
              key={focusRequest}
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              focusCourseId={focusCourseId}
              focusCourseDate={focusCourseDate}
              onOpenNote={openNote}
              onOpenLibrary={(category, tab) => {
                navigate('library');
                setFocusLibrary({ category, tab });
                setFocusRequest((value) => value + 1);
              }}
            />
          ) : page === 'mail' ? (
            <MailPage
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              focusAccountId={focusMailId}
            />
          ) : page === 'library' ? (
            <LibraryPage
              key={focusRequest}
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              focusNoteId={focusNoteId}
              focusLibrary={focusLibrary}
              focusResource={focusResource}
              onAskFile={(file) => {
                const resource = state.workspace.resources.find(
                  (item) => item.id === file.resourceId,
                );
                if (!resource) return;
                if (provider) setNewSelection({ providerId: provider.id, model });
                setActiveId(null);
                setAccessDraft({ chatId: null, enabled: true });
                setPrompt((text) =>
                  [
                    text.trim(),
                    `请读取本地资料《${file.title}》：关联项“${resource.title}”，位置为“${resource.path}”${file.path ? `，相对路径为“${file.path}”` : ''}。请先读取原文件，再整理要点并注明来源。`,
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                );
                navigate('chat');
              }}
              onAskNote={(note) => {
                if (provider) setNewSelection({ providerId: provider.id, model });
                setActiveId(null);
                setAccessDraft({ chatId: null, enabled: true });
                setPrompt((text) =>
                  [
                    text.trim(),
                    `请先查询并读取我保存在“${note.category || '未分类'}”中的笔记《${note.title || '未命名笔记'}》，帮我整理要点和未完成的清单事项，并注明来源。`,
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                );
                navigate('chat');
              }}
            />
          ) : (
            <CampusPage workspace={state.workspace} onError={fail} navigate={navigate} />
          )
        ) : (
          <>
            <header className="chat-header">
              <div>
                <span className="breadcrumb">我的工作台</span>
                <ChevronRight size={14} />
                <strong>AI 助手</strong>
              </div>
              <button className="header-settings" onClick={() => setSettings(true)}>
                <Settings2 size={16} />
                模型设置
              </button>
            </header>
            {demo && (
              <div className="demo-strip">
                <span />
                本地模拟演示 · 回复来自测试服务，不代表真实模型能力
              </div>
            )}
            <div className="chat-scroll">
              {!chat?.messages.length ? (
                <section className="welcome">
                  <div className="welcome-identity">
                    <Brand small />
                    <span>你的学习搭子</span>
                  </div>
                  <h1>从一件具体的事开始</h1>
                  <p>课程怎么安排，笔记怎么整理，或是一个还没想明白的问题。</p>
                  {!state.providers.length && loaded && (
                    <button className="setup-callout" onClick={() => setSettings(true)}>
                      <span>
                        <KeyRound size={20} />
                      </span>
                      <div>
                        <strong>先连接你的 AI 模型</strong>
                        <small>连接后，就能结合工作台内容一起讨论。</small>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  )}
                  <div className="starter-grid">
                    {starters.map((item) => (
                      <button
                        key={item.title}
                        onClick={() => {
                          setPrompt(item.prompt);
                          setAccessDraft({ chatId: chat?.id ?? null, enabled: true });
                          composer.current?.focus();
                        }}
                      >
                        <span className="starter-icon">{item.icon}</span>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                  <p className="starter-hint">点选后会放入输入框，你可以改一改再发送。</p>
                </section>
              ) : (
                <div className="messages">
                  {chat.messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      onSource={openSource}
                      onOpenCreation={openCreation}
                      onUndoCreation={async (id) => {
                        await flushNoteEdits();
                        await window.dola.undoCreation(chat.id, message.id, id);
                      }}
                    />
                  ))}
                </div>
              )}
              <div ref={bottom} />
            </div>
            <div className="composer-area">
              <div className="composer">
                <textarea
                  ref={composer}
                  name="prompt"
                  aria-label="输入消息"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="写下你的问题，或说说你正在想的事"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <ChatModelPicker
                    providers={state.providers}
                    providerId={providerId}
                    model={model}
                    busy={busy}
                    onChange={(selectedProvider, selectedModel) => {
                      if (chat)
                        void window.dola
                          .selectProvider(chat.id, selectedProvider, selectedModel)
                          .catch(fail);
                      else setNewSelection({ providerId: selectedProvider, model: selectedModel });
                    }}
                  />
                  <button
                    className={'workspace-access ' + (workspaceAccess ? 'enabled' : '')}
                    aria-label="工作台访问"
                    aria-pressed={workspaceAccess}
                    disabled={busy}
                    title="按问题读取工作台，并按你的指令创建待办、课程或笔记；相关内容会发送给所选模型服务"
                    onClick={() => setAccessDraft({ chatId: activeId, enabled: !workspaceAccess })}
                  >
                    <Database size={13} />
                    工作台{workspaceAccess ? '已连接' : '未连接'}
                  </button>
                  <div className="send-area">
                    <span>{busy ? '正在生成回复' : 'Enter 发送 · Shift + Enter 换行'}</span>
                    <button
                      className={busy ? 'send-button stop' : 'send-button'}
                      aria-label={busy ? '停止生成' : '发送消息'}
                      disabled={!busy && !prompt.trim()}
                      onClick={() => {
                        if (busy && activeId) void window.dola.stop(activeId).catch(fail);
                        else void send();
                      }}
                    >
                      {busy ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="composer-footnote">
                <ShieldCheck size={12} />
                {workspaceAccess
                  ? '可读取工作台，并按你的指令创建待办、课程和笔记。相关内容会交给所选模型服务；创建后可查看、修改或撤销。'
                  : '工作台访问已关闭，仅发送当前对话内容给所选模型服务。'}
              </p>
            </div>
          </>
        )}
      </main>
      {searchOpen && (
        <WorkspaceSearch
          state={state}
          onClose={() => setSearchOpen(false)}
          onOpen={openSearchResult}
        />
      )}
      {notice && (
        <div
          className={'toast ' + (notice.error ? 'toast-error' : '')}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{notice.text}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
