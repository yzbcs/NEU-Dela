import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  FileText,
  FolderOpen,
  MessageSquare,
  Search,
  StickyNote,
} from 'lucide-react';
import type { AppState } from '../../shared/types';
import { searchWorkspace, type SearchKind, type WorkspaceSearchResult } from '../../shared/search';
import { Modal } from '../WorkspacePages';
import '../search.css';

const kinds = {
  note: { label: '笔记', Icon: FileText },
  todo: { label: '待办', Icon: StickyNote },
  course: { label: '课程', Icon: CalendarDays },
  resource: { label: '资料', Icon: FolderOpen },
  chat: { label: '对话', Icon: MessageSquare },
};

export function WorkspaceSearch({
  state,
  onClose,
  onOpen,
}: {
  state: AppState;
  onClose: () => void;
  onOpen: (result: WorkspaceSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKind | 'all'>('all');
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(20);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => searchWorkspace(state.workspace, state.chats, query),
    [state.workspace, state.chats, query],
  );
  const filtered = kind === 'all' ? results : results.filter((item) => item.kind === kind);
  const visible = filtered.slice(0, limit);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
    setLimit(20);
  }, [query, kind]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <Modal title="搜索工作台" onClose={onClose}>
      <div className="workspace-search">
        <label className="workspace-search-input">
          <Search size={18} />
          <input
            ref={input}
            value={query}
            placeholder="搜索笔记正文、待办、课程、资料和对话"
            aria-label="搜索工作台内容"
            role="combobox"
            aria-expanded={Boolean(query.trim())}
            aria-controls="workspace-search-results"
            aria-activedescendant={visible[active] ? `workspace-result-${active}` : undefined}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (visible.length)
                  setActive(
                    (index) =>
                      (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) %
                      visible.length,
                  );
              } else if (event.key === 'Enter' && visible[active]) {
                event.preventDefault();
                onOpen(visible[active]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <p className="workspace-search-scope">
          搜索保存在本机的内容及资料名称、路径。文件正文与邮箱请进入对应页面查看。
        </p>
        {query.trim() ? (
          <>
            <div className="workspace-search-filters" aria-label="搜索类型">
              <button className={kind === 'all' ? 'active' : ''} onClick={() => setKind('all')}>
                全部 {results.length}
              </button>
              {(Object.entries(kinds) as [SearchKind, typeof kinds.note][]).map(
                ([value, { label }]) => (
                  <button
                    key={value}
                    className={kind === value ? 'active' : ''}
                    onClick={() => setKind(value)}
                  >
                    {label} {results.filter((item) => item.kind === value).length}
                  </button>
                ),
              )}
            </div>
            <div
              ref={list}
              className="workspace-search-results"
              id="workspace-search-results"
              role="listbox"
              aria-label="搜索结果"
            >
              {visible.map((result, index) => {
                const { label, Icon } = kinds[result.kind];
                return (
                  <button
                    key={`${result.kind}:${result.id}`}
                    id={`workspace-result-${index}`}
                    className="workspace-search-result"
                    data-search-kind={result.kind}
                    data-search-id={result.id}
                    role="option"
                    aria-selected={active === index}
                    onFocus={() => setActive(index)}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onOpen(result)}
                  >
                    <Icon size={17} />
                    <span className="workspace-search-result-text">
                      <span className="workspace-search-result-title">
                        <strong>{result.title}</strong>
                        <small>{label}</small>
                      </span>
                      <span className="workspace-search-result-detail">{result.detail}</span>
                      {result.preview && (
                        <span className="workspace-search-preview">
                          <small>命中内容</small>
                          {result.preview}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              {!filtered.length && (
                <div className="workspace-search-empty">
                  <Search size={25} />
                  <strong>没有找到匹配内容</strong>
                  <p>试试课程名、老师姓名、待办描述或笔记正文中的词。</p>
                </div>
              )}
            </div>
            {filtered.length > visible.length && (
              <button
                className="text-button workspace-search-more"
                onClick={() => setLimit((value) => value + 20)}
              >
                显示更多 · 已显示 {visible.length} / 共 {filtered.length} 条
              </button>
            )}
            <div className="workspace-search-footer">
              <span>共 {filtered.length} 条结果</span>
              <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
            </div>
          </>
        ) : (
          <div className="workspace-search-empty">
            <Search size={29} />
            <strong>从一个关键词开始</strong>
            <p>不用记得放在哪一页，输入内容就能找到。多个词用空格分开，可缩小范围。</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
