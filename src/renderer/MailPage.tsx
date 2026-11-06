import { useEffect, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  Mail,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import { SelectMenu } from './components/SelectMenu';
import { Modal, PageHeader, type PageProps } from './WorkspacePages';
import type {
  MailAccountInput,
  MailDetail,
  MailFolder,
  MailPage as MailPageData,
} from '../shared/workspace';

const blank: MailAccountInput = {
  name: '东北大学邮箱',
  email: '',
  username: '',
  imapHost: '',
  imapPort: 993,
  imapTls: true,
  smtpHost: '',
  smtpPort: 465,
  smtpTls: true,
  password: '',
};
const presets = [
  { value: 'neu', label: '东北大学学生邮箱' },
  { value: 'qq', label: 'QQ 邮箱' },
  { value: '163', label: '163 邮箱' },
  { value: 'custom', label: '自定义邮箱' },
];
const api = () => window.dola.workspace;
function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
}

export function MailPage({
  workspace,
  onError,
  focusAccountId,
}: PageProps & { focusAccountId?: string }) {
  const [accountId, setAccountId] = useState(focusAccountId ?? workspace.mailAccounts[0]?.id ?? '');
  const account = workspace.mailAccounts.find((item) => item.id === accountId);
  const [folder, setFolder] = useState('INBOX'),
    [folders, setFolders] = useState<MailFolder[]>([{ path: 'INBOX', name: '收件箱' }]);
  const [data, setData] = useState<MailPageData | null>(null),
    [detail, setDetail] = useState<MailDetail | null>(null),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState('');
  const [editor, setEditor] = useState<MailAccountInput | null>(null),
    [preset, setPreset] = useState('neu'),
    [saving, setSaving] = useState(false);
  const [compose, setCompose] = useState<{ to: string; subject: string; text: string } | null>(
      null,
    ),
    [sending, setSending] = useState(false),
    [sent, setSent] = useState('');
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setLoading(true);
    setNotice('');
    setDetail(null);
    void api()
      .mailList(accountId, folder, page)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(async (error) => {
        const cached =
          page === 1
            ? await api()
                .mailCached(accountId, folder)
                .catch(() => null)
            : null;
        if (active) {
          setData(cached);
          setNotice((cached ? '当前显示本地缓存。' : '') + message(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, folder, page, refresh]);
  function chooseAccount(id: string) {
    setRefresh((value) => value + 1);
    setAccountId(id);
    setFolder('INBOX');
    setFolders([{ path: 'INBOX', name: '收件箱' }]);
    setPage(1);
    setData(null);
    setDetail(null);
  }
  function applyPreset(value: string) {
    setPreset(value);
    setEditor((old) =>
      old
        ? {
            ...old,
            name:
              value === 'qq'
                ? 'QQ 邮箱'
                : value === '163'
                  ? '163 邮箱'
                  : value === 'neu'
                    ? '东北大学邮箱'
                    : '我的邮箱',
            imapHost: value === 'qq' ? 'imap.qq.com' : value === '163' ? 'imap.163.com' : '',
            smtpHost: value === 'qq' ? 'smtp.qq.com' : value === '163' ? 'smtp.163.com' : '',
            imapPort: 993,
            smtpPort: 465,
            imapTls: true,
            smtpTls: true,
          }
        : old,
    );
  }
  async function read(uid: number) {
    if (!data) return;
    setLoading(true);
    try {
      setDetail(await api().mailRead(accountId, folder, uid, data.uidValidity));
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }
  async function save(test: boolean) {
    if (!editor) return;
    setSaving(true);
    try {
      const saved = await api().saveMailAccount({
        ...editor,
        username: editor.username || editor.email,
      });
      setEditor({ ...saved, password: '' });
      chooseAccount(saved.id);
      if (test) {
        setSent(await api().testMailAccount(saved.id));
      } else setEditor(null);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }
  function openCompose(to = '', subject = '', text = '') {
    const key = 'dola-mail-draft:' + accountId;
    let draft = { to, subject, text };
    if (!to && !subject && !text) {
      try {
        draft = JSON.parse(localStorage.getItem(key) || 'null') || draft;
      } catch {}
    }
    setCompose(draft);
    setSent('');
  }
  function updateCompose(field: string, value: string) {
    setCompose((old) => {
      if (!old) return old;
      const next = { ...old, [field]: value };
      localStorage.setItem('dola-mail-draft:' + accountId, JSON.stringify(next));
      return next;
    });
  }
  return (
    <section className="work-page mail-page">
      <PageHeader
        eyebrow="MAIL, IN ONE PLACE"
        title="邮箱"
        subtitle="把学校通知和日常来信，放在同一个收件箱。"
      >
        <button
          className="secondary-button"
          onClick={() => {
            setEditor({ ...blank });
            setPreset('neu');
          }}
        >
          <Plus size={15} />
          添加邮箱
        </button>
        <button className="primary-button" disabled={!account} onClick={() => openCompose()}>
          <Send size={15} />
          写邮件
        </button>
      </PageHeader>
      <div className="mail-layout">
        <aside className="mail-accounts">
          <h3>我的邮箱</h3>
          {workspace.mailAccounts.map((item) => (
            <button
              disabled={loading}
              className={'mail-account ' + (item.id === accountId ? 'active' : '')}
              key={item.id}
              onClick={() => chooseAccount(item.id)}
            >
              <Mail size={17} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.email}</small>
              </span>
            </button>
          ))}
          {account && (
            <>
              <div className="mail-folder-control">
                <SelectMenu
                  name="mail-folder"
                  label="邮件文件夹"
                  value={folder}
                  options={folders.map((item) => ({ value: item.path, label: item.name }))}
                  onChange={(value) => {
                    setFolder(value);
                    setPage(1);
                  }}
                  disabled={loading}
                />
                <button
                  className="text-button"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      setFolders(await api().mailFolders(accountId));
                    } catch (e) {
                      onError(e);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  读取文件夹列表
                </button>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setPreset('custom');
                  setEditor({ ...account, password: '' });
                }}
              >
                <Settings2 size={14} />
                账号设置
              </button>
            </>
          )}
        </aside>
        <div className="mail-main">
          {!account ? (
            <div className="work-empty">
              <Mail size={38} />
              <h2>连接你的第一个邮箱</h2>
              <p>
                支持东北大学学生邮箱、QQ、163，以及其他 IMAP / SMTP 邮箱。授权码加密保存在这台电脑。
              </p>
              <button className="primary-button" onClick={() => setEditor({ ...blank })}>
                添加邮箱
              </button>
              <button
                className="text-button"
                onClick={() => api().openWebsite('https://mails.neu.edu.cn').catch(onError)}
              >
                打开学校云邮箱 <ExternalLink size={13} />
              </button>
            </div>
          ) : (
            <>
              <div className="mail-toolbar">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索当前页主题或发件人"
                />
                <span>
                  {loading
                    ? '正在连接邮箱'
                    : data
                      ? `共 ${data.total} 封 · 第 ${data.page} 页`
                      : ''}
                </span>
                <button
                  className="secondary-button"
                  disabled={loading}
                  onClick={() => setRefresh(refresh + 1)}
                >
                  <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                  刷新
                </button>
              </div>
              {notice && <div className="inline-info">{notice}</div>}
              {sent && <div className="inline-success">{sent}</div>}
              {detail ? (
                <article className="mail-detail">
                  <button className="text-button" onClick={() => setDetail(null)}>
                    <ArrowLeft size={14} />
                    返回列表
                  </button>
                  <h2>{detail.subject}</h2>
                  <p>发件人：{detail.from}</p>
                  <p>收件人：{detail.to}</p>
                  <p>
                    {detail.date
                      ? new Date(detail.date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                      : ''}
                  </p>
                  <div className="mail-attachments">
                    {detail.attachments.map((item) => (
                      <button
                        className="secondary-button"
                        key={item.index}
                        onClick={() =>
                          api()
                            .mailAttachment(
                              accountId,
                              folder,
                              detail.uid,
                              data!.uidValidity,
                              item.index,
                            )
                            .catch(onError)
                        }
                      >
                        <Download size={13} />
                        {item.name} · {Math.ceil(item.size / 1024)} KB
                      </button>
                    ))}
                  </div>
                  <pre>{detail.text}</pre>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      openCompose(
                        detail.from.match(/<([^>]+)>/)?.[1] ?? detail.from,
                        /^Re:/i.test(detail.subject) ? detail.subject : 'Re: ' + detail.subject,
                        '',
                      )
                    }
                  >
                    <Send size={13} />
                    回复
                  </button>
                </article>
              ) : (
                <>
                  <div className="mail-message-list">
                    {data?.messages
                      .filter((item) =>
                        [item.subject, item.from]
                          .join(' ')
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((item) => (
                        <button
                          disabled={loading}
                          key={item.uid}
                          className={'mail-message ' + (!item.seen ? 'unread' : '')}
                          onClick={() => void read(item.uid)}
                        >
                          <span className="mail-sender">{item.from || '未知发件人'}</span>
                          <strong>{item.subject}</strong>
                          <time>
                            {item.date
                              ? new Date(item.date).toLocaleDateString('zh-CN', {
                                  timeZone: 'Asia/Shanghai',
                                })
                              : ''}
                          </time>
                        </button>
                      ))}
                    {!loading && data && !data.messages.length && (
                      <div className="work-empty">
                        <p>这个文件夹还没有邮件。</p>
                      </div>
                    )}
                  </div>
                  <div className="mail-pagination">
                    <button
                      className="secondary-button"
                      disabled={loading || page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={14} />
                      较新
                    </button>
                    <span>每页 40 封</span>
                    <button
                      className="secondary-button"
                      disabled={loading || !data || page * 40 >= data.total}
                      onClick={() => setPage(page + 1)}
                    >
                      较早
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {editor && (
        <Modal
          title={editor.id ? '邮箱账号设置' : '添加邮箱'}
          onClose={() => {
            if (!saving) setEditor(null);
          }}
        >
          <form
            className="work-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <label>
              邮箱类型
              <SelectMenu
                name="mail-preset"
                label="邮箱类型"
                value={preset}
                options={presets}
                onChange={applyPreset}
                disabled={saving}
              />
            </label>
            {preset === 'neu' && (
              <div className="inline-info">
                学校学生邮箱已迁移到云平台。请在网页邮箱的客户端设置中查看 IMAP / SMTP
                地址并生成专用密码。
                <button
                  type="button"
                  className="text-button"
                  onClick={() => api().openWebsite('https://mails.neu.edu.cn').catch(onError)}
                >
                  打开学校云邮箱 <ExternalLink size={12} />
                </button>
              </div>
            )}
            <div className="field-pair">
              <label>
                显示名称
                <input
                  name="mailName"
                  required
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                />
              </label>
              <label>
                邮箱地址
                <input
                  name="mailEmail"
                  type="email"
                  required
                  value={editor.email}
                  onChange={(e) => setEditor({ ...editor, email: e.target.value })}
                  placeholder="学号@mails.neu.edu.cn"
                />
              </label>
            </div>
            <label>
              登录用户名
              <input
                value={editor.username}
                onChange={(e) => setEditor({ ...editor, username: e.target.value })}
                placeholder="留空使用完整邮箱地址"
              />
            </label>
            <label>
              客户端授权码 / 专用密码
              <input
                name="mailPassword"
                type="password"
                autoComplete="new-password"
                required={!editor.id}
                value={editor.password}
                onChange={(e) => setEditor({ ...editor, password: e.target.value })}
                placeholder={editor.id ? '已保存，留空保留' : 'QQ、163 请使用客户端授权码'}
              />
            </label>
            <div className="server-fields">
              <label>
                IMAP 收件服务器
                <input
                  name="imapHost"
                  required
                  value={editor.imapHost}
                  onChange={(e) => setEditor({ ...editor, imapHost: e.target.value })}
                  placeholder="服务器地址，不带 https://"
                />
              </label>
              <label>
                端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={editor.imapPort}
                  name="imapPort"
                  onChange={(e) => setEditor({ ...editor, imapPort: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                name="imapTls"
                checked={editor.imapTls}
                onChange={(e) => setEditor({ ...editor, imapTls: e.target.checked })}
              />
              IMAP 使用 SSL/TLS（通常为 993）
            </label>
            <div className="server-fields">
              <label>
                SMTP 发件服务器
                <input
                  name="smtpHost"
                  required
                  value={editor.smtpHost}
                  onChange={(e) => setEditor({ ...editor, smtpHost: e.target.value })}
                  placeholder="服务器地址，不带 https://"
                />
              </label>
              <label>
                端口
                <input
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={editor.smtpPort}
                  name="smtpPort"
                  onChange={(e) => setEditor({ ...editor, smtpPort: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={editor.smtpTls}
                onChange={(e) => setEditor({ ...editor, smtpTls: e.target.checked })}
              />
              SMTP 使用 SSL/TLS（465）；取消后使用 STARTTLS（如 587）
            </label>
            <div className="work-actions end">
              {editor.id && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="移除邮箱"
                  disabled={saving}
                  onClick={async () => {
                    if (!confirm('移除这个邮箱账号和本机列表缓存？服务器邮件会保留。')) return;
                    try {
                      await api().removeMailAccount(editor.id!);
                      setEditor(null);
                      chooseAccount(
                        workspace.mailAccounts.find((item) => item.id !== editor.id)?.id ?? '',
                      );
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={() => void save(true)}
              >
                {saving ? '正在处理' : '保存并测试'}
              </button>
              <button className="primary-button" disabled={saving}>
                保存邮箱
              </button>
            </div>
          </form>
        </Modal>
      )}
      {compose && (
        <Modal
          title="写邮件"
          onClose={() => {
            if (!sending) setCompose(null);
          }}
          wide
        >
          <form
            className="work-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (sending) return;
              setSending(true);
              try {
                const result = await api().mailSend({ accountId, ...compose });
                localStorage.removeItem('dola-mail-draft:' + accountId);
                setCompose(null);
                setSent(result);
              } catch (error) {
                onError(error);
              } finally {
                setSending(false);
              }
            }}
          >
            <p className="muted">发件人：{account?.email}</p>
            <label>
              收件人
              <input
                name="mailTo"
                required
                value={compose.to}
                onChange={(e) => updateCompose('to', e.target.value)}
                placeholder="完整邮箱地址，多人用逗号分隔"
              />
            </label>
            <label>
              主题
              <input
                name="mailSubject"
                value={compose.subject}
                onChange={(e) => updateCompose('subject', e.target.value)}
              />
            </label>
            <label>
              正文
              <textarea
                name="mailBody"
                required
                rows={12}
                value={compose.text}
                onChange={(e) => updateCompose('text', e.target.value)}
              />
            </label>
            <div className="work-actions end">
              <span className="muted">草稿暂存在本机；点击发送后提交给邮箱服务器。</span>
              <button className="primary-button" disabled={sending}>
                <Send size={14} />
                {sending ? '正在发送' : '发送邮件'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
