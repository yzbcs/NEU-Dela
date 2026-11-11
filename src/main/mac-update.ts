import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import electronUpdater from 'electron-updater';
import executorPackage from 'electron-updater/out/electronHttpExecutor.js';
import type { DownloadUpdateOptions } from 'electron-updater/out/AppUpdater';

const run = promisify(execFile);
const { AppUpdater } = electronUpdater;

// Reuse electron-updater's feed, version selection, download cache and SHA-512 verification.
// Installation uses our helper so the existing unsigned Mac distribution can also upgrade.
export class MacZipUpdater extends AppUpdater {
  private executor = new executorPackage.ElectronHttpExecutor();

  constructor() {
    super(undefined);
  }

  protected async doDownloadUpdate(options: DownloadUpdateOptions) {
    const { info, provider } = options.updateInfoAndProvider;
    const file = provider
      .resolveFiles(info)
      .find((item) => item.url.pathname.endsWith(`-mac-${process.arch}.zip`));
    if (!file || !file.info.sha512) throw new Error('发布版本缺少当前 Mac 架构的更新包或校验信息');
    if (
      file.url.protocol !== 'https:' ||
      file.url.hostname !== 'github.com' ||
      !file.url.pathname.startsWith('/yzbcs/NEU-Dot/releases/download/')
    ) {
      throw new Error('更新包来源与 NEU Dot 官方发布地址不一致');
    }
    return this.executeDownload({
      fileExtension: 'zip',
      fileInfo: file,
      downloadUpdateOptions: options,
      task: async (destination, downloadOptions) => {
        await this.executor.download(file.url, destination, downloadOptions);
      },
      done: async (event) => this.dispatchUpdateDownloaded(event),
    });
  }

  quitAndInstall(): void {
    throw new Error('请使用 NEU Dot 的重启安装入口');
  }
}

interface MacInstallPlan {
  target: string;
  stage: string;
  version: string;
  token: string;
}

export function macBundlePath(executable: string) {
  const bundle = resolve(executable, '../../..');
  if (!bundle.endsWith('.app') || dirname(executable) !== join(bundle, 'Contents', 'MacOS')) {
    throw new Error('请从已安装的 NEU Dot.app 中运行更新');
  }
  return bundle;
}

async function verifyArchive(path: string, expected: string) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('base64') !== expected) throw new Error('更新包校验失败，请重新下载');
  const { stdout } = await run('/usr/bin/unzip', ['-Z1', path], { maxBuffer: 16 * 1024 * 1024 });
  const entries = stdout.trim().split('\n');
  if (
    entries.some(
      (entry) => isAbsolute(entry) || entry.split('/').includes('..') || /[\r\0]/.test(entry),
    )
  ) {
    throw new Error('更新包包含无效的文件路径');
  }
}

async function verifyLinks(directory: string, root = directory): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const destination = relative(root, await realpath(path));
      if (destination === '..' || destination.startsWith('..' + sep) || isAbsolute(destination))
        throw new Error('更新包包含指向应用目录之外的链接');
    } else if (entry.isDirectory()) await verifyLinks(path, root);
  }
}

async function bundleValue(bundle: string, key: string) {
  const { stdout } = await run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :' + key,
    join(bundle, 'Contents/Info.plist'),
  ]);
  return stdout.trim();
}

async function acquireLock(path: string) {
  try {
    const pid = Number(await readFile(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('更新锁无效，请重新打开应用后重试');
    try {
      process.kill(pid, 0);
      throw new Error('另一项安装正在进行，请稍后重试');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const file = await open(path, 'wx', 0o600);
  await file.writeFile(String(process.pid));
  await file.close();
}

export async function prepareMacInstall(options: {
  executable: string;
  archive: string;
  sha512: string;
  version: string;
  dataDirectory: string;
  helper: string;
}) {
  const target = await realpath(macBundlePath(options.executable));
  const parent = dirname(target);
  try {
    await access(parent, constants.W_OK);
    await access(target, constants.W_OK);
  } catch {
    throw new Error('应用目录无法写入。请先将 NEU Dot 移到“应用程序”文件夹，再重试更新。');
  }
  await verifyArchive(options.archive, options.sha512);
  const lock = target + '.update-lock';
  await acquireLock(lock);
  let stage = '';
  try {
    stage = await mkdtemp(join(parent, '.neu-dot-update-'));
    const unpacked = join(stage, 'unpacked');
    await run('/usr/bin/ditto', ['-x', '-k', options.archive, unpacked], { timeout: 180000 });
    const applications = (await readdir(unpacked)).filter((name) => name.endsWith('.app'));
    if (applications.length !== 1) throw new Error('更新包中的应用数量不正确');
    const incoming = join(unpacked, applications[0]);
    await verifyLinks(incoming);
    if ((await bundleValue(incoming, 'CFBundleIdentifier')) !== 'cn.neu.dola')
      throw new Error('更新包的应用标识不正确');
    if ((await bundleValue(incoming, 'CFBundleShortVersionString')) !== options.version)
      throw new Error('更新包版本与发布信息不一致');
    const executable = await bundleValue(incoming, 'CFBundleExecutable');
    if (
      !executable ||
      basename(executable) !== executable ||
      executable === '.' ||
      executable === '..'
    )
      throw new Error('更新包的程序入口无效');
    const binary = join(incoming, 'Contents/MacOS', executable);
    await access(binary, constants.X_OK);
    if (!(await stat(binary)).isFile()) throw new Error('更新包的程序入口不是文件');
    const updates = join(options.dataDirectory, 'updates');
    await mkdir(updates, { recursive: true });
    const plan: MacInstallPlan = { target, stage, version: options.version, token: randomUUID() };
    await writeFile(join(updates, 'mac-install.json'), JSON.stringify(plan), { mode: 0o600 });
    await copyFile(options.helper, join(stage, 'install.sh'));
    const log = await open(join(updates, 'install.log'), 'a', 0o600);
    const child = spawn(
      '/bin/sh',
      [
        join(stage, 'install.sh'),
        String(process.pid),
        target,
        incoming,
        stage,
        executable,
        options.dataDirectory,
        plan.token,
        lock,
        basename(options.executable),
      ],
      { detached: true, stdio: ['ignore', log.fd, log.fd] },
    );
    await new Promise<void>((done, reject) => {
      child.once('spawn', done);
      child.once('error', reject);
    });
    child.unref();
    await log.close();
    // Handshake before quitting keeps a failed helper launch from closing the working app.
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await readFile(join(stage, 'ready'), 'utf8').catch(() => '')) === plan.token) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    child.kill('SIGTERM');
    throw new Error('更新安装程序未能启动，请重试');
  } catch (error) {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { force: true });
    throw error;
  }
}

export async function acknowledgeMacInstall(
  executable: string,
  version: string,
  dataDirectory: string,
) {
  try {
    const plan = JSON.parse(
      await readFile(join(dataDirectory, 'updates/mac-install.json'), 'utf8'),
    ) as MacInstallPlan;
    const target = await realpath(macBundlePath(executable));
    if (
      plan.target !== target ||
      plan.version !== version ||
      dirname(plan.stage) !== dirname(target) ||
      !/^\.neu-dot-update-[a-zA-Z0-9]+$/.test(basename(plan.stage)) ||
      !process.argv.includes('--dola-update-token=' + plan.token)
    )
      return;
    await writeFile(join(plan.stage, 'started'), plan.token, { mode: 0o600 });
  } catch {
    // A normal launch has no pending install plan.
  }
}
