import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { Store } from '../src/main/store';
import { MailService } from '../src/main/mail';
import { startMailFixture } from '../scripts/workspace-fixtures';
let fixture: Awaited<ReturnType<typeof startMailFixture>>,
  directory: string,
  store: Store,
  mail: MailService;
const codec = {
  encrypt: (text: string) => Buffer.from(text),
  decrypt: (bytes: Buffer) => bytes.toString(),
};
beforeAll(async () => {
  fixture = await startMailFixture();
  const transport = nodemailer.createTransport.bind(nodemailer);
  vi.spyOn(nodemailer, 'createTransport').mockImplementation(((options: Record<string, unknown>) =>
    transport({
      ...options,
      tls: { ca: readFileSync(fixture.certPath) },
    })) as typeof nodemailer.createTransport);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await fixture.close();
});
beforeEach(() => {
  mkdirSync(resolve('assets/output/test-state'), { recursive: true });
  directory = mkdtempSync(resolve('assets/output/test-state/mail-'));
  store = new Store(directory, codec);
  mail = new MailService(store, () => {});
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function add() {
  return mail.save({
    name: '本地邮件测试',
    email: 'student@example.test',
    username: 'student@example.test',
    password: 'fixture-mail-password',
    imapHost: '127.0.0.1',
    imapPort: fixture.imapPort,
    imapTls: false,
    smtpHost: '127.0.0.1',
    smtpPort: fixture.smtpPort,
    smtpTls: true,
  });
}
it('实际 IMAP 获取文件夹、列表、正文与附件，并保存可离线查看的列表缓存', async () => {
  const account = add();
  expect(JSON.stringify(store.snapshot())).not.toContain('fixture-mail-password');
  expect((await mail.folders(account.id)).map((folder) => folder.path)).toContain('INBOX');
  const page = await mail.list(account.id, 'INBOX', 1);
  expect(page.total).toBe(1);
  expect(page.messages[0].subject).toBe('Fixture message');
  expect(mail.cached(account.id, 'INBOX')).toEqual(page);
  const detail = await mail.read(account.id, 'INBOX', 1, page.uidValidity);
  expect(detail.text).toContain('Mail fixture body');
  expect(detail.attachments[0].name).toBe('example.txt');
  expect(
    (await mail.attachment(account.id, 'INBOX', 1, page.uidValidity, 0)).content.toString(),
  ).toContain('Attachment fixture');
  await expect(mail.read(account.id, 'INBOX', 1, 'other')).rejects.toThrow('刷新');
});
it('空文件夹不发起错误 FETCH 范围，邮箱凭据重启后可复用且移除后清理缓存', async () => {
  const account = add();
  expect((await mail.list(account.id, 'Empty', 1)).messages).toEqual([]);
  const reopened = new Store(directory, codec);
  expect(reopened.key('mail:' + account.id)).toBe('fixture-mail-password');
  mail.remove(account.id);
  expect(new Store(directory, codec).key('mail:' + account.id)).toBe('');
  expect(mail.cached(account.id, 'Empty')).toBeNull();
});
it('实际 TLS SMTP 验证连接并发送人工邮件，中文主题和正文经 MIME 编解码保持一致', async () => {
  const account = add();
  expect(await mail.test(account.id)).toContain('均成功');
  const before = fixture.sent.length;
  expect(
    await mail.send({
      accountId: account.id,
      to: 'recipient@example.test',
      subject: '课程安排',
      text: '这是一封本机模拟邮件。',
    }),
  ).toContain('已接收');
  expect(fixture.sent.length).toBe(before + 1);
  const parsed = await simpleParser(fixture.sent.at(-1)!);
  expect(parsed.subject).toBe('课程安排');
  expect(parsed.text).toContain('本机模拟邮件');
  await expect(
    mail.send({ accountId: account.id, to: 'not-an-address', subject: '测试', text: '测试' }),
  ).rejects.toThrow('完整邮箱');
});
