import { expect, it } from 'vitest';
import { emptyWorkspace } from '../src/shared/workspace';
import { searchWorkspace } from '../src/shared/search';
import type { Chat } from '../src/shared/types';

function fixture() {
  const workspace = emptyWorkspace();
  workspace.notes = [
    {
      id: 'body-note',
      title: '实验记录',
      category: '机器学习',
      body: '本次实验\n检验 Transformer Attention 的变化。',
      updatedAt: '2026-11-06T00:00:00Z',
    },
    {
      id: 'title-note',
      title: 'Attention',
      category: '阅读',
      body: '论文笔记',
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ];
  workspace.todos = [
    {
      id: 'todo',
      title: '提交报告',
      detail: '补充 attention 对照实验',
      color: 'blue',
      dueAt: '',
      reminder: false,
      repeat: 'none',
      done: true,
      notifiedAt: '',
      createdAt: '2026-11-05T00:00:00Z',
    },
  ];
  workspace.timetable.courses = [
    {
      id: 'course',
      name: '机器学习',
      teacher: '李老师',
      location: '浑南 A101',
      detail: '带上实验报告',
      day: 2,
      start: 3,
      end: 4,
      weeks: '1-16单周',
    },
  ];
  workspace.resources = [
    {
      id: 'resource',
      title: '讲义',
      kind: 'file',
      path: '/课程/Attention.pdf',
      category: '机器学习',
      addedAt: '2026-11-05T00:00:00Z',
    },
  ];
  return workspace;
}
it('匹配笔记正文、已完成待办和资料路径，标题精确匹配排在较新的正文命中之前', () => {
  const results = searchWorkspace(fixture(), [], 'aTTenTion');
  expect(results.map((item) => item.id)).toEqual(['title-note', 'resource', 'body-note', 'todo']);
  expect(results.find((item) => item.id === 'body-note')?.preview).toBe(
    '检验 Transformer Attention 的变化。',
  );
  expect(results.find((item) => item.id === 'todo')?.detail).toBe('已完成');
});
it('多个词按 AND 搜索并忽略首尾和重复空白，支持跨标题、笔记本、正文匹配', () => {
  expect(
    searchWorkspace(fixture(), [], '  机器学习 \n Transformer  ').map((item) => item.id),
  ).toEqual(['body-note']);
  expect(searchWorkspace(fixture(), [], 'attention 不存在')).toEqual([]);
  expect(searchWorkspace(fixture(), [], ' \n\t ')).toEqual([]);
});
it('课程可按老师、地点和说明查找，保留对应课程 ID', () => {
  const [result] = searchWorkspace(fixture(), [], '李老师 A101 报告');
  expect(result).toMatchObject({
    kind: 'course',
    id: 'course',
    title: '机器学习',
    preview: '带上实验报告',
  });
  expect(result.detail).toContain('1-16单周');
});
it('对话正文可查找并记录实际命中的消息，便于打开后定位', () => {
  const chat: Chat = {
    id: 'chat',
    title: '课程复习',
    providerId: null,
    model: '',
    updatedAt: '2026-11-06T00:00:00Z',
    messages: [
      { id: 'm1', role: 'user', text: '帮我整理复习计划', state: 'complete', createdAt: '' },
      {
        id: 'm2',
        role: 'assistant',
        text: '先复习 Attention，再整理实验。',
        state: 'complete',
        createdAt: '',
      },
    ],
  };
  const result = searchWorkspace(emptyWorkspace(), [chat], 'Attention');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    kind: 'chat',
    id: 'chat',
    messageId: 'm2',
    preview: '先复习 Attention，再整理实验。',
  });
});
it('所有命中都返回给分页界面，不静默丢掉第 21 条或修改原始工作台', () => {
  const workspace = emptyWorkspace();
  workspace.notes = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    title: `课程 ${index}`,
    category: '',
    body: '',
    updatedAt: '',
  }));
  const before = structuredClone(workspace);
  expect(searchWorkspace(workspace, [], '课程')).toHaveLength(25);
  expect(workspace).toEqual(before);
});
