import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  GraduationCap,
  HardDrive,
  Info,
  Mail,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Plus,
  Sparkles,
  Sun,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AppState, Theme, ProviderInput } from '../shared/types';
import { protocolLabels } from '../shared/types';
import { periodTimes, type Page } from '../shared/workspace';
import { Modal } from './WorkspacePages';
import { ProviderSettingsForm } from './components/ProviderSettingsForm';
import { MailSettingsForm } from './components/MailSettingsForm';
import { TermSettingsForm } from './components/TermSettingsForm';
import { StudentTypeChoices } from './components/StudentTypeChoices';
import { UpdatePanel } from './components/UpdatePanel';
import type { UpdateState } from '../shared/updates';
import { studentProfiles } from '../shared/student-profile';
import appIcon from '../../assets/icon.png';
import './settings.css';

type SettingsSection =
  | 'overview'
  | 'appearance'
  | 'student-type'
  | 'models'
  | 'mail'
  | 'resources'
  | 'semester'
  | 'reminders'
  | 'data'
  | 'help'
  | 'about';
const labels: Record<SettingsSection, string> = {
  overview: '设置',
  appearance: '外观',
  'student-type': '学生类型',
  models: '模型服务',
  mail: '邮箱账号',
  resources: '本地资料',
  semester: '学期与节次',
  reminders: '提醒与后台',
  data: '本地数据',
  help: '帮助与诊断',
  about: '关于 NEU Dot',
};
const themeLabels: Record<Theme, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
const providerPresets: ProviderInput[] = [
  {
    name: 'DeepSeek',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
  {
    name: 'MiniMax',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.cn/anthropic',
    model: 'MiniMax-M3.1-Flash',
  },
  {
    name: 'GLM',
    protocol: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
  },
];
const workspace = () => window.dola.workspace;

export function SettingsPage({
  state,
  update,
  initialPage,
  activeProviderId,
  fromChat = false,
  onClose,
  onNavigate,
  onError,
  onNotice,
}: {
  state: AppState;
  update: UpdateState | null;
  initialPage?: 'models' | 'about';
  activeProviderId?: string;
  fromChat?: boolean;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onError: (error: unknown) => void;
  onNotice: (notice: string) => void;
}) {
  const [page, setPage] = useState<SettingsSection>(initialPage || 'overview');
  const [editingProvider, setEditingProvider] = useState<{
    id?: string;
    kind: 'openai' | 'anthropic';
    preset?: ProviderInput;
  } | null>(null);
  const [editingMail, setEditingMail] = useState<string | null>(null);
  const [editingTerm, setEditingTerm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [info, setInfo] = useState<{ version: string; dataDirectory: string } | null>(null);
  const [infoError, setInfoError] = useState('');
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const view = editingProvider
    ? 'model-editor'
    : editingMail !== null
      ? 'mail-editor'
      : editingTerm
        ? 'semester-editor'
        : page;
  const w = state.workspace;
  const periods = w.timetable.periods || periodTimes;
  const resourceSummary = `${w.resources.filter((item) => item.kind === 'folder').length} 个文件夹 · ${w.resources.filter((item) => item.kind === 'file').length} 个文件 · ${w.resources.filter((item) => item.kind === 'link').length} 个链接`;
  async function readInfo() {
    setInfoError('');
    try {
      setInfo(await workspace().getAppInfo());
    } catch (error) {
      setInfoError(error instanceof Error ? error.message : String(error));
      onError(error);
    }
  }
  useEffect(() => {
    void readInfo();
  }, []);
  function open(next: SettingsSection) {
    setPage(next);
    setEditingProvider(null);
    setEditingMail(null);
    setEditingTerm(false);
    setStatus('');
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const row = (target: SettingsSection, Icon: LucideIcon, title: string, value: string) => (
    <button
      className="settings-overview-row"
      data-settings-open={target}
      data-settings-target={target}
      type="button"
      onClick={() => open(target)}
    >
      <Icon size={19} />
      <span>
        <strong>{title}</strong>
        <small>{value}</small>
      </span>
      <ChevronRight size={15} />
    </button>
  );
  const editorProps = { busy, setBusy, onError, onNotice };
  const back = () => {
    if (editingProvider) setEditingProvider(null);
    else if (editingMail !== null) setEditingMail(null);
    else if (editingTerm) setEditingTerm(false);
    else open('overview');
    setStatus('');
  };
  return (
    <section className="settings-workspace" data-settings-page={view}>
      <header className="settings-page-heading">
        <div>
          <div className="settings-breadcrumb">NEU Dot{page !== 'overview' && <> / 设置</>}</div>
          <h1>{labels[page]}</h1>
          <p>
            {page === 'overview'
              ? '管理外观、连接与本地数据。'
              : page === 'models'
                ? '查看已配置服务，选择后再编辑。'
                : page === 'mail'
                  ? '管理邮箱连接配置。'
                  : '让工作台更贴合你的日常使用。'}
          </p>
        </div>
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          <X size={15} />
          {fromChat ? '返回聊天' : '返回'}
        </button>
      </header>
      {page !== 'overview' && (
        <button className="text-button settings-back" disabled={busy} onClick={back}>
          <ArrowLeft size={14} />
          {editingProvider
            ? '返回模型服务'
            : editingMail !== null
              ? '返回邮箱账号'
              : editingTerm
                ? '返回学期与节次'
                : '返回设置'}
        </button>
      )}
      {page === 'overview' && (
        <div className="settings-overview-grid">
          <section className="settings-overview-group">
            <h2>通用</h2>
            <div className="settings-overview-list">
              {row('appearance', Palette, '外观', themeLabels[state.theme])}
              {row('student-type', GraduationCap, '学生类型', studentProfiles[w.degree].label)}
            </div>
          </section>
          <section className="settings-overview-group">
            <h2>模型与连接</h2>
            <div className="settings-overview-list">
              {row(
                'models',
                Sparkles,
                '模型服务',
                state.providers.length ? `${state.providers.length} 个已配置` : '尚未添加模型服务',
              )}
              {row(
                'mail',
                Mail,
                '邮箱账号',
                w.mailAccounts.length ? `${w.mailAccounts.length} 个已配置` : '尚未添加邮箱',
              )}
              {row('resources', FolderOpen, '本地资料', resourceSummary)}
            </div>
          </section>
          <section className="settings-overview-group">
            <h2>学习与提醒</h2>
            <div className="settings-overview-list">
              {row('semester', CalendarDays, '学期与节次', w.timetable.term || '尚未设置学期')}
              {row('reminders', Bell, '提醒与后台', '按每条待办的时间提醒')}
            </div>
          </section>
          <section className="settings-overview-group">
            <h2>数据与帮助</h2>
            <div className="settings-overview-list">
              {row('data', HardDrive, '本地数据', '保存在这台电脑')}
              {row('help', CircleHelp, '帮助与诊断', '使用指南、反馈与日志')}
              {row(
                'about',
                Info,
                '关于 NEU Dot',
                info ? `版本 ${info.version}` : infoError ? '版本信息读取失败' : '正在读取版本',
              )}
            </div>
          </section>
        </div>
      )}
      {page === 'student-type' && (
        <div className="settings-detail">
          <section className="settings-card">
            <h2>整个工作台使用同一份学生类型</h2>
            <StudentTypeChoices
              value={w.degree}
              disabled={busy}
              onChange={(degree) => void run(() => workspace().setDegree(degree))}
            />
            <p className="settings-hint">
              选择后立即用于课表网页导入、校园服务与 AI
              助手的身份上下文。已有课程、笔记、待办与资料保留。
            </p>
          </section>
        </div>
      )}
      {page === 'appearance' && (
        <div className="settings-detail">
          <section className="settings-card">
            <h2>外观主题</h2>
            <div className="settings-theme-options">
              {(
                [
                  { value: 'light', Icon: Sun },
                  { value: 'dark', Icon: Moon },
                  { value: 'system', Icon: Monitor },
                ] as const
              ).map(({ value, Icon }) => (
                <button
                  key={value}
                  data-theme-choice={value}
                  className={'settings-theme-option' + (state.theme === value ? ' selected' : '')}
                  aria-pressed={state.theme === value}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.dola.setTheme(value);
                    })
                  }
                >
                  <span className={`settings-theme-preview ${value}`}>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>
                    <Icon size={16} />
                    {themeLabels[value]}
                    {state.theme === value && <Check size={15} />}
                  </span>
                </button>
              ))}
            </div>
            <p className="settings-hint">
              选择后立即生效。跟随系统时，外观会随系统切换；侧栏快捷切换与这里同步。
            </p>
          </section>
        </div>
      )}
      {page === 'models' &&
        (editingProvider ? (
          <ProviderSettingsForm
            key={editingProvider.id || editingProvider.preset?.name || editingProvider.kind}
            provider={state.providers.find((item) => item.id === editingProvider.id)}
            kind={editingProvider.kind}
            preset={editingProvider.preset}
            {...editorProps}
            onSaved={() => setEditingProvider(null)}
            onCancel={() => setEditingProvider(null)}
          />
        ) : (
          <div className="settings-detail settings-models">
            <div className="settings-entry-actions">
              {providerPresets.map((preset) => (
                <button
                  key={preset.name}
                  className="secondary-button"
                  data-provider-add={preset.name}
                  disabled={busy}
                  onClick={() => {
                    setStatus('');
                    setEditingProvider({
                      kind: preset.protocol === 'anthropic' ? 'anthropic' : 'openai',
                      preset,
                    });
                  }}
                >
                  <Plus size={15} />
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="settings-entry-actions">
              <button
                className="primary-button"
                data-provider-add="openai"
                onClick={() => {
                  setStatus('');
                  setEditingProvider({ kind: 'openai' });
                }}
                disabled={busy}
              >
                <Plus size={15} />
                自定义 OpenAI
              </button>
              <button
                className="secondary-button"
                data-provider-add="anthropic"
                onClick={() => {
                  setStatus('');
                  setEditingProvider({ kind: 'anthropic' });
                }}
                disabled={busy}
              >
                <Plus size={15} />
                自定义 Anthropic
              </button>
            </div>
            {!state.providers.length && (
              <div className="settings-empty">
                <Sparkles size={28} />
                <h2>连接你选择的模型</h2>
                <p>填写服务地址、模型 ID 和 API Key 后，即可在聊天中使用。</p>
              </div>
            )}
            {state.providers.map((provider) => (
              <article
                className="settings-service-card"
                key={provider.id}
                data-provider-id={provider.id}
                data-current-provider={provider.id === activeProviderId ? 'true' : 'false'}
              >
                <div className="settings-service-copy">
                  <h2>
                    {provider.name}
                    {provider.id === activeProviderId && (
                      <span className="settings-badge">当前对话</span>
                    )}
                  </h2>
                  <p>{protocolLabels[provider.protocol]}</p>
                  <p className="settings-muted">
                    {provider.model || '未设置模型'} · {provider.hasKey ? '已配置' : '待填写密钥'}
                  </p>
                </div>
                <div className="settings-service-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setStatus('');
                      setEditingProvider({
                        id: provider.id,
                        kind: provider.protocol === 'anthropic' ? 'anthropic' : 'openai',
                      });
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await window.dola.probeProviderInput({ ...provider });
                        setStatus(
                          `${provider.name}：连接测试通过，用时 ${result.milliseconds} ms。`,
                        );
                      })
                    }
                  >
                    <Zap size={13} />
                    测试连接
                  </button>
                </div>
              </article>
            ))}
            <p className="settings-hint">
              测试会向所选服务发送一条简短请求，可能产生费用。每个聊天可以选择自己的服务和模型。
            </p>
          </div>
        ))}
      {page === 'mail' &&
        (editingMail !== null ? (
          <MailSettingsForm
            key={editingMail}
            account={w.mailAccounts.find((item) => item.id === editingMail)}
            {...editorProps}
            onSaved={() => setEditingMail(null)}
            onCancel={() => setEditingMail(null)}
          />
        ) : (
          <div className="settings-detail">
            <div className="settings-entry-actions">
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  setStatus('');
                  setEditingMail('new');
                }}
              >
                <Plus size={15} />
                添加邮箱账号
              </button>
              {w.mailAccounts.length > 0 && (
                <button className="text-button" onClick={() => onNavigate('mail')}>
                  打开邮箱 <ChevronRight size={14} />
                </button>
              )}
            </div>
            {!w.mailAccounts.length && (
              <div className="settings-empty">
                <Mail size={28} />
                <h2>把常用邮箱接入工作台</h2>
                <p>支持学校邮箱、QQ、163 和自定义 IMAP / SMTP 账号。</p>
              </div>
            )}
            {w.mailAccounts.map((account) => (
              <article
                key={account.id}
                className="settings-service-card"
                data-mail-account-id={account.id}
              >
                <div className="settings-service-copy">
                  <h2>{account.name}</h2>
                  <p>{account.email}</p>
                  <p className="settings-muted">
                    {account.hasPassword ? '已保存连接配置' : '待填写客户端授权码'}
                  </p>
                </div>
                <div className="settings-service-actions">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setStatus('');
                      setEditingMail(account.id);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setStatus(
                          account.name +
                            '：' +
                            (await workspace().testMailConnection({ ...account })),
                        );
                      })
                    }
                  >
                    <Zap size={13} />
                    测试连接
                  </button>
                </div>
              </article>
            ))}
            <p className="settings-hint">
              这里管理账号配置。打开设置不会收取邮件，测试连接不会发送邮件。
            </p>
          </div>
        ))}
      {page === 'resources' && (
        <div className="settings-detail">
          <section className="settings-card">
            <h2>常用资料，保持在手边</h2>
            <p>{resourceSummary}</p>
            <p className="settings-hint">
              在“本地资料”中添加文件或文件夹，浏览目录、阅读 Markdown 和文本。文件仍保留在原位置。
            </p>
            <div className="settings-entry-actions">
              <button className="primary-button" onClick={() => onNavigate('library')}>
                <FolderOpen size={15} />
                打开本地资料
              </button>
            </div>
          </section>
          <p className="settings-hint">
            AI 按问题读取已添加的资料，相关内容会发送给你选择的模型服务。
          </p>
        </div>
      )}
      {page === 'semester' &&
        (editingTerm ? (
          <TermSettingsForm
            timetable={w.timetable}
            {...editorProps}
            onSaved={() => setEditingTerm(false)}
            onCancel={() => setEditingTerm(false)}
          />
        ) : (
          <div className="settings-detail">
            <section className="settings-card">
              <div className="settings-card-heading">
                <h2>{w.timetable.term || '尚未设置学期'}</h2>
                <button className="secondary-button" onClick={() => setEditingTerm(true)}>
                  编辑学期设置
                </button>
              </div>
              <dl className="settings-values">
                <div>
                  <dt>第一周周一</dt>
                  <dd>{w.timetable.firstMonday || '尚未设置'}</dd>
                </div>
                <div>
                  <dt>已有课程安排</dt>
                  <dd>{w.timetable.courses.length} 条</dd>
                </div>
              </dl>
              <h3 className="settings-form-section-title">节次时间</h3>
              <div className="settings-period-summary">
                {periods.map(([start, end], index) => (
                  <div key={index}>
                    <span>第 {index + 1} 节</span>
                    <strong>
                      {start} – {end}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="settings-hint">
                学期与节次和课表共用一份设置，编辑时保留已有课程与导入来源。
              </p>
            </section>
          </div>
        ))}
      {page === 'reminders' && (
        <div className="settings-detail">
          <section className="settings-card">
            <h2>按每条待办的时间提醒</h2>
            <p>提醒时间和每天、工作日、每周等重复规则，在具体待办里设置。</p>
            <div className="settings-entry-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await workspace().testNotification();
                    setStatus('已请求系统发送测试提醒，请查看通知中心。');
                  })
                }
              >
                <Bell size={15} />
                发送测试提醒
              </button>
              <button className="text-button" onClick={() => onNavigate('todos')}>
                管理待办 <ChevronRight size={14} />
              </button>
            </div>
          </section>
          <section className="settings-card">
            <h2>关闭窗口后</h2>
            <p>
              应用留在菜单栏或系统托盘继续运行。退出应用或关闭电脑后，提醒停止；下次启动时会检查尚未提醒的到期事项。
            </p>
            <h3 className="settings-form-section-title">没有看到通知时</h3>
            <p className="settings-hint">
              请在系统设置中允许 NEU Dot
              发送通知，并检查勿扰模式。触发测试不代表系统已经显示通知横幅。
            </p>
          </section>
        </div>
      )}
      {page === 'data' && (
        <div className="settings-detail">
          <section className="settings-card">
            <h2>数据保存在这台电脑</h2>
            <p>
              课表、待办、应用笔记、聊天与设置保存在本机。服务密钥和邮箱授权码通过系统加密保存。
            </p>
            <div className="settings-data-location">
              <span>当前数据目录</span>
              {info ? (
                <code data-app-data-directory>{info.dataDirectory}</code>
              ) : (
                <p>{infoError || '正在读取目录'}</p>
              )}
            </div>
            <div className="settings-entry-actions">
              <button
                className="secondary-button"
                onClick={() => void workspace().showDataFolder().catch(onError)}
              >
                <FolderOpen size={15} />
                打开本地数据目录
              </button>
              {infoError && (
                <button className="text-button" onClick={() => void readInfo()}>
                  重新读取
                </button>
              )}
            </div>
          </section>
          <section className="settings-card">
            <h2>AI 使用工作台时</h2>
            <p>
              根据问题读取的内容会发送给你选择的模型服务。添加本地资料会保存文件位置，原文件仍留在原处。
            </p>
          </section>
        </div>
      )}
      {page === 'help' && (
        <div className="settings-detail">
          <div className="settings-overview-list">
            <button
              className="settings-overview-row"
              onClick={() =>
                void workspace()
                  .openWebsite('https://github.com/yzbcs/NEU-Dot/blob/main/docs/usage.md')
                  .catch(onError)
              }
            >
              <BookOpen size={19} />
              <span>
                <strong>使用指南</strong>
                <small>连接服务、导入课表、阅读资料与使用提醒</small>
              </span>
              <ExternalLink size={15} />
            </button>
            <button
              className="settings-overview-row"
              onClick={() =>
                void workspace()
                  .openWebsite('https://github.com/yzbcs/NEU-Dot/issues')
                  .catch(onError)
              }
            >
              <MessageSquare size={19} />
              <span>
                <strong>反馈问题</strong>
                <small>说明遇到的问题与复现步骤</small>
              </span>
              <ExternalLink size={15} />
            </button>
            <button
              className="settings-overview-row"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setDiagnostics(await workspace().getDiagnostics());
                })
              }
            >
              <FileText size={19} />
              <span>
                <strong>查看错误日志</strong>
                <small>已隐藏已保存的模型密钥与邮箱授权码</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
          <p className="settings-hint">日志留在本机。你可以查看并复制需要的内容，用于描述问题。</p>
        </div>
      )}
      {page === 'about' && (
        <div className="settings-detail">
          <section className="settings-card settings-about">
            <img src={appIcon} alt="" />
            <h2>NEU Dot</h2>
            <p>东北大学学生的本地校园工作台</p>
            <dl className="settings-values">
              <div>
                <dt>应用版本</dt>
                <dd data-app-version>{info?.version || (infoError ? '读取失败' : '正在读取')}</dd>
              </div>
              <div>
                <dt>支持平台</dt>
                <dd>macOS / Windows</dd>
              </div>
            </dl>
            <div className="settings-entry-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  void workspace()
                    .openWebsite('https://github.com/yzbcs/NEU-Dot/releases')
                    .catch(onError)
                }
              >
                查看更新记录 <ExternalLink size={13} />
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void workspace().openWebsite('https://github.com/yzbcs/NEU-Dot').catch(onError)
                }
              >
                项目主页 <ExternalLink size={13} />
              </button>
              {infoError && (
                <button className="text-button" onClick={() => void readInfo()}>
                  重新读取版本
                </button>
              )}
            </div>
          </section>
          <UpdatePanel
            update={update}
            chatBusy={state.chats.some((chat) =>
              chat.messages.some((message) => message.state === 'streaming'),
            )}
            onError={onError}
          />
        </div>
      )}
      {status && (
        <p className="settings-result settings-page-result" role="status">
          {status}
        </p>
      )}
      {diagnostics !== null && (
        <Modal title="错误日志" onClose={() => setDiagnostics(null)} wide>
          <p className="muted">已隐藏已保存的模型密钥和邮箱授权码。</p>
          <pre className="diagnostics-text">{diagnostics}</pre>
          <button
            className="secondary-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(diagnostics)
                .then(() => onNotice('日志已复制。'))
                .catch(onError)
            }
          >
            <Copy size={14} />
            复制日志
          </button>
        </Modal>
      )}
    </section>
  );
}
