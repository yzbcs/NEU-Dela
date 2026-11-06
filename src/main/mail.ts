import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './store';
import type {
  MailAccount,
  MailAccountInput,
  MailDetail,
  MailDraft,
  MailPage,
} from '../shared/workspace';

const accountInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  email: z.string().trim().email('请填写完整邮箱地址'),
  username: z.string().trim().min(1),
  imapHost: z.string().trim().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapTls: z.boolean(),
  smtpHost: z.string().trim().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpTls: z.boolean(),
  password: z.string().optional(),
});

export class MailService {
  constructor(
    private store: Store,
    private changed: () => void,
  ) {}
  account(id: string) {
    const account = this.store.workspace.mailAccounts.find((item) => item.id === id);
    if (!account) throw new Error('邮箱账号不存在');
    return account;
  }
  save(raw: MailAccountInput): MailAccount {
    const input = accountInput.parse(raw);
    const old = input.id ? this.account(input.id) : undefined;
    if (
      old &&
      (old.imapHost !== input.imapHost ||
        old.smtpHost !== input.smtpHost ||
        old.username !== input.username) &&
      !input.password
    )
      throw new Error('修改服务器或用户名后，请重新填写授权码');
    const id = input.id ?? randomUUID();
    const password = input.password || this.store.key('mail:' + id);
    if (!password) throw new Error('请填写客户端授权码或专用密码');
    this.store.setSecret('mail:' + id, password);
    if (
      old &&
      (old.username !== input.username ||
        old.imapHost !== input.imapHost ||
        old.email !== input.email)
    )
      rmSync(join(this.store.dataDirectory, 'mail-cache', id + '.json'), { force: true });
    const { password: ignored, ...metadata } = input;
    const account = { ...metadata, id, hasPassword: true };
    this.store.workspace.mailAccounts = [
      ...this.store.workspace.mailAccounts.filter((item) => item.id !== id),
      account,
    ];
    this.store.saveWorkspace();
    this.changed();
    return account;
  }
  remove(id: string) {
    this.account(id);
    this.store.setSecret('mail:' + id, '');
    rmSync(join(this.store.dataDirectory, 'mail-cache', id + '.json'), { force: true });
    this.store.workspace.mailAccounts = this.store.workspace.mailAccounts.filter(
      (item) => item.id !== id,
    );
    this.store.saveWorkspace();
    this.changed();
  }
  private async connected<T>(
    id: string,
    run: (client: ImapFlow) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const account = this.account(id),
      password = this.store.key('mail:' + id);
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapTls,
      auth: { user: account.username, pass: password },
      logger: false,
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      clientInfo: { name: 'NEU-Dela', version: '0.2.0' },
    });
    client.on('error', () => {});
    const abort = () => client.close();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await client.connect();
      const result = await run(client);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      throw new Error(this.store.redact(error instanceof Error ? error.message : String(error)));
    } finally {
      if (client.usable) await client.logout().catch(() => client.close());
      else client.close();
      signal?.removeEventListener('abort', abort);
    }
  }
  private transport(id: string) {
    const account = this.account(id);
    return nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpTls,
      requireTLS: !account.smtpTls,
      auth: { user: account.username, pass: this.store.key('mail:' + id) },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
    });
  }
  async test(id: string) {
    await this.connected(id, async () => {});
    const transport = this.transport(id);
    try {
      await transport.verify();
      return 'IMAP 收信与 SMTP 发信连接均成功';
    } catch (error) {
      throw new Error(
        '收信连接成功；发信连接失败：' +
          this.store.redact(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      transport.close();
    }
  }
  async folders(id: string) {
    return this.connected(id, async (client) =>
      (await client.list())
        .filter((folder) => !folder.flags.has('\\Noselect'))
        .map((folder) => ({ path: folder.path, name: folder.name })),
    );
  }
  async list(id: string, folder: string, page: number, signal?: AbortSignal): Promise<MailPage> {
    return this.connected(
      id,
      async (client) => {
        const box = await client.mailboxOpen(folder, { readOnly: true });
        const total = box.exists;
        const end = total - (page - 1) * 40,
          start = Math.max(1, end - 39);
        const messages =
          end < 1
            ? []
            : await client.fetchAll(`${start}:${end}`, { envelope: true, flags: true, uid: true });
        const result: MailPage = {
          total,
          page,
          syncedAt: new Date().toISOString(),
          uidValidity: box.uidValidity.toString(),
          messages: messages.reverse().map((message) => ({
            uid: message.uid,
            subject: message.envelope?.subject || '（无主题）',
            from:
              message.envelope?.from
                ?.map((person) =>
                  person.name ? `${person.name} <${person.address}>` : person.address,
                )
                .join(', ') ?? '',
            date:
              message.envelope?.date instanceof Date
                ? message.envelope.date.toISOString()
                : String(message.envelope?.date ?? ''),
            seen: message.flags?.has('\\Seen') ?? false,
          })),
        };
        if (page === 1) {
          const directory = join(this.store.dataDirectory, 'mail-cache');
          mkdirSync(directory, { recursive: true });
          const path = join(directory, id + '.json');
          const cache = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
          cache[folder] = result;
          writeFileSync(path, JSON.stringify(cache));
        }
        return result;
      },
      signal,
    );
  }
  cached(id: string, folder: string): MailPage | null {
    const path = join(this.store.dataDirectory, 'mail-cache', id + '.json');
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8'))[folder] ?? null) : null;
  }
  private async parsed(
    id: string,
    folder: string,
    uid: number,
    uidValidity: string,
    signal?: AbortSignal,
  ) {
    return this.connected(
      id,
      async (client) => {
        const box = await client.mailboxOpen(folder, { readOnly: true });
        if (box.uidValidity.toString() !== uidValidity)
          throw new Error('文件夹已发生变化，请刷新邮件列表后重新打开');
        const metadata = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!metadata) throw new Error('邮件已被移动或删除，请刷新列表');
        if (metadata.size && metadata.size > 25 * 1024 * 1024)
          throw new Error('这封邮件超过 25 MB，请在网页邮箱中打开');
        const message = await client.fetchOne(
          String(uid),
          { source: true, flags: true },
          { uid: true },
        );
        if (!message || !message.source) throw new Error('邮件正文不可用');
        return {
          mail: await simpleParser(message.source),
          seen: message.flags?.has('\\Seen') ?? false,
        };
      },
      signal,
    );
  }
  async read(
    id: string,
    folder: string,
    uid: number,
    uidValidity: string,
    signal?: AbortSignal,
  ): Promise<MailDetail> {
    const { mail, seen } = await this.parsed(id, folder, uid, uidValidity, signal);
    return {
      uid,
      subject: mail.subject ?? '（无主题）',
      from: mail.from?.text ?? '',
      to: Array.isArray(mail.to) ? mail.to.map((to) => to.text).join(', ') : (mail.to?.text ?? ''),
      date: mail.date?.toISOString() ?? '',
      seen,
      text: mail.text ?? '这封邮件没有可显示的文本正文，请在网页邮箱中查看。',
      attachments: mail.attachments.map((attachment, index) => ({
        index,
        name: attachment.filename ?? `附件${index + 1}`,
        size: attachment.size,
      })),
    };
  }
  async attachment(id: string, folder: string, uid: number, uidValidity: string, index: number) {
    const { mail } = await this.parsed(id, folder, uid, uidValidity);
    const attachment = mail.attachments[index];
    if (!attachment) throw new Error('附件不存在');
    return attachment;
  }
  async send(raw: MailDraft) {
    const draft = z
      .object({
        accountId: z.string().uuid(),
        to: z.string().trim().min(1),
        subject: z.string().max(1000),
        text: z.string().min(1).max(1000000),
      })
      .parse(raw);
    const recipients = draft.to
      .split(/[,;，；\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !recipients.length ||
      recipients.some((value) => !z.string().email().safeParse(value).success)
    )
      throw new Error('收件人需为完整邮箱地址，多人用逗号分隔');
    const account = this.account(draft.accountId);
    const transport = this.transport(account.id);
    try {
      const result = await transport.sendMail({
        from: { name: account.name, address: account.email },
        to: recipients,
        subject: draft.subject,
        text: draft.text,
      });
      if (result.rejected.length)
        throw new Error(
          '部分收件人被服务器拒绝：' +
            result.rejected.join(', ') +
            '。请勿重复发送给已接收的收件人。',
        );
      return '发件服务器已接收邮件。最终投递状态请在网页邮箱查看。';
    } catch (error) {
      throw new Error(this.store.redact(error instanceof Error ? error.message : String(error)));
    } finally {
      transport.close();
    }
  }
}
