import { useState } from 'react';
import { Paperclip, Search, Trash2, X } from 'lucide-react';
import type { Chat, Provider } from '../../shared/types';
import { chinaDate, dateNumber } from '../../shared/workspace';
import './chat-history.css';

export function ChatHistory({
  chats,
  providers,
  activeId,
  onOpen,
  onRemove,
}: {
  chats: Chat[];
  providers: Provider[];
  activeId: string | null;
  onOpen: (chat: Chat) => void;
  onRemove: (chat: Chat) => void;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const today = dateNumber(chinaDate());
  const groups = new Map<string, Chat[]>([
    ['今天', []],
    ['昨天', []],
    ['近七天', []],
    ['更早', []],
  ]);
  const matches = chats.filter(
    (chat) =>
      !search ||
      chat.title.toLowerCase().includes(search) ||
      chat.messages.some(
        (message) =>
          message.text.toLowerCase().includes(search) ||
          message.attachments?.some((file) => file.name.toLowerCase().includes(search)),
      ),
  );
  for (const chat of [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const updated = new Date(chat.updatedAt);
    const age = Number.isNaN(updated.getTime())
      ? Infinity
      : (today - dateNumber(chinaDate(updated))) / 86400000;
    const group = age <= 0 ? '今天' : age === 1 ? '昨天' : age < 7 ? '近七天' : '更早';
    groups.get(group)!.push(chat);
  }
  return (
    <section className="chat-history-panel" aria-label="对话记录">
      <div className="chat-history-heading">
        <strong>对话记录</strong>
        <span>{chats.length}</span>
      </div>
      <label className="chat-history-search">
        <Search size={13} />
        <input
          aria-label="搜索对话记录"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索对话或引用文件"
        />
        {query && (
          <button type="button" aria-label="清除对话搜索" onClick={() => setQuery('')}>
            <X size={12} />
          </button>
        )}
      </label>
      <div className="chat-history-list">
        {[...groups].map(
          ([label, items]) =>
            items.length > 0 && (
              <div className="chat-history-group" key={label}>
                <h2>{label}</h2>
                {items.map((chat) => {
                  const provider = providers.find((item) => item.id === chat.providerId);
                  const files = chat.messages.reduce(
                    (total, message) => total + (message.attachments?.length ?? 0),
                    0,
                  );
                  return (
                    <div
                      className={'chat-history-item' + (chat.id === activeId ? ' current' : '')}
                      key={chat.id}
                      data-chat-id={chat.id}
                    >
                      <button
                        type="button"
                        className="chat-history-open"
                        aria-label={'打开对话 ' + chat.title}
                        aria-current={chat.id === activeId ? 'page' : undefined}
                        onClick={() => onOpen(chat)}
                      >
                        <strong>{chat.title}</strong>
                        <span>
                          {provider?.name || '待选择服务商'}
                          <span>
                            {' '}
                            ·{' '}
                            {
                              chat.messages.filter((message) => message.state !== 'streaming')
                                .length
                            }{' '}
                            条消息
                          </span>
                          {files > 0 && (
                            <span className="chat-history-files">
                              <Paperclip size={10} />
                              {files}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="chat-history-delete"
                        aria-label={'删除对话 ' + chat.title}
                        onClick={() => onRemove(chat)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ),
        )}
        {!matches.length && (
          <p className="chat-history-empty">
            {search ? '没有找到匹配对话' : '开始一段对话，记录会保存在这里。'}
          </p>
        )}
      </div>
    </section>
  );
}
