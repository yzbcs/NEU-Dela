import { useState } from 'react';
import { CalendarDays, Check, FileText, Pencil, StickyNote, Undo2 } from 'lucide-react';
import type { WorkspaceCreation } from '../../shared/types';
import { dayNames } from '../../shared/workspace';
import '../workspace-creations.css';

const repeatNames = { none: '不重复', daily: '每天', weekdays: '每个工作日', weekly: '每周' };
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );

export function WorkspaceCreationCard({
  creation,
  onOpen,
  onUndo,
}: {
  creation: WorkspaceCreation;
  onOpen: () => void;
  onUndo: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const undone = creation.status === 'undone';
  const title = creation.kind === 'course' ? creation.record.name : creation.record.title;
  const Icon =
    creation.kind === 'todo' ? StickyNote : creation.kind === 'course' ? CalendarDays : FileText;
  const label = creation.kind === 'todo' ? '便利贴' : creation.kind === 'course' ? '课程' : '笔记';
  return (
    <section
      className={'workspace-creation creation-card' + (undone ? ' undone' : '')}
      data-creation-id={creation.id}
      data-record-id={creation.record.id}
      data-kind={creation.kind}
      data-creation-status={creation.status}
      aria-label={`${undone ? '已撤销' : '已保存'}${label} ${title}`}
    >
      <header>
        <Icon size={17} />
        <span>{label}</span>
        <small>
          {undone ? <Undo2 size={12} /> : <Check size={12} />}
          {undone ? '已撤销' : '已保存到工作台'}
        </small>
      </header>
      <strong className="workspace-creation-title">{title}</strong>
      {creation.detail && <p className="workspace-creation-detail">{creation.detail}</p>}
      <div className="workspace-creation-fields">
        {creation.kind === 'todo' ? (
          <>
            <p>
              {creation.record.dueAt
                ? new Date(creation.record.dueAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23',
                  }) + '（北京时间）'
                : '未设时间'}
            </p>
            <p>
              {repeatNames[creation.record.repeat]} ·{' '}
              {creation.record.reminder ? '到时提醒' : '未开启提醒'} ·{' '}
              {creation.record.done ? '已完成' : '待完成'}
            </p>
            {creation.record.detail && <pre>{creation.record.detail}</pre>}
          </>
        ) : creation.kind === 'course' ? (
          <>
            <p>
              {dayNames[creation.record.day - 1]} · 第 {creation.record.start}—{creation.record.end}{' '}
              节 · 周次 {creation.record.weeks}
            </p>
            <p>
              地点：{creation.record.location || '待补充'} · 教师：
              {creation.record.teacher || '待补充'}
            </p>
            {creation.record.detail && <pre>{creation.record.detail}</pre>}
          </>
        ) : (
          <>
            <p>笔记本：{creation.record.category || '未分类'}</p>
            {creation.record.body && <pre>{creation.record.body}</pre>}
          </>
        )}
      </div>
      <div className="workspace-creation-actions">
        <button
          type="button"
          aria-label={'查看记录 ' + title}
          disabled={undone || busy}
          onClick={() => {
            setError('');
            try {
              onOpen();
            } catch (failure) {
              setError(messageOf(failure));
            }
          }}
        >
          <Pencil size={13} />
          查看并编辑
        </button>
        <button
          type="button"
          aria-label={'撤销新增 ' + title}
          disabled={undone || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onUndo();
            } catch (failure) {
              setError(messageOf(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Undo2 size={13} />
          {busy ? '正在撤销' : undone ? '已撤销' : '撤销创建'}
        </button>
      </div>
      {error && (
        <p className="workspace-creation-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
