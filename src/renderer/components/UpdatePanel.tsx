import { useState } from 'react';
import { Download, RefreshCw, RotateCw } from 'lucide-react';
import type { UpdateState } from '../../shared/updates';
import { flushNoteEdits } from './useNoteEditor';

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

export function UpdatePanel({
  update,
  chatBusy,
  onError,
}: {
  update: UpdateState | null;
  chatBusy: boolean;
  onError: (error: unknown) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  if (!update)
    return (
      <section className="settings-card">
        <p>正在读取更新状态</p>
      </section>
    );
  const check = () => void window.dola.updates.check().catch(onError);
  const download = () => void window.dola.updates.download().catch(onError);
  async function install() {
    setPreparing(true);
    try {
      await flushNoteEdits();
      await window.dola.updates.install();
    } catch (error) {
      onError(error);
    } finally {
      setPreparing(false);
    }
  }
  const titles: Record<UpdateState['status'], string> = {
    idle: '启动后会自动检查新版本',
    checking: '正在检查更新',
    current: '当前已是最新版本',
    available: `发现新版本 ${update.version}`,
    downloading: `正在下载 ${update.version}`,
    ready: `${update.version} 已下载完成`,
    installing: '正在准备重启安装',
    error: '更新未完成',
    unavailable: '开发模式下暂不启用更新',
  };
  const action = update.status === 'error' ? update.retry : update.status;
  return (
    <section className="settings-card update-panel" data-update-status={update.status}>
      <h3>应用更新</h3>
      <p className="update-status" role="status">
        {titles[update.status]}
      </p>
      {update.error && (
        <p className="update-error" role="alert">
          {update.error}
        </p>
      )}
      {update.status === 'downloading' && (
        <div className="update-progress">
          <progress max={100} value={update.progress?.percent} aria-label="更新下载进度" />
          <span>
            {update.progress
              ? `${Math.floor(update.progress.percent)}% · ${megabytes(update.progress.transferred)} / ${megabytes(update.progress.total)}`
              : '正在连接下载服务器'}
          </span>
          {Boolean(update.progress?.bytesPerSecond) && (
            <small>{megabytes(update.progress!.bytesPerSecond)}/s</small>
          )}
        </div>
      )}
      {update.status === 'unavailable' ? (
        <p className="settings-hint">安装包版本支持启动检查、更新提醒、下载及重启安装。</p>
      ) : (
        <div className="settings-entry-actions">
          {(action === 'available' || action === 'download') && (
            <button className="primary-button" data-update-download onClick={download}>
              <Download size={15} />
              {action === 'download' ? '重新下载' : '下载更新'}
            </button>
          )}
          {(action === 'ready' || action === 'install') && (
            <button
              className="primary-button"
              data-update-install
              disabled={preparing || chatBusy}
              onClick={() => void install()}
            >
              <RotateCw size={15} />
              {preparing ? '正在保存笔记' : '重启并安装'}
            </button>
          )}
          {update.status === 'downloading' && (
            <button
              className="secondary-button"
              onClick={() => void window.dola.updates.cancel().catch(onError)}
            >
              取消下载
            </button>
          )}
          {['idle', 'checking', 'current', 'available', 'error'].includes(update.status) &&
            update.retry !== 'install' && (
              <button
                className="secondary-button"
                data-update-check
                disabled={update.status === 'checking'}
                onClick={check}
              >
                <RefreshCw size={14} />
                {update.status === 'checking' ? '正在检查' : '检查更新'}
              </button>
            )}
        </div>
      )}
      {(action === 'ready' || action === 'install') && (
        <p className="settings-hint">
          {chatBusy ? 'AI 回复结束后可以重启安装。' : '安装时将重启应用，请先保存尚未提交的内容。'}
        </p>
      )}
      {update.checkedAt && (
        <p className="settings-hint">
          上次检查于 {new Date(update.checkedAt).toLocaleString('zh-CN')}
        </p>
      )}
    </section>
  );
}
