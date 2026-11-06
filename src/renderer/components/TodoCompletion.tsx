import { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Todo } from '../../shared/workspace';

// 完成状态立即保存；本次查看中保留卡片的位置，直到用户主动收起或离开页面。
export function useTodoCompletion(todos: Todo[], onError: (error: unknown) => void) {
  const [recent, setRecent] = useState<Record<string, Todo>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  function forget(id: string) {
    setRecent((items) => {
      const next = { ...items };
      delete next[id];
      return next;
    });
  }
  async function toggle(todo: Todo) {
    if (inFlight.current.has(todo.id)) return;
    inFlight.current.add(todo.id);
    setBusy(new Set(inFlight.current));
    const previous = recent[todo.id];
    if (!previous && !todo.done) setRecent((items) => ({ ...items, [todo.id]: { ...todo } }));
    try {
      if (previous) {
        const { done, dueAt, notifiedAt } = previous;
        await window.dola.workspace.undoTodo(todo.id, { done, dueAt, notifiedAt });
        forget(todo.id);
      } else await window.dola.workspace.toggleTodo(todo.id);
    } catch (error) {
      if (!previous) forget(todo.id);
      onError(error);
    } finally {
      inFlight.current.delete(todo.id);
      setBusy(new Set(inFlight.current));
    }
  }
  return {
    busy,
    retained: (todo: Todo) => Boolean(recent[todo.id]),
    completed: (todo: Todo) => todo.done || Boolean(recent[todo.id] && !busy.has(todo.id)),
    dueAt: (todo: Todo) => recent[todo.id]?.dueAt ?? todo.dueAt,
    count: todos.filter((todo) => recent[todo.id] && !busy.has(todo.id)).length,
    toggle,
    forget,
    dismiss: () => setRecent({}),
  };
}

export function TodoCompletionBar({
  count,
  busy,
  onDismiss,
}: {
  count: number;
  busy: boolean;
  onDismiss: () => void;
}) {
  if (!count) return null;
  return (
    <div className="todo-completion-bar">
      <span role="status">
        <Check size={14} />
        刚刚完成 {count} 件
      </span>
      <button type="button" onClick={onDismiss} disabled={busy}>
        收起已完成
      </button>
    </div>
  );
}
