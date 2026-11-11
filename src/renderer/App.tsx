import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Mail,
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
  Sun,
  Moon,
  Monitor,
  LayoutDashboard,
  UserRound,
  Database,
  Paperclip,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AppState,
  Chat,
  ChatMessage,
  ModelOption,
  Provider,
  WorkspaceSource,
  WorkspaceCreation,
  ChatAttachment,
  TimetableProposal,
} from '../shared/types';
import { SelectMenu } from './components/SelectMenu';
import { emptyWorkspace, type Page, type TimetableImport } from '../shared/workspace';
import { TodosPage, TimetablePage, CampusPage } from './WorkspacePages';
import { LibraryPage } from './LibraryPage';
import { flushNoteEdits } from './components/useNoteEditor';
import { DashboardPage } from './DashboardPage';
import { MailPage } from './MailPage';
import { WorkspaceSearch } from './components/WorkspaceSearch';
import { WorkspaceCreationCard } from './components/WorkspaceCreationCard';
import { StartupScreen } from './components/StartupScreen';
import { StudentOnboarding } from './components/StudentOnboarding';
import { ChatAttachmentList } from './components/ChatAttachmentList';
import { ChatHistory } from './components/ChatHistory';
import { assistancePrompt, type AiAssistanceRequest } from '../shared/ai-assistance';
import { SettingsPage } from './SettingsPage';
import type { WorkspaceSearchResult } from '../shared/search';
import type { UpdateState } from '../shared/updates';
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
        <img src={appIcon} alt={small ? 'NEU Dot' : ''} draggable={false} />
      </span>
      {!small && (
        <span>
          <strong>NEU Dot</strong>
          <small>东北大学 · 学生工作台</small>
        </span>
      )}
    </div>
  );
}

