import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  X,
  Check,
  Trash2,
  Pencil,
  Upload,
  Download,
  FolderOpen,
  FileText,
  Search,
  StickyNote,
  Pin,
  BookOpen,
  FolderPlus,
  ListTodo,
  Bold,
  Heading2,
  List,
  Sparkles,
} from 'lucide-react';
import type { Note } from '../shared/workspace';
import { PageHeader, Modal, type PageProps } from './WorkspacePages';
import { SelectMenu } from './components/SelectMenu';
import { useNoteEditor } from './components/useNoteEditor';
import { NoteMarkdown, formatNoteSelection } from './components/NoteMarkdown';
import { LocalFilesPane } from './LocalFilesPane';
import type { AiAssistanceRequest } from '../shared/ai-assistance';
const api = () => window.dola.workspace;
function noteTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function LibraryPage({
  workspace,
  onError,
  focusNoteId,
  onAskNote,
  focusLibrary,
  focusResource,
  onAskFile,
  onAskAi,
}: PageProps & {
  focusNoteId?: string;
  onAskNote: (note: Note) => void;
  focusLibrary?: { category: string; tab: 'notes' | 'files' };
  focusResource?: { resourceId: string; path: string };
  onAskFile: (file: { resourceId: string; path: string; title: string }) => void;
  onAskAi?: (request: AiAssistanceRequest) => void;
}) {
  const [tab, setTab] = useState(() =>
    localStorage.getItem('dola-library-tab') === 'files' ? 'files' : 'notes',
  );
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [link, setLink] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [scope, setScope] = useState('all');
  const [bookEditor, setBookEditor] = useState<{ name: string; previous?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [openedResource, setOpenedResource] = useState<{ resourceId: string; path: string }>();
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const editor = useNoteEditor(workspace.notes, onError);
  const { draft, status } = editor;
  const notes = workspace.notes.map((note) => (note.id === draft?.id ? draft : note));
  const books = [
    ...new Set([
      ...workspace.notebooks,
      ...notes.map((note) => note.category).filter(Boolean),
      ...(focusLibrary?.category ? [focusLibrary.category] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const activeBook = scope.startsWith('book:') ? scope.slice(5) : '';
  const scopes = [
    { value: 'all', label: '全部笔记', count: notes.length, icon: FileText },
    {
      value: 'pinned',
      label: '已置顶',
      count: notes.filter((note) => note.pinned).length,
      icon: Pin,
    },
    {
      value: 'unfiled',
      label: '未分类',
      count: notes.filter((note) => !note.category).length,
      icon: StickyNote,
    },
    ...books.map((name) => ({
      value: 'book:' + name,
      label: name,
      count: notes.filter((note) => note.category === name).length,
      icon: BookOpen,
    })),
  ];
  const filtered = notes
    .filter(
      (note) =>
        (scope === 'all' ||
          (scope === 'pinned' && note.pinned) ||
          (scope === 'unfiled' && !note.category) ||
          (scope.startsWith('book:') && note.category === activeBook)) &&
        [note.title, note.body, note.category]
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const selected = draft && filtered.some((note) => note.id === draft.id) ? draft : null;
  useEffect(() => {
    localStorage.setItem('dola-library-tab', tab);
  }, [tab]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function newNote(template: 'memo' | 'course' | 'reading' | 'checklist' = 'memo') {
    await run(async () => {
      await editor.flush();
      const templates = {
        memo: { title: '新笔记', body: '' },
        course: {
          title: '课程笔记',
          body: '## 课堂要点\n\n\n## 我的理解\n\n\n## 课后问题\n\n- [ ] 整理需要确认的问题',
        },
        reading: {
          title: '阅读笔记',
          body: '## 阅读材料\n\n\n## 主要观点\n\n\n## 我的思考\n\n\n## 接下来\n\n- [ ] 记录值得继续阅读的内容',
        },
        checklist: { title: '随手清单', body: '- [ ] 写下第一件事\n- [ ] 写下下一件事' },
      };
      const input = { ...templates[template], category: activeBook, pinned: scope === 'pinned' };
      const id = await api().saveNote(input);
      await editor.select({ ...input, id, updatedAt: new Date().toISOString() });
      setTab('notes');
      setSearch('');
      setPreview(template === 'checklist');
    });
  }
  async function selectNote(note: Note) {
    if (note.id === draft?.id) return;
    await run(() => editor.select(note));
  }
  function format(style: 'bold' | 'heading' | 'list' | 'checklist') {
    if (!draft || !bodyInput.current) return;
    const { selectionStart, selectionEnd } = bodyInput.current;
    const result = formatNoteSelection(draft.body, selectionStart, selectionEnd, style);
    editor.edit({ body: result.body });
    requestAnimationFrame(() => {
      bodyInput.current?.focus();
      bodyInput.current?.setSelectionRange(result.start, result.end);
    });
  }
  useEffect(() => {
    const note = workspace.notes.find((item) => item.id === focusNoteId);
    if (note) {
      setTab('notes');
      setScope('all');
      setSearch('');
      void selectNote(note);
    }
  }, [focusNoteId]);
  useEffect(() => {
    if (!focusLibrary) return;
    setTab(focusLibrary.tab);
    setScope('book:' + focusLibrary.category);
    setCategory(focusLibrary.category);
    setSearch('');
  }, [focusLibrary]);
  useEffect(() => {
    if (!focusResource) return;
    setOpenedResource(undefined);
    setTab('files');
    setCategory('');
    setSearch('');
  }, [focusResource]);
  async function addResources(kind: 'folder' | 'file') {
    await run(async () => {
      await editor.flush();
      const previous = new Set(workspace.resources.map((resource) => resource.id));
      await api().addResources(kind, category);
      const next = await window.dola.load();
      const added = next.workspace.resources.find((resource) => !previous.has(resource.id));
      if (added) setOpenedResource({ resourceId: added.id, path: '' });
      setTab('files');
    });
  }
  return (
    <section className={'work-page library-page' + (tab === 'files' ? ' local-library-page' : '')}>
      <PageHeader
        eyebrow="A PLACE FOR YOUR IDEAS"
        title="资料与笔记"
        subtitle="阅读本地资料，记录想法，把学习中的内容连在一起。"
      >
        <button className="secondary-button" onClick={() => void addResources('folder')}>
          <FolderOpen size={15} />
          添加文件夹
        </button>
        <button className="secondary-button" onClick={() => void addResources('file')}>
          <Upload size={15} />
          添加文件
        </button>
        <button className="primary-button" disabled={busy} onClick={() => void newNote()}>
          <Plus size={15} />
          新笔记
        </button>
        {onAskAi && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await editor.flush();
                onAskAi({
                  target: 'notes',
                  operation: 'import',
                  source: '笔记导入',
                  category: activeBook,
                });
              })
            }
          >
            <Sparkles size={15} />
            AI 导入笔记
          </button>
        )}
      </PageHeader>
      <div className="library-toolbar">
        <div className="segment-tabs">
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>
            备忘录 {workspace.notes.length}
          </button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
            本地资料 {workspace.resources.length}
          </button>
        </div>
        <label className="work-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'notes' ? '搜索笔记标题、内容或分类' : '筛选资料名称、路径或分类'}
          />
        </label>
        {tab === 'files' && (
          <div className="category-filter">
            <input
              aria-label="资料分类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="全部分类 / 新分类"
            />
          </div>
        )}
      </div>
      {tab === 'notes' ? (
        <>
          <div className="notebook-mobile">
            <SelectMenu
              name="notebook-filter"
              label="选择笔记本"
              value={scope}
              onChange={setScope}
              options={scopes.map((item) => ({
                value: item.value,
                label: item.label + ' · ' + item.count,
              }))}
            />
            <button
              className="icon-button"
              aria-label="新建笔记本"
              onClick={() => setBookEditor({ name: '' })}
            >
              <FolderPlus size={17} />
            </button>
          </div>
          <div className="notes-layout">
            <aside className="notebook-sidebar" aria-label="笔记本">
              <span className="notes-section-label">我的笔记本</span>
              {scopes.map(({ value, label, count, icon: Icon }) => (
                <button
                  key={value}
                  className={'notebook-item' + (scope === value ? ' active' : '')}
                  aria-label={label + '笔记本'}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  <small>{count}</small>
                </button>
              ))}
              <button
                className="text-button new-notebook"
                onClick={() => setBookEditor({ name: '' })}
              >
                <FolderPlus size={15} />
                新建笔记本
              </button>
            </aside>
            <aside className="notes-list" aria-label="笔记列表">
              <div className="notes-list-header">
                <strong>{scopes.find((item) => item.value === scope)?.label || '笔记'}</strong>
                <small>{filtered.length} 篇</small>
                {activeBook && (
                  <>
                    <button
                      className="icon-button"
                      aria-label="重命名笔记本"
                      onClick={() => setBookEditor({ name: activeBook, previous: activeBook })}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="移除笔记本"
                      onClick={() => {
                        if (!confirm('移除这个笔记本？其中的笔记会保留在“未分类”中。')) return;
                        void run(async () => {
                          await editor.flush();
                          await api().removeNotebook(activeBook);
                          if (draft?.category === activeBook)
                            await editor.select({ ...draft, category: '' });
                          setScope('unfiled');
                        });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
              {filtered.map((note, index) => (
                <div key={note.id}>
                  {(index === 0 ||
                    Boolean(filtered[index - 1].pinned) !== Boolean(note.pinned)) && (
                    <span className="notes-section-label">{note.pinned ? '置顶' : '最近编辑'}</span>
                  )}
                  <button
                    className={'note-list-item' + (draft?.id === note.id ? ' active' : '')}
                    data-note-id={note.id}
                    aria-label={'打开笔记 ' + note.title}
                    disabled={busy}
                    onClick={() => void selectNote(note)}
                  >
                    <span>
                      <strong>
                        {note.pinned && <Pin size={12} />}
                        {note.title || '未命名笔记'}
                      </strong>
                      <small>
                        {noteTime(note.updatedAt)} · {note.category || '未分类'}
                      </small>
                      <span className="note-excerpt">
                        {note.body
                          .replace(/^[#>*\s-]+/gm, '')
                          .replace(/\[[ xX]\]/g, '')
                          .trim() || '还没有正文'}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
              {!filtered.length && (
                <p className="notes-empty-list">
                  {search
                    ? '没有找到匹配的笔记。可以换个关键词，或选择“全部笔记”。'
                    : '还没有笔记，先记下一点想法。'}
                </p>
              )}
            </aside>
            <div className="note-editor">
              {selected ? (
                <>
                  <div className="note-editor-toolbar">
                    <span role="status">{status}</span>
                    {status.startsWith('保存失败') && (
                      <button className="text-button" onClick={() => void run(editor.flush)}>
                        重试
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={draft!.pinned ? '取消置顶' : '置顶笔记'}
                      aria-pressed={Boolean(draft!.pinned)}
                      disabled={busy}
                      onClick={() => editor.edit({ pinned: !draft!.pinned })}
                    >
                      <Pin size={15} />
                    </button>
                    <button className="text-button" onClick={() => setPreview(!preview)}>
                      {preview ? '继续编辑' : '阅读模式'}
                    </button>
                    <button
                      className="icon-button"
                      title="导出 Markdown"
                      aria-label="导出笔记"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await editor.flush();
                          await api().exportNote(draft!.id);
                        })
                      }
                    >
                      <Download size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="删除笔记"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('删除这篇笔记？请先导出需要保留的内容。')) return;
                        void run(async () => {
                          await editor.flush();
                          await api().removeNote(draft!.id);
                          await editor.select(null);
                        });
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    name="noteTitle"
                    className="note-title"
                    aria-label="笔记标题"
                    value={draft!.title}
                    maxLength={300}
                    disabled={busy}
                    onChange={(event) => editor.edit({ title: event.target.value })}
                    placeholder="笔记标题"
                  />
                  <div className="note-metadata">
                    <BookOpen size={13} />
                    <SelectMenu
                      name="note-notebook"
                      label="所在笔记本"
                      value={draft!.category}
                      disabled={busy}
                      onChange={(value) => editor.edit({ category: value })}
                      options={[
                        { value: '', label: '未分类' },
                        ...books.map((name) => ({ value: name, label: name })),
                      ]}
                    />
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await editor.flush();
                          onAskNote(draft!);
                        })
                      }
                    >
                      <Sparkles size={13} />
                      问问 AI
                    </button>
                  </div>
                  {!preview && (
                    <div className="note-format-toolbar" aria-label="笔记格式">
                      <button
                        title="加粗"
                        aria-label="加粗"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => format('bold')}
                      >
                        <Bold size={15} />
                      </button>
                      <button
                        title="小标题"
                        aria-label="插入小标题"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => format('heading')}
                      >
                        <Heading2 size={17} />
                      </button>
                      <button
                        title="项目列表"
                        aria-label="插入项目列表"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => format('list')}
                      >
                        <List size={17} />
                      </button>
                      <button
                        title="核对清单"
                        aria-label="插入核对清单"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => format('checklist')}
                      >
                        <ListTodo size={17} />
                        <span>清单</span>
                      </button>
                      <small>阅读模式中可直接勾选清单</small>
                    </div>
                  )}
                  {preview ? (
                    <div className="markdown note-preview">
                      <NoteMarkdown body={draft!.body} onChange={(body) => editor.edit({ body })} />
                    </div>
                  ) : (
                    <textarea
                      ref={bodyInput}
                      name="noteBody"
                      className="note-body"
                      value={draft!.body}
                      disabled={busy}
                      onChange={(event) => editor.edit({ body: event.target.value })}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                          event.preventDefault();
                          void run(editor.flush);
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
                          event.preventDefault();
                          format('bold');
                        }
                      }}
                      placeholder="写下一点想法、课堂要点或阅读收获。可以用上方工具整理标题和清单。"
                    />
                  )}
                  <div className="note-editor-footer">
                    <span>{draft!.body.length} 字符</span>
                    <span>自动保存 · 问问 AI 会先保存最新内容</span>
                  </div>
                </>
              ) : (
                <div className="work-empty memo-empty">
                  <StickyNote size={32} />
                  <h3>{filtered.length ? '选择一篇笔记继续' : '把想法留在这里'}</h3>
                  <p>随手记一段话，也可以从一个简单的结构开始。</p>
                  <div className="note-templates">
                    <button disabled={busy} onClick={() => void newNote()}>
                      <StickyNote size={19} />
                      <strong>随手备忘</strong>
                      <small>记下灵感与日常</small>
                    </button>
                    <button disabled={busy} onClick={() => void newNote('checklist')}>
                      <ListTodo size={19} />
                      <strong>核对清单</strong>
                      <small>准备材料与步骤</small>
                    </button>
                    <button disabled={busy} onClick={() => void newNote('course')}>
                      <BookOpen size={19} />
                      <strong>课程笔记</strong>
                      <small>要点、理解与问题</small>
                    </button>
                    <button disabled={busy} onClick={() => void newNote('reading')}>
                      <FileText size={19} />
                      <strong>阅读笔记</strong>
                      <small>观点、思考与后续</small>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="work-actions">
            <button className="text-button" onClick={() => setLink(true)}>
              <Plus size={14} />
              添加资料链接
            </button>
            <span className="muted">文件和文件夹保留在原位置。</span>
          </div>
          <LocalFilesPane
            resources={workspace.resources}
            category={category}
            search={search}
            onError={onError}
            onAskFile={onAskFile}
            focusResource={openedResource ?? focusResource}
          />
        </>
      )}
      {bookEditor && (
        <Modal
          title={bookEditor.previous ? '重命名笔记本' : '新建笔记本'}
          onClose={() => setBookEditor(null)}
        >
          <form
            className="work-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await editor.flush();
                const name = bookEditor.name.trim();
                await api().saveNotebook(name, bookEditor.previous);
                if (bookEditor.previous && draft?.category === bookEditor.previous)
                  await editor.select({ ...draft, category: name });
                setScope('book:' + name);
                setSearch('');
                setBookEditor(null);
              });
            }}
          >
            <label>
              名称
              <input
                name="notebookName"
                required
                maxLength={100}
                value={bookEditor.name}
                onChange={(event) => setBookEditor({ ...bookEditor, name: event.target.value })}
                placeholder="例如：课程学习、论文阅读、随手记"
              />
            </label>
            <button className="primary-button" disabled={busy}>
              保存笔记本
            </button>
          </form>
        </Modal>
      )}
      {link && (
        <Modal title="添加资料链接" onClose={() => setLink(false)}>
          <form
            className="work-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api().addLink(linkTitle, linkUrl, category);
                setLink(false);
                setLinkTitle('');
                setLinkUrl('');
              } catch (error) {
                onError(error);
              }
            }}
          >
            <label>
              名称
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="例如：论文仓库"
              />
            </label>
            <label>
              网址
              <input
                type="url"
                required
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://"
              />
            </label>
            <button className="primary-button">保存链接</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
