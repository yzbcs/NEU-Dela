import type { Chat } from './types';
import { dayNames, type Workspace } from './workspace';

export type SearchKind = 'note' | 'todo' | 'course' | 'resource' | 'chat';
export interface WorkspaceSearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  preview: string;
  messageId?: string;
}

const normalized = (value: string) => value.trim().toLocaleLowerCase();

/** Search saved local content; linked file bodies and remote mail are not fetched. */
export function searchWorkspace(
  workspace: Workspace,
  chats: Chat[],
  query: string,
): WorkspaceSearchResult[] {
  const phrase = normalized(query).replace(/\s+/g, ' ');
  if (!phrase) return [];
  const words = phrase.split(' ');
  const results: (WorkspaceSearchResult & { rank: number; date: string })[] = [];
  function add(
    result: Omit<WorkspaceSearchResult, 'preview'>,
    metadata: string[],
    bodies: string[],
    date = '',
  ) {
    const title = normalized(result.title);
    const meta = normalized(metadata.join(' '));
    const text = normalized([title, meta, ...bodies].join(' '));
    if (!words.every((word) => text.includes(word))) return;
    const preview =
      bodies
        .flatMap((body) => body.split('\n'))
        .find((line) => words.some((word) => normalized(line).includes(word))) ?? '';
    const rank =
      title === phrase
        ? 0
        : title.startsWith(phrase)
          ? 1
          : words.every((word) => title.includes(word))
            ? 2
            : words.every((word) => `${title} ${meta}`.includes(word))
              ? 3
              : 4;
    results.push({ ...result, preview, rank, date });
  }
  for (const note of workspace.notes)
    add(
      { kind: 'note', id: note.id, title: note.title, detail: note.category || '未分类笔记' },
      [note.category],
      [note.body],
      note.updatedAt,
    );
  for (const todo of workspace.todos)
    add(
      { kind: 'todo', id: todo.id, title: todo.title, detail: todo.done ? '已完成' : '待完成' },
      [],
      [todo.detail],
      todo.createdAt,
    );
  for (const course of workspace.timetable.courses)
    add(
      {
        kind: 'course',
        id: course.id,
        title: course.name,
        detail: `${dayNames[course.day - 1]} · ${course.start}—${course.end} 节 · ${course.weeks} · ${course.location || '地点待补充'} · ${course.teacher || '教师待补充'}`,
      },
      [course.location, course.teacher, course.weeks],
      [course.detail],
    );
  for (const resource of workspace.resources)
    add(
      {
        kind: 'resource',
        id: resource.id,
        title: resource.title,
        detail: resource.category || '未分类资料',
      },
      [resource.path, resource.category],
      [resource.path],
      resource.addedAt,
    );
  for (const chat of chats) {
    const message = chat.messages.find((item) =>
      words.some((word) => normalized(item.text).includes(word)),
    );
    add(
      {
        kind: 'chat',
        id: chat.id,
        title: chat.title,
        detail: `对话 · ${chat.messages.length} 条消息`,
        messageId: message?.id,
      },
      [],
      chat.messages.map((item) => item.text),
      chat.updatedAt,
    );
  }
  return results
    .sort(
      (a, b) =>
        a.rank - b.rank || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'),
    )
    .map(({ rank: _rank, date: _date, ...result }) => result);
}