function Message({
  message,
  onSource,
  onOpenCreation,
  onUndoCreation,
  onOpenTimetableDraft,
}: {
  message: ChatMessage;
  onSource: (source: WorkspaceSource) => void;
  onOpenCreation: (creation: WorkspaceCreation) => void;
  onUndoCreation: (id: string) => Promise<void>;
  onOpenTimetableDraft: (draft: TimetableProposal) => void;
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
          {message.role === 'user' ? '你' : 'NEU Dot'}
          {message.role === 'assistant' && <span>{message.model}</span>}
        </div>
        <ChatAttachmentList
          files={message.attachments ?? []}
          onOpen={(file) =>
            onSource({ kind: 'attachment', id: file.id, label: file.name, citation: 0 })
          }
        />
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
        {message.timetableDrafts?.map((draft) => (
          <section key={draft.id} className="timetable-proposal" data-timetable-proposal={draft.id}>
            <strong>课表导入草稿 · {draft.timetable.courses.length} 条课程</strong>
            {!!draft.timetable.unresolvedCourses?.length && (
              <p>
                另有 {draft.timetable.unresolvedCourses.length} 条课程待确认，预览中可核对原因。
              </p>
            )}
            <p>{draft.timetable.term || '学期待补充'}。请核对课程、周次与学期后保存。</p>
            <button className="secondary-button" onClick={() => onOpenTimetableDraft(draft)}>
              预览并保存课表
            </button>
          </section>
        ))}
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
          <div className="message-sources" aria-label="参考来源">
            <span>参考了 {message.sources.length} 项资料</span>
            <div>
              {message.sources.map((source) => (
                <button key={source.citation} onClick={() => onSource(source)} title="查看来源">
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
    description: '从已添加的文件和笔记开始，找到需要的内容',
    prompt:
      '请先查询我的本地资料与笔记目录，按主题整理已有学习资料，并注明来源；不清楚我的目标时，先问我想学习哪方面。',
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
  const lastModels = useRef(new Map<string, string>());
  const provider = providers.find((item) => item.id === providerId);
  useEffect(() => {
    if (providerId && model) lastModels.current.set(providerId, model);
  }, [providerId, model]);
  const models = new Map((provider?.models ?? []).map((available) => [available.id, available]));
  if (provider && !models.has(provider.model))
    models.set(provider.model, { id: provider.model, name: provider.model });
  if (model && !models.has(model)) models.set(model, { id: model, name: model });
  const options = [...models.values()].map((available) => ({
    value: available.id,
    label: available.name || available.id,
  }));
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
      <SelectMenu
        name="chat-provider"
        label="切换供应商"
        value={providerId}
        options={providers.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(id) => {
          const selected = providers.find((item) => item.id === id);
          if (selected) onChange(id, lastModels.current.get(id) || selected.model);
        }}
        disabled={busy || !providers.length}
        placement="top"
        placeholder="选择供应商"
      />
      <SelectMenu
        name="chat-model"
        label="切换模型"
        value={model}
        options={options}
        onChange={(value) => onChange(providerId, value)}
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
  const [state, setState] = useState<AppState>(empty);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newSelection, setNewSelection] = useState<{ providerId: string; model: string } | null>(
    null,
  );
  const [settings, setSettings] = useState<{
    request: number;
    fromChat: boolean;
    initialPage?: 'models' | 'about';
    activeProviderId?: string;
  } | null>(null);
  const settingsRequest = useRef(0);
  const chatScroll = useRef<HTMLDivElement>(null);
  const returnScroll = useRef<{ chatId: string | null; top: number } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [choosingAttachments, setChoosingAttachments] = useState(false);
  const [focusTimetableDraft, setFocusTimetableDraft] = useState<TimetableImport>();
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
    assist?: AiAssistanceRequest;
  } | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [notificationTodoId, setNotificationTodoId] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function navigate(next: Page) {
    setSettings(null);
    setFocusNoteId(undefined);
    setFocusMailId(undefined);
    setFocusTodoId(undefined);
    setFocusCourseId(undefined);
    setFocusCourseDate(undefined);
    setFocusLibrary(undefined);
    setFocusResource(undefined);
    setFocusChatMessageId(undefined);
    setFocusTimetableDraft(undefined);
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
      fail(new Error('这项资料已移除，请到资料与笔记重新添加。'));
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
      setStartupError('请通过桌面应用打开 NEU Dot，浏览器预览无法访问本机工作台。');
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
      if (!state.workspace.degreeConfirmed) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault();
        if (searchOpen) setSearchOpen(false);
        else if (!document.querySelector('[role="dialog"]')) void openSearch();
      }
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [loaded, searchOpen, state.workspace.degreeConfirmed]);
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
    const unsubscribeUpdates = window.dola?.updates.onChange(setUpdate);
    void window.dola?.updates.getState().then(setUpdate).catch(fail);
    void loadWorkspace();
    return () => {
      unsubscribe?.();
      unsubscribeTodo?.();
      unsubscribeUpdates?.();
    };
  }, []);
  useEffect(
    () => window.dola?.updates.onOpen(() => openSettings(false, 'about')),
    [page, activeId],
  );
  useEffect(() => {
    if (loaded) void window.dola.updates.confirmLaunch().catch(fail);
  }, [loaded]);
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
    if (settings) return;
    if (page !== 'chat') {
      returnScroll.current = null;
      return;
    }
    if (returnScroll.current !== null) {
      const previous = returnScroll.current;
      returnScroll.current = null;
      if (previous.chatId === activeId && chatScroll.current) {
        chatScroll.current.scrollTop = previous.top;
        return;
      }
    }
    if (focusChatMessageId)
      document
        .querySelector(`[data-message-id="${CSS.escape(focusChatMessageId)}"]`)
        ?.scrollIntoView({ block: 'center' });
    else bottom.current?.scrollIntoView({ behavior: 'instant' });
  }, [chat?.messages.at(-1)?.text, activeId, settings, page, focusChatMessageId]);

  function fail(error: unknown) {
    const target =
      page === 'timetable'
        ? 'timetable'
        : page === 'library'
          ? 'notes'
          : page === 'todos'
            ? 'todos'
            : null;
    setNotice({
      text: errorText(error),
      error: true,
      ...(target
        ? {
            assist: {
              target,
              operation: 'recover',
              error: errorText(error),
              source: '工作台操作',
            } as AiAssistanceRequest,
          }
        : {}),
    });
  }
  function openSettings(fromChat = false, initialPage?: 'about') {
    returnScroll.current =
      page === 'chat' && chatScroll.current
        ? { chatId: activeId, top: chatScroll.current.scrollTop }
        : null;
    setSettings({
      request: ++settingsRequest.current,
      fromChat,
      initialPage: fromChat ? 'models' : initialPage,
      activeProviderId: fromChat ? providerId : undefined,
    });
  }
  async function send() {
    setFocusChatMessageId(undefined);
    if ((!prompt.trim() && !attachments.length) || busy || choosingAttachments) return;
    if (!provider) {
      openSettings(true);
      return;
    }
    const text = prompt;
    const files = attachments;
    let id = activeId;
    try {
      await flushNoteEdits();
      if (!chat) {
        id = await window.dola.createChat(provider.id, model);
        setActiveId(id);
      }
      setPending((old) => [...old, id!]);
      setPrompt('');
      setAttachments([]);
      await window.dola.send(
        id!,
        text,
        files.map((file) => file.id),
      );
    } catch (error) {
      setPrompt((current) => current || text);
      setAttachments((current) => [
        ...files,
        ...current.filter((file) => !files.some((old) => old.id === file.id)),
      ]);
      fail(error);
    } finally {
      setPending((old) => old.filter((value) => value !== id));
    }
  }
  async function chooseAttachments() {
    if (choosingAttachments || busy) return;
    setChoosingAttachments(true);
    try {
      const files = await window.dola.chooseChatAttachments();
      if (files.length + attachments.length > 6) {
        await window.dola.discardChatAttachments(files.map((file) => file.id));
        throw new Error('每条消息最多引用 6 个文件，请先移除部分文件。');
      }
      setAttachments((current) => [...current, ...files]);
    } catch (error) {
      fail(error);
    } finally {
      setChoosingAttachments(false);
    }
  }
  function askAiToAssist(request: AiAssistanceRequest) {
    const file = request.attachment;
    void window.dola
      .discardChatAttachments(attachments.filter((old) => old.id !== file?.id).map((old) => old.id))
      .catch(fail);
    setAttachments(file ? [file] : []);
    setPrompt(assistancePrompt(request));
    navigate('chat');
    setActiveId(null);
    setNotice(null);
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
    if (source.kind === 'attachment') {
      if (source.id) void window.dola.openChatAttachment(source.id).catch(fail);
      return;
    }
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
  if (!state.workspace.degreeConfirmed)
    return (
      <StudentOnboarding
        onComplete={async (degree) => {
          await window.dola.workspace.setDegree(degree);
          setState(await window.dola.load());
        }}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-space" />
        <Brand />
        <button
          className="new-chat"
          onClick={() => {
            setSettings(null);
            setPage('chat');
            setFocusChatMessageId(undefined);
            setActiveId(null);

            setPrompt('');
            void window.dola.discardChatAttachments(attachments.map((file) => file.id)).catch(fail);
            setAttachments([]);
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
        <ChatHistory
          chats={state.chats}
          providers={state.providers}
          activeId={!settings && page === 'chat' ? activeId : null}
          onOpen={(item) => {
            setActiveId(item.id);
            setFocusChatMessageId(undefined);
            setSettings(null);
            setPage('chat');
            if (item.id !== activeId) setPrompt('');
          }}
          onRemove={(item) => void removeChat(item)}
        />
        <div className="sidebar-bottom">
          {update?.version && update.status !== 'current' && update.status !== 'checking' && (
            <button
              className="sidebar-update"
              data-update-notice
              onClick={() => openSettings(false, 'about')}
            >
              <RefreshCw size={16} />
              <span>
                <strong>
                  {update.status === 'ready'
                    ? '重启安装新版本'
                    : update.status === 'downloading'
                      ? '正在下载更新'
                      : '发现新版本'}
                </strong>
                <small>
                  {update.version}
                  {update.progress ? ` · ${Math.floor(update.progress.percent)}%` : ''}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          )}
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
            onClick={() => openSettings()}
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
              <small>NEU Dot · 校园工作台</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        {settings ? (
          <SettingsPage
            key={settings.request}
            state={state}
            update={update}
            initialPage={settings.initialPage}
            activeProviderId={settings.activeProviderId}
            fromChat={settings.fromChat}
            onClose={() => setSettings(null)}
            onNavigate={(next) => {
              navigate(next);
              if (next === 'library') {
                setFocusLibrary({ category: '', tab: 'files' });
                setFocusRequest((value) => value + 1);
              }
            }}
            onNotice={(text) => setNotice({ text })}
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
              onAskAi={askAiToAssist}
            />
          ) : page === 'timetable' ? (
            <TimetablePage
              key={focusRequest}
              workspace={state.workspace}
              onError={fail}
              navigate={navigate}
              focusCourseId={focusCourseId}
              focusCourseDate={focusCourseDate}
              importDraft={focusTimetableDraft}
              onAskAi={askAiToAssist}
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
              onAskAi={askAiToAssist}
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

                setPrompt((text) =>
                  [
                    text.trim(),
                    `请读取本地资料《${file.title}》：资料“${resource.title}”，位置为“${resource.path}”${file.path ? `，相对路径为“${file.path}”` : ''}。请先读取原文件，再整理要点并注明来源。`,
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                );
                navigate('chat');
              }}
              onAskNote={(note) => {
                if (provider) setNewSelection({ providerId: provider.id, model });
                setActiveId(null);

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
              <button className="header-settings" onClick={() => openSettings(true)}>
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
            <div className="chat-scroll" ref={chatScroll}>
              {!chat?.messages.length ? (
                <section className="welcome">
                  <div className="welcome-identity">
                    <Brand small />
                    <span>你的学习搭子</span>
                  </div>
                  <h1>从一件具体的事开始</h1>
                  <p>课程怎么安排，笔记怎么整理，或是一个还没想明白的问题。</p>
                  {!state.providers.length && loaded && (
                    <button className="setup-callout" onClick={() => openSettings(true)}>
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
                      onOpenTimetableDraft={(draft) => {
                        navigate('timetable');
                        setFocusTimetableDraft(draft.timetable);
                        setFocusRequest((value) => value + 1);
                      }}
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
                <ChatAttachmentList
                  files={attachments}
                  disabled={busy || choosingAttachments}
                  onOpen={(file) => void window.dola.openChatAttachment(file.id).catch(fail)}
                  onRemove={(file) =>
                    void window.dola
                      .discardChatAttachments([file.id])
                      .then(() =>
                        setAttachments((current) => current.filter((item) => item.id !== file.id)),
                      )
                      .catch(fail)
                  }
                />
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
                  <div className="composer-model-tools">
                    <button
                      type="button"
                      className="attach-files-button"
                      aria-label="添加引用文件"
                      disabled={busy || choosingAttachments || attachments.length >= 6}
                      onClick={() => void chooseAttachments()}
                    >
                      <Paperclip size={16} />
                      {choosingAttachments ? '正在添加' : '引用文件'}
                    </button>
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
                        else
                          setNewSelection({ providerId: selectedProvider, model: selectedModel });
                      }}
                    />
                  </div>
                  <div className="send-area">
                    <span>{busy ? '正在生成回复' : 'Enter 发送 · Shift + Enter 换行'}</span>
                    <button
                      className={busy ? 'send-button stop' : 'send-button'}
                      aria-label={busy ? '停止生成' : '发送消息'}
                      disabled={
                        choosingAttachments || (!busy && !prompt.trim() && !attachments.length)
                      }
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
                发送后，引用文件与相关工作台内容会按需交给当前模型服务。支持 PDF、图片与文字文件。
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
          {notice.assist && (
            <button className="toast-ai-assist" onClick={() => askAiToAssist(notice.assist!)}>
              <Sparkles size={14} />
              交给 AI 继续
            </button>
          )}
          <button aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
