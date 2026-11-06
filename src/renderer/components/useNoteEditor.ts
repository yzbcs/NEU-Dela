import { useEffect, useRef, useState } from 'react';
import type { Note } from '../../shared/workspace';

const draftKey = 'dola-note-draft';
let activeFlush: (() => Promise<void>) | undefined;

// 聊天发送前等待笔记落盘，包含刚离开编辑页时仍在进行的保存。
export async function flushNoteEdits() {
  await activeFlush?.();
}

export function useNoteEditor(notes: Note[], onError: (error: unknown) => void) {
  const [initial] = useState(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      const cached = saved ? (JSON.parse(saved) as Note) : null;
      const original = notes.find((note) => note.id === cached?.id);
      if (cached && original) {
        const restored = { ...original, ...cached };
        const dirty =
          restored.title !== original.title ||
          restored.body !== original.body ||
          restored.category !== original.category ||
          Boolean(restored.pinned) !== Boolean(original.pinned);
        return { note: dirty ? restored : original, dirty };
      }
    } catch {
      /* 已保存的笔记仍可以正常打开。 */
    }
    return { note: notes[0] ?? null, dirty: false };
  });
  const [draft, setDraft] = useState<Note | null>(initial.note);
  const [status, setStatus] = useState(initial.dirty ? '待保存' : '已保存到本机');
  const current = useRef(draft);
  const pending = useRef<Note | null>(initial.dirty ? draft : null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<void> | undefined>(undefined);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  async function flush() {
    clearTimeout(timer.current);
    if (saving.current) return saving.current;
    if (!pending.current) return;
    setStatus('保存中');
    const task = (async () => {
      while (pending.current) {
        const snapshot = pending.current;
        await window.dola.workspace.saveNote({
          ...snapshot,
          title: snapshot.title.trim() || '未命名笔记',
        });
        if (pending.current === snapshot) pending.current = null;
        if (localStorage.getItem(draftKey) === JSON.stringify(snapshot))
          localStorage.removeItem(draftKey);
      }
      setStatus('已保存到本机');
    })();
    saving.current = task;
    try {
      await task;
    } catch (error) {
      setStatus('保存失败，草稿仍在本机');
      throw error;
    } finally {
      saving.current = undefined;
    }
  }
  function report(error: unknown) {
    errorHandler.current(error);
  }
  useEffect(() => {
    const handle = () => flush();
    activeFlush = handle;
    if (pending.current) void flush().catch(report);
    return () => {
      void flush().then(() => {
        if (activeFlush === handle) activeFlush = undefined;
      }, report);
    };
  }, []);

  function edit(changes: Partial<Note>) {
    if (!current.current) return;
    const next = { ...current.current, ...changes, updatedAt: new Date().toISOString() };
    current.current = next;
    pending.current = next;
    setDraft(next);
    localStorage.setItem(draftKey, JSON.stringify(next));
    setStatus('待保存');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(report), 700);
  }
  async function select(note: Note | null) {
    await flush();
    current.current = note ? { ...note } : null;
    setDraft(current.current);
    setStatus('已保存到本机');
  }
  return { draft, status, edit, select, flush };
}
