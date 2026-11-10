import type { Chat, ChatMessage } from './types';

export const chatTitleVersion = 1;
const titleLimit = 14;
const stopWords = new Set(
  '请 请问 帮我 帮忙 可以 能否 如何 怎么 什么 为什么 一个 一下 这个 那个 这些 那些 这里 现在 需要 希望 想要 进行 关于 相关 内容 问题 详细 介绍 解释 说明 分析 总结 完成 继续 阅读 引用 文件 整理 以及 然后 时候 里面 其中 我的 我们 你的 你们 是否 能够 应该 这样 怎么样 你好 您好 谢谢 the a an to of for and is are please help explain pdf'.split(
    ' ',
  ),
);

export function summarizeChatTitle(messages: ChatMessage[]): string {
  const users = messages.filter((message) => message.role === 'user');
  const text = users.map((message) => message.text).join('\n');
  const files = users.flatMap((message) => message.attachments?.map((file) => file.name) ?? []);
  const subject = [text, ...files].join('\n');
  if (users.length === 1 && /你.*(?:能.*做什么|有什么功能)|功能介绍/.test(text))
    return '助手功能介绍';
  if (/供应商|服务商|切换模型|模型配置|模型选择/.test(subject)) return '模型选择与切换';
  if (/课表|课程安排/.test(subject))
    return /导入|覆盖|替换|识别/.test(text) ||
      messages.some((message) => message.timetableDrafts?.length)
      ? '课表导入与核对'
      : '课表查询与解读';
  if (/笔记|备忘录/.test(subject)) return /导入/.test(text) ? '笔记导入与整理' : '笔记整理与保存';
  if (/便利贴|便利签|待办|提醒/.test(subject))
    return /提醒/.test(text) ? '待办整理与提醒' : '待办事项整理';
  if (/(?:学习|课程|任务).*(?:计划|安排)|(?:计划|安排).*(?:学习|课程|任务)/.test(text))
    return '学习日程规划';
  if (/^(?:你好|您好|hi|hello)[！!。,.\s]*$/i.test(text.trim())) return '日常交流';

  const words = new Map<string, { word: string; count: number; order: number }>();
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  for (const part of segmenter.segment(text)) {
    const key = part.segment.toLowerCase();
    if (!part.isWordLike || !/\p{L}/u.test(key) || stopWords.has(key) || [...key].length < 2)
      continue;
    const previous = words.get(key);
    if (previous) previous.count++;
    else words.set(key, { word: part.segment, count: 1, order: words.size });
  }
  const ranked = [...words.values()].sort((a, b) => b.count - a.count || a.order - b.order);
  const selected: string[] = [];
  for (const item of ranked) {
    if ([...[...selected, item.word].join(' · ')].length > titleLimit) continue;
    selected.push(item.word);
    if (selected.length === 2) break;
  }
  return selected.join(' · ') || (files.length ? '文件内容解读' : '学习问题讨论');
}

export function hasLegacyAutomaticTitle(chat: Chat): boolean {
  const first = chat.messages.find((message) => message.role === 'user')?.text ?? '';
  const firstLine =
    first
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? '';
  return [
    '新对话',
    [...first].slice(0, 28).join(''),
    [...firstLine].slice(0, 28).join(''),
  ].includes(chat.title);
}
