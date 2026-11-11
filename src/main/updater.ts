import electronUpdater from 'electron-updater';
import type { AppUpdater, UpdateDownloadedEvent } from 'electron-updater';
import type { UpdateState } from '../shared/updates';

const { CancellationToken } = electronUpdater;

function updateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CHANNEL_FILE_NOT_FOUND|Cannot find (?:channel|latest)|404.*latest/.test(message))
    return '当前发布版本尚未提供更新信息，请稍后重试，或查看更新记录。';
  if (/CHECKSUM|checksum|校验/.test(message)) return '更新包校验失败，请重新下载。';
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|timed out|network|HttpError|status code/i.test(message))
    return '连接更新服务器失败，请检查网络后重试。';
  return message.slice(0, 500);
}

export class UpdateService {
  private state: UpdateState;
  private checking?: Promise<UpdateState>;
  private downloading?: Promise<UpdateState>;
  private installing?: Promise<void>;
  private cancellation?: InstanceType<typeof CancellationToken>;
  private downloaded?: UpdateDownloadedEvent;
  private firstCheck?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;

  constructor(
    private updater: AppUpdater | null,
    private options: {
      version: string;
      enabled: boolean;
      publish: (state: UpdateState) => void;
      beforeInstall: () => void;
      install: (event: UpdateDownloadedEvent) => Promise<void>;
      installFailed: () => void;
      initialError?: string;
    },
  ) {
    this.state = {
      status: options.enabled && updater ? 'idle' : 'unavailable',
      currentVersion: options.version,
    };
    if (options.initialError && this.state.status !== 'unavailable')
      this.state = { ...this.state, status: 'error', error: options.initialError, retry: 'check' };
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on('update-available', (info) => {
      this.downloaded = undefined;
      this.set({
        status: 'available',
        version: info.version,
        progress: undefined,
        error: undefined,
        retry: undefined,
      });
    });
    updater.on('update-not-available', () => {
      this.downloaded = undefined;
      this.set({
        status: 'current',
        version: undefined,
        progress: undefined,
        error: undefined,
        retry: undefined,
      });
    });
    updater.on('download-progress', (progress) => {
      this.set({
        status: 'downloading',
        progress: {
          percent: Math.min(100, Math.max(0, progress.percent)),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
      });
    });
    updater.on('update-downloaded', (event) => {
      this.downloaded = event;
      this.set({
        status: 'ready',
        version: event.version,
        progress: undefined,
        error: undefined,
        retry: undefined,
      });
    });
    // electron-updater also emits errors before rejecting its check/download promises.
    updater.on('error', (error) => {
      if (this.state.status === 'installing') {
        options.installFailed();
        this.fail(error, 'install');
      }
    });
  }

  getState() {
    return structuredClone(this.state);
  }

  private set(changes: Partial<UpdateState>) {
    this.state = { ...this.state, ...changes };
    this.options.publish(this.getState());
  }

  private fail(error: unknown, retry: UpdateState['retry']) {
    this.set({ status: 'error', error: updateError(error), retry, progress: undefined });
  }

  start() {
    if (this.state.status === 'unavailable' || this.interval) return;
    this.firstCheck = setTimeout(() => void this.check(), 10_000);
    this.interval = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
    this.firstCheck.unref();
    this.interval.unref();
  }

  dispose() {
    clearTimeout(this.firstCheck);
    clearInterval(this.interval);
    this.cancellation?.cancel();
  }

  check(): Promise<UpdateState> {
    if (this.checking) return this.checking;
    if (
      !this.options.enabled ||
      !this.updater ||
      this.downloading ||
      this.downloaded ||
      this.installing
    )
      return Promise.resolve(this.getState());
    this.set({ status: 'checking', error: undefined, retry: undefined });
    this.checking = Promise.resolve().then(async () => {
      try {
        if (!(await this.updater!.checkForUpdates()))
          throw new Error('当前运行方式不支持应用内更新');
      } catch (error) {
        this.fail(error, 'check');
      } finally {
        this.checking = undefined;
        this.set({ checkedAt: new Date().toISOString() });
      }
      return this.getState();
    });
    return this.checking;
  }

  download(): Promise<UpdateState> {
    if (this.downloading) return this.downloading;
    if (this.downloaded) return Promise.resolve(this.getState());
    if (
      !this.options.enabled ||
      !this.updater ||
      this.checking ||
      !(
        this.state.status === 'available' ||
        (this.state.status === 'error' && this.state.retry === 'download')
      )
    )
      return Promise.reject(new Error('请先检查并选择可用的新版本'));
    this.cancellation = new CancellationToken();
    this.set({ status: 'downloading', error: undefined, retry: undefined, progress: undefined });
    this.downloading = Promise.resolve().then(async () => {
      try {
        await this.updater!.downloadUpdate(this.cancellation);
        if (!this.downloaded) throw new Error('下载未完成，请重试');
      } catch (error) {
        if (this.cancellation?.cancelled)
          this.set({
            status: 'available',
            progress: undefined,
            error: undefined,
            retry: undefined,
          });
        else this.fail(error, 'download');
      } finally {
        this.cancellation = undefined;
        this.downloading = undefined;
      }
      return this.getState();
    });
    return this.downloading;
  }

  cancel() {
    this.cancellation?.cancel();
  }

  install(): Promise<void> {
    if (this.installing) return this.installing;
    if (!this.downloaded || !(this.state.status === 'ready' || this.state.retry === 'install'))
      return Promise.reject(new Error('请先下载更新'));
    // Check before changing state so an unfinished chat can continue normally.
    try {
      this.options.beforeInstall();
    } catch (error) {
      return Promise.reject(error);
    }
    this.set({ status: 'installing', error: undefined, retry: undefined });
    this.installing = Promise.resolve()
      .then(() => this.options.install(this.downloaded!))
      .catch((error) => {
        this.options.installFailed();
        const retryDownload = /校验|更新包/.test(
          error instanceof Error ? error.message : String(error),
        );
        if (retryDownload) this.downloaded = undefined;
        this.fail(error, retryDownload ? 'download' : 'install');
        throw error;
      })
      .finally(() => {
        this.installing = undefined;
      });
    return this.installing;
  }
}
