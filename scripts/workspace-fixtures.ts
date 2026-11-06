import { createServer as netServer, type Socket } from 'node:net';
import { createServer as tlsServer } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** 人工表格 PDF，含中文文字层、不同星期和跨两节的合并单元格。 */
export function makeTimetableFixture(path = resolve('assets/input/timetable-fixture.pdf')) {
  mkdirSync(resolve('assets/input'), { recursive: true });
  const commands: string[] = ['0.8 0.85 0.92 RG 0.5 w'];
  const texts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const text = (value: string, x: number, y: number) => {
    texts.push(value);
    const bytes = Buffer.from(value, 'utf16le');
    bytes.swap16();
    const size = /^\d{2}:/.test(value) ? 5 : value.includes('(') ? 6.5 : 8;
    commands.push(`BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm <${bytes.toString('hex')}> Tj ET`);
  };
  for (const x of [40, 120, 195, 270, 345, 420, 495, 570, 645]) line(x, 950, x, 180);
  line(40, 950, 645, 950);
  for (let row = 0; row <= 12; row++) {
    const y = 900 - row * 60;
    if (row === 1) {
      line(40, y, 120, y);
      line(195, y, 645, y);
    } else if (row === 3) {
      line(40, y, 195, y);
      line(270, y, 645, y);
    } else line(40, y, 645, y);
  }
  ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'].forEach((day, index) =>
    text(day, 142 + index * 75, 925),
  );
  const starts = [
    '08:30',
    '09:25',
    '10:30',
    '11:25',
    '14:00',
    '14:55',
    '16:00',
    '16:55',
    '18:30',
    '19:25',
    '20:20',
    '21:15',
  ];
  const ends = [
    '09:15',
    '10:10',
    '11:15',
    '12:10',
    '14:45',
    '15:40',
    '16:45',
    '17:40',
    '19:15',
    '20:10',
    '21:05',
    '22:00',
  ];
  starts.forEach((start, index) => text(start + '~' + ends[index], 43, 870 - index * 60));
  text('研1-4周', 130, 882);
  text('示例课程(示例班)', 124, 858);
  text('1号A101', 130, 805);
  text('研2,4周', 202, 762);
  text('第二课程(实验班)', 198, 738);
  text('1号B202', 202, 685);
  const chars = [...new Set(texts.join(''))];
  const cmap =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Fixture def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
    chars.length +
    ' beginbfchar ' +
    chars
      .map((char) => {
        const hex = char.charCodeAt(0).toString(16).padStart(4, '0');
        return `<${hex}> <${hex}>`;
      })
      .join(' ') +
    ' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 1000] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>',
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, pdf);
  return path;
}

export async function startMailFixture() {
  const directory = resolve('assets/input/mail-fixture');
  mkdirSync(directory, { recursive: true });
  const certPath = join(directory, 'localhost.pem'),
    keyPath = join(directory, 'localhost-key.pem');
  if (!existsSync(certPath))
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=localhost',
        '-days',
        '365',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
  const source = Buffer.from(
    'From: Fixture <sender@example.test>\r\nTo: Student <student@example.test>\r\nSubject: Fixture message\r\nDate: Tue, 3 Nov 2026 08:00:00 +0800\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMail fixture body.\r\n--fixture\r\nContent-Type: text/plain; name="example.txt"\r\nContent-Disposition: attachment; filename="example.txt"\r\n\r\nAttachment fixture.\r\n--fixture--\r\n',
  );
  const commands: string[] = [],
    sent: Buffer[] = [],
    sockets = new Set<Socket>();
  const imap = netServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID] Fixture ready\r\n');
    let pending = '';
    let empty = false;
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n'),
          raw = pending.slice(0, end);
        pending = pending.slice(end + 2);
        commands.push(raw);
        const match = /^(\S+)\s+(.+)$/s.exec(raw);
        if (!match) continue;
        const [, tag, command] = match;
        const ok = () => socket.write(tag + ' OK done\r\n');
        if (/^CAPABILITY/i.test(command)) {
          socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID\r\n');
          ok();
        } else if (/^ID /i.test(command)) {
          socket.write('* ID NIL\r\n');
          ok();
        } else if (/^AUTHENTICATE|^LOGIN/i.test(command)) ok();
        else if (/^LIST/i.test(command)) {
          socket.write(
            '* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren) "/" "Empty"\r\n',
          );
          ok();
        } else if (/^(EXAMINE|SELECT)/i.test(command)) {
          empty = /Empty/.test(command);
          socket.write(
            '* FLAGS (\\Seen)\r\n* ' +
              (empty ? 0 : 1) +
              ' EXISTS\r\n* OK [UIDVALIDITY 777] validity\r\n* OK [UIDNEXT 2] next\r\n',
          );
          ok();
        } else if (/^(UID )?FETCH/i.test(command)) {
          if (!empty) {
            let fields = 'UID 1 FLAGS ()';
            if (/ENVELOPE/i.test(command))
              fields +=
                ' ENVELOPE ("Tue, 3 Nov 2026 08:00:00 +0800" "Fixture message" (("Fixture" NIL "sender" "example.test")) NIL NIL (("Student" NIL "student" "example.test")) NIL NIL NIL "<fixture@example.test>")';
            if (/RFC822.SIZE/i.test(command)) fields += ' RFC822.SIZE ' + source.length;
            if (/BODY/i.test(command)) {
              socket.write('* 1 FETCH (' + fields + ' BODY[] {' + source.length + '}\r\n');
              socket.write(source);
              socket.write(')\r\n');
            } else socket.write('* 1 FETCH (' + fields + ')\r\n');
          }
          ok();
        } else if (/^LOGOUT/i.test(command)) {
          socket.write('* BYE logout\r\n');
          ok();
          socket.end();
        } else if (/^(NOOP|CLOSE|UNSELECT|ENABLE|UID STORE)/i.test(command)) ok();
        else socket.write(tag + ' BAD unsupported fixture command\r\n');
      }
    });
  });
  const smtp = tlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost fixture\r\n');
    let buffer = '',
      data = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (true) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) break;
          sent.push(Buffer.from(buffer.slice(0, end)));
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 queued fixture\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line))
          socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 10000000\r\n');
        else if (/^AUTH /.test(line)) socket.write('235 authenticated\r\n');
        else if (/^MAIL FROM|^RCPT TO|^RSET/.test(line)) socket.write('250 OK\r\n');
        else if (/^DATA/.test(line)) {
          data = true;
          socket.write('354 send data\r\n');
        } else if (/^QUIT/.test(line)) {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => imap.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const imapAddress = imap.address(),
    smtpAddress = smtp.address();
  if (
    !imapAddress ||
    typeof imapAddress === 'string' ||
    !smtpAddress ||
    typeof smtpAddress === 'string'
  )
    throw new Error('fixture startup failed');
  return {
    imapPort: imapAddress.port,
    smtpPort: smtpAddress.port,
    certPath,
    commands,
    sent,
    async close() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((r) => imap.close(() => r())),
        new Promise<void>((r) => smtp.close(() => r())),
      ]);
    },
  };
}
