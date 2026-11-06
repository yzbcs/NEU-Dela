import { useState, type FormEvent } from 'react';
import { Check, ExternalLink, Trash2, Zap } from 'lucide-react';
import type { MailAccount, MailAccountInput } from '../../shared/workspace';
import { SelectMenu } from './SelectMenu';

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

export function MailSettingsForm({
  account,
  busy,
  setBusy,
  onSaved,
  onCancel,
  onError,
  onNotice,
}: {
  account?: MailAccount;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
  onNotice: (notice: string) => void;
}) {
  const [draft, setDraft] = useState<MailAccountInput>(
    account ? { ...account, password: '' } : blank,
  );
  const [preset, setPreset] = useState(account ? 'custom' : 'neu');
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  function update<K extends keyof MailAccountInput>(field: K, value: MailAccountInput[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setStatus('');
  }
  async function run(name: string, task: () => Promise<void>) {
    setBusy(true);
    setAction(name);
    setStatus('');
    try {
      await task();
    } catch (error) {
      setStatus(
        (name === 'test' ? '连接测试失败：' : '') +
          (error instanceof Error ? error.message : String(error)).replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
          ),
      );
      onError(error);
    } finally {
      setBusy(false);
      setAction('');
    }
  }
  function applyPreset(value: string) {
    setPreset(value);
    setStatus('');
    setDraft((previous) => ({
      ...previous,
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
    }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const input = {
      ...draft,
      username: draft.username || draft.email,
      password: draft.password || undefined,
    };
    if (target?.value === 'test')
      void run('test', async () => {
        const result = await window.dola.workspace.testMailConnection(input);
        setStatus(result + ' 本次测试不会保存配置。');
      });
    else
      void run('save', async () => {
        await window.dola.workspace.saveMailAccount(input);
        onNotice('邮箱账号已保存。');
        onSaved();
      });
  }
  return (
    <form className="work-form settings-editor" data-settings-page="mail-editor" onSubmit={submit}>
      <div className="settings-editor-heading">
        <div>
          <h2>{account ? '编辑邮箱账号' : '添加邮箱账号'}</h2>
          <p>在这里管理连接，在邮箱页面阅读和发送邮件。</p>
        </div>
        {account && (
          <button
            type="button"
            className="icon-button danger"
            aria-label="移除邮箱账号"
            disabled={busy}
            onClick={() => {
              if (window.confirm('从本机移除这个邮箱账号？服务器上的邮件会保留。'))
                void run('remove', async () => {
                  await window.dola.workspace.removeMailAccount(account.id);
                  onNotice('邮箱账号已移除。');
                  onSaved();
                });
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <fieldset disabled={busy}>
        <label>
          邮箱类型
          <SelectMenu
            name="mail-preset"
            label="邮箱类型"
            value={preset}
            options={[
              { value: 'neu', label: '东北大学学生邮箱' },
              { value: 'qq', label: 'QQ 邮箱' },
              { value: '163', label: '163 邮箱' },
              { value: 'custom', label: '自定义邮箱' },
            ]}
            onChange={applyPreset}
            disabled={busy}
          />
        </label>
        {preset === 'neu' && (
          <div className="inline-info">
            请在学校网页邮箱的客户端设置中查看 IMAP / SMTP 地址并生成专用密码。
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void window.dola.workspace.openWebsite('https://mails.neu.edu.cn').catch(onError)
              }
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
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <label>
            邮箱地址
            <input
              name="mailEmail"
              type="email"
              required
              value={draft.email}
              onChange={(event) => update('email', event.target.value)}
            />
          </label>
        </div>
        <label>
          登录用户名
          <input
            name="mailUsername"
            value={draft.username}
            onChange={(event) => update('username', event.target.value)}
            placeholder="留空使用完整邮箱地址"
          />
        </label>
        <label>
          客户端授权码 / 专用密码
          <input
            name="mailPassword"
            type="password"
            autoComplete="new-password"
            required={!account?.hasPassword}
            value={draft.password}
            onChange={(event) => update('password', event.target.value)}
            placeholder={
              account?.hasPassword ? '已保存，留空保留现有授权码' : '填写邮箱客户端授权码或专用密码'
            }
          />
        </label>
        <div className="server-fields">
          <label>
            IMAP 收件服务器
            <input
              name="imapHost"
              required
              value={draft.imapHost}
              onChange={(event) => update('imapHost', event.target.value)}
              placeholder="服务器地址，不带 https://"
            />
          </label>
          <label>
            IMAP 端口
            <input
              name="imapPort"
              type="number"
              required
              min={1}
              max={65535}
              value={draft.imapPort}
              onChange={(event) => update('imapPort', Number(event.target.value))}
            />
          </label>
        </div>
        <label className="check-label">
          <input
            name="imapTls"
            type="checkbox"
            checked={draft.imapTls}
            onChange={(event) => update('imapTls', event.target.checked)}
          />
          IMAP 使用 SSL/TLS（通常为 993）
        </label>
        <div className="server-fields">
          <label>
            SMTP 发件服务器
            <input
              name="smtpHost"
              required
              value={draft.smtpHost}
              onChange={(event) => update('smtpHost', event.target.value)}
              placeholder="服务器地址，不带 https://"
            />
          </label>
          <label>
            SMTP 端口
            <input
              name="smtpPort"
              type="number"
              required
              min={1}
              max={65535}
              value={draft.smtpPort}
              onChange={(event) => update('smtpPort', Number(event.target.value))}
            />
          </label>
        </div>
        <label className="check-label">
          <input
            name="smtpTls"
            type="checkbox"
            checked={draft.smtpTls}
            onChange={(event) => update('smtpTls', event.target.checked)}
          />
          SMTP 使用 SSL/TLS（通常为 465）
        </label>
        {status && (
          <p className="settings-result" role="status">
            {status}
          </p>
        )}
        <div className="settings-editor-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" value="test" className="secondary-button">
            <Zap size={14} />
            {action === 'test' ? '正在测试' : '测试连接'}
          </button>
          <button type="submit" value="save" className="primary-button">
            <Check size={15} />
            {action === 'save' ? '正在保存' : '保存账号'}
          </button>
        </div>
      </fieldset>
      <p className="settings-hint">
        测试使用当前填写的参数验证收发连接，不发送邮件、不保存账号。保存成功后，可到邮箱页面收信。
      </p>
    </form>
  );
}
