import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  List,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { LocalDirectory, LocalFilePreview, Resource } from '../shared/workspace';
import './local-files.css';

const api = () => window.dola.workspace;
const storageKey = 'dola-local-files-view';
type Selection = { resourceId: string; path: string; kind: 'folder' | 'file'; anchor?: string };
type DirectoryState = { data?: LocalDirectory; loading?: boolean; error?: string };
type Heading = { id: string; text: string; level: number };
type SavedView = { selected?: Selection; expanded?: string[] };
const directoryKey = (id: string, path: string) => JSON.stringify([id, path]);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const slug = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-');

function savedView(): SavedView {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      selected:
        value.selected &&
        typeof value.selected.resourceId === 'string' &&
        typeof value.selected.path === 'string' &&
        ['file', 'folder'].includes(value.selected.kind)
          ? value.selected
          : undefined,
      expanded: Array.isArray(value.expanded)
        ? value.expanded.filter((key: unknown) => typeof key === 'string')
        : [],
    };
  } catch {
    return {};
  }
}

function LocalImage({
  resourceId,
  path,
  source,
  alt,
  revision,
}: {
  resourceId: string;
  path: string;
  source: string;
  alt: string;
  revision: number;
}) {
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const remote = /^https?:\/\//i.test(source);
  useEffect(() => {
    let current = true;
    setImage('');
    setError('');
    if (!remote && source) {
      api()
        .readResourceImage(resourceId, path, source)
        .then((value) => {
          if (current) setImage(value);
        })
        .catch((reason) => {
          if (current) setError(message(reason));
        });
    }
    return () => {
      current = false;
    };
  }, [resourceId, path, source, revision, remote]);
  if (remote)
    return (
      <a
        href={source}
        onClick={(event) => {
          event.preventDefault();
          void api()
            .openWebsite(source)
            .catch((reason) => setError(message(reason)));
        }}
      >
        {alt || '远程图片'}（在浏览器中查看）
        {error && <span className="local-image-error">{error}</span>}
      </a>
    );
  if (error)
    return (
      <span className="local-image-error">
        {alt || '图片'}：{error}
      </span>
    );
  return image ? (
    <img src={image} alt={alt} />
  ) : (
    <span className="local-image-loading">正在读取{alt || '图片'}</span>
  );
}

export function LocalFilesPane({
  resources,
  category,
  search,
  onError,
  onAskFile,
  focusResource,
}: {
  resources: Resource[];
  category: string;
  search: string;
  onError: (error: unknown) => void;
  onAskFile: (file: { resourceId: string; path: string; title: string }) => void;
  focusResource?: { resourceId: string; path: string };
}) {
  const [initial] = useState(savedView);
  const [selected, setSelected] = useState<Selection | undefined>(() => {
    if (focusResource)
      return {
        ...focusResource,
        kind:
          !focusResource.path &&
          resources.find((item) => item.id === focusResource.resourceId)?.kind === 'folder'
            ? 'folder'
            : 'file',
      };
    return !category ||
      resources.find((item) => item.id === initial.selected?.resourceId)?.category === category
      ? initial.selected
      : undefined;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.expanded));
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [file, setFile] = useState<LocalFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [revision, setRevision] = useState(0);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [find, setFind] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const loadingDirectories = useRef(new Set<string>());
  const directoryGeneration = useRef(0);
  const resource = resources.find((item) => item.id === selected?.resourceId);
  const roots = resources.filter(
    (item) =>
      (!category || item.category === category) &&
      [item.title, item.path, item.category]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const selectedDirectory =
    selected?.kind === 'folder'
      ? directories[directoryKey(selected.resourceId, selected.path)]
      : undefined;

  async function loadDirectory(resourceId: string, path: string, offset = 0) {
    const key = directoryKey(resourceId, path);
    if (loadingDirectories.current.has(key)) return;
    loadingDirectories.current.add(key);
    const generation = directoryGeneration.current;
    setDirectories((previous) => ({
      ...previous,
      [key]: { ...previous[key], loading: true, error: undefined },
    }));
    try {
      const data = await api().listResourceDirectory(resourceId, path, offset);
      if (generation !== directoryGeneration.current) return;
      setDirectories((previous) => ({
        ...previous,
        [key]: {
          data: {
            ...data,
            entries: offset
              ? [...(previous[key]?.data?.entries || []), ...data.entries]
              : data.entries,
          },
        },
      }));
    } catch (reason) {
      if (generation === directoryGeneration.current)
        setDirectories((previous) => ({
          ...previous,
          [key]: { ...previous[key], loading: false, error: message(reason) },
        }));
    } finally {
      if (generation === directoryGeneration.current) loadingDirectories.current.delete(key);
    }
  }

  function revealParents(selection: Selection) {
    const item = resources.find((candidate) => candidate.id === selection.resourceId);
    if (item?.kind !== 'folder') return;
    const parts = selection.path.split(/[\\/]/).filter(Boolean);
    if (selection.kind === 'file') parts.pop();
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add(directoryKey(item.id, ''));
      parts.forEach((_, index) =>
        next.add(directoryKey(item.id, parts.slice(0, index + 1).join('/'))),
      );
      return next;
    });
  }

  function choose(selection: Selection) {
    setSelected(selection);
    setMode('preview');
    setFind('');
    setFindIndex(0);
    revealParents(selection);
  }

  useEffect(() => {
    if (!focusResource) return;
    const item = resources.find((candidate) => candidate.id === focusResource.resourceId);
    if (item)
      choose({
        ...focusResource,
        kind: !focusResource.path && item.kind === 'folder' ? 'folder' : 'file',
      });
  }, [focusResource]);

  useEffect(() => {
    if (selected && !resource) {
      setSelected(undefined);
      return;
    }
    if (selected) revealParents(selected);
  }, [resources.map((item) => item.id).join('|')]);

  useEffect(() => {
    if (selected && category && resource?.category !== category) setSelected(undefined);
  }, [category, selected?.resourceId, resource?.category]);

  useEffect(() => {
    for (const key of expanded) {
      try {
        const [id, path] = JSON.parse(key);
        if (
          resources.some(
            (item) =>
              item.id === id && item.kind === 'folder' && (!category || item.category === category),
          ) &&
          !directories[key]
        )
          void loadDirectory(id, path);
      } catch {
        /* Ignore an obsolete saved view entry. */
      }
    }
    if (selected?.kind === 'folder') {
      const key = directoryKey(selected.resourceId, selected.path);
      if (resource && (!category || resource.category === category) && !directories[key])
        void loadDirectory(selected.resourceId, selected.path);
    }
  }, [expanded, directories, revision, selected, resource, category]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ selected, expanded: [...expanded] }));
    } catch {
      /* The reader remains usable without remembering its position. */
    }
  }, [selected, expanded]);

  useEffect(() => {
    let current = true;
    setFile(null);
    setError('');
    setLoading(false);
    setHeadings([]);
    if (selected?.kind !== 'file' || !resource || (category && resource.category !== category))
      return;
    setLoading(true);
    api()
      .readResourceFile(selected.resourceId, selected.path)
      .then((value) => {
        if (current) {
          setFile(value);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (current) {
          setError(message(reason));
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [selected?.resourceId, selected?.path, selected?.kind, resource?.path, revision, category]);

  function scrollToAnchor(anchor: string) {
    let decoded = anchor.replace(/^#/, '');
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* Preserve the literal anchor. */
    }
    const candidates = body.current?.querySelectorAll<HTMLElement>('[id]') || [];
    const target = [...candidates].find(
      (element) => element.id === decoded || element.id === slug(decoded),
    );
    if (target) target.scrollIntoView({ block: 'start' });
    else if (!decoded) scroll.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    if (!body.current || file?.kind !== 'markdown' || mode !== 'preview') {
      setHeadings([]);
      return;
    }
    const used = new Map<string, number>();
    const items = [...body.current.querySelectorAll<HTMLHeadingElement>('h1,h2,h3,h4,h5,h6')].map(
      (element) => {
        const text = element.textContent || '';
        const base = slug(text) || 'section';
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        element.id = base + (count ? '-' + count : '');
        return { id: element.id, text, level: Number(element.tagName.slice(1)) };
      },
    );
    setHeadings(items);
    if (selected?.anchor) scrollToAnchor(selected.anchor);
    else scroll.current?.scrollTo({ top: 0 });
  }, [file, mode, selected?.anchor]);

  useEffect(() => {
    CSS.highlights.delete('local-file-match');
    if (!find || !body.current) {
      setFindCount(0);
      return;
    }
    const walker = document.createTreeWalker(body.current, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number; end: number }[] = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
    }
    const normalized = text.toLowerCase();
    const needle = find.toLowerCase();
    let count = 0;
    let position = normalized.indexOf(needle);
    let active = -1;
    while (position !== -1) {
      if (count === findIndex) active = position;
      count += 1;
      position = normalized.indexOf(needle, position + needle.length);
    }
    setFindCount(count);
    if (count && findIndex >= count) {
      setFindIndex(0);
      return;
    }
    if (active !== -1) {
      const start = nodes.find((item) => item.end > active);
      const end = nodes.find((item) => item.end >= active + needle.length);
      if (start && end) {
        const range = new Range();
        range.setStart(start.node, active - start.start);
        range.setEnd(end.node, active + needle.length - end.start);
        CSS.highlights.set('local-file-match', new Highlight(range));
        const rect = range.getBoundingClientRect();
        const container = scroll.current;
        if (container)
          container.scrollBy({
            top: rect.top - container.getBoundingClientRect().top - container.clientHeight / 3,
          });
      }
    }
    return () => {
      CSS.highlights.delete('local-file-match');
    };
  }, [find, findIndex, file, mode]);

  function refresh() {
    directoryGeneration.current += 1;
    loadingDirectories.current.clear();
    setDirectories({});
    setRevision((value) => value + 1);
  }

  async function followLink(href: string) {
    if (!selected) return;
    try {
      const target = await api().resolveResourceLink(selected.resourceId, selected.path, href);
      if (target.kind === 'external') await api().openWebsite(target.url);
      else if (target.kind === 'anchor') scrollToAnchor(target.anchor);
      else
        choose({
          resourceId: selected.resourceId,
          path: target.path,
          kind: 'file',
          anchor: target.anchor,
        });
    } catch (reason) {
      onError(reason);
    }
  }

  function directoryChildren(item: Resource, path: string, level: number): ReactNode {
    const key = directoryKey(item.id, path);
    const state = directories[key];
    return (
      <div className="local-tree-children" role="group">
        {state?.data?.entries.map((entry) =>
          treeItem(item, entry.name, entry.path, entry.kind, level),
        )}
        {state?.loading && <p className="local-tree-status">读取目录中</p>}
        {state?.error && (
          <div className="local-tree-status local-file-error">
            <span>{state.error}</span>
            <button className="text-button" onClick={() => void loadDirectory(item.id, path)}>
              重试
            </button>
          </div>
        )}
        {state?.data && !state.data.entries.length && <p className="local-tree-status">空文件夹</p>}
        {state?.data?.nextOffset != null && (
          <button
            className="text-button local-load-more"
            disabled={state.loading}
            onClick={() => void loadDirectory(item.id, path, state.data!.nextOffset!)}
          >
            显示更多（已显示 {state.data.entries.length} / {state.data.total}）
          </button>
        )}
      </div>
    );
  }

  function treeItem(
    item: Resource,
    name: string,
    path: string,
    kind: 'folder' | 'file',
    level: number,
    root = false,
  ): ReactNode {
    const key = directoryKey(item.id, path);
    const open = expanded.has(key);
    const active = selected?.resourceId === item.id && selected.path === path;
    return (
      <div className="local-tree-item" key={key}>
        <div
          className={'local-tree-row' + (active ? ' active' : '')}
          style={{ paddingLeft: 6 + level * 13 }}
        >
          {kind === 'folder' ? (
            <button
              className="local-tree-toggle"
              aria-label={(open ? '收起文件夹 ' : '展开文件夹 ') + name}
              aria-expanded={open}
              onClick={() =>
                setExpanded((previous) => {
                  const next = new Set(previous);
                  if (open) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="local-tree-spacer" />
          )}
          <button
            className="local-tree-name"
            data-resource-id={item.id}
            data-path={path}
            data-kind={kind}
            aria-current={active ? 'page' : undefined}
            onClick={() => choose({ resourceId: item.id, path, kind })}
          >
            {kind === 'folder' ? (
              open ? (
                <FolderOpen size={16} />
              ) : (
                <Folder size={16} />
              )
            ) : (
              <FileText size={15} />
            )}
            <span>{name}</span>
          </button>
          {root && (
            <button
              className="local-remove"
              aria-label={'移除关联 ' + item.title}
              onClick={() => void api().removeResource(item.id).catch(onError)}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {kind === 'folder' && open && directoryChildren(item, path, level + 1)}
      </div>
    );
  }

  const separator = resource?.path.includes('\\') ? '\\' : '/';
  const basePath =
    resource?.kind === 'file'
      ? resource.path.slice(0, resource.path.lastIndexOf(separator))
      : resource?.path;
  const fullPath =
    file?.fullPath ||
    (resource
      ? selected?.path
        ? basePath + separator + selected.path.split('/').join(separator)
        : resource.path
      : '');
  const pathParts = selected?.path.split(/[\\/]/).filter(Boolean) || [];
  const parents = selected?.kind === 'file' ? pathParts.slice(0, -1) : pathParts;
  return (
    <div className="local-files-pane">
      <aside className="local-file-sidebar" aria-label="本地资料目录">
        <div className="local-sidebar-heading">
          <div>
            <strong>本地资料</strong>
            <small>按需展开 · 文件留在原处</small>
          </div>
          <button className="icon-button" aria-label="刷新资料" title="刷新资料" onClick={refresh}>
            <RefreshCw size={15} />
          </button>
        </div>
        <div className="local-tree">
          {roots.map((item) =>
            item.kind === 'link' ? (
              <div className="local-tree-row" key={item.id}>
                <span className="local-tree-spacer" />
                <button
                  className="local-tree-name"
                  onClick={() => void api().openResource(item.id).catch(onError)}
                >
                  <ExternalLink size={15} />
                  <span>{item.title}</span>
                </button>
                <button
                  className="local-remove"
                  aria-label={'移除关联 ' + item.title}
                  onClick={() => void api().removeResource(item.id).catch(onError)}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              treeItem(item, item.title, '', item.kind, 0, true)
            ),
          )}
          {!roots.length && (
            <div className="local-tree-empty">
              <FolderOpen size={23} />
              <p>
                {search || category
                  ? '没有符合当前筛选的关联资料。'
                  : '关联一个常用文件夹，从这里开始阅读。'}
              </p>
            </div>
          )}
        </div>
      </aside>
      <section
        className="local-file-reader"
        data-resource-id={selected?.resourceId || ''}
        data-path={selected?.path || ''}
        data-kind={selected?.kind === 'folder' ? 'folder' : file?.kind || ''}
        aria-label="本地文件阅读器"
      >
        {resource && selected ? (
          <>
            <header className="local-reader-header">
              <div className="local-breadcrumb" aria-label="当前资料路径">
                <button
                  onClick={() =>
                    choose({
                      resourceId: resource.id,
                      path: '',
                      kind: resource.kind === 'folder' ? 'folder' : 'file',
                    })
                  }
                >
                  {resource.title}
                </button>
                {resource.kind === 'folder' &&
                  parents.map((part, index) => (
                    <span key={index}>
                      <ChevronRight size={12} />
                      <button
                        onClick={() =>
                          choose({
                            resourceId: resource.id,
                            path: parents.slice(0, index + 1).join('/'),
                            kind: 'folder',
                          })
                        }
                      >
                        {part}
                      </button>
                    </span>
                  ))}
              </div>
              <div className="local-reader-title">
                <h2>
                  {file?.name ||
                    (selected.kind === 'folder'
                      ? pathParts.at(-1) || resource.title
                      : pathParts.at(-1) || resource.title)}
                </h2>
                <span className="local-readonly">本地文件 · 只读</span>
              </div>
              <details className="local-file-location">
                <summary>文件位置</summary>
                <p className="local-full-path">{fullPath}</p>
              </details>
              <div className="local-reader-actions">
                {file?.kind === 'markdown' && (
                  <div className="segment-tabs local-view-switch">
                    <button
                      className={mode === 'preview' ? 'active' : ''}
                      onClick={() => setMode('preview')}
                    >
                      预览
                    </button>
                    <button
                      className={mode === 'source' ? 'active' : ''}
                      onClick={() => setMode('source')}
                    >
                      源码
                    </button>
                  </div>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    void api().openResourcePath(selected.resourceId, selected.path).catch(onError)
                  }
                >
                  <ExternalLink size={14} />
                  用系统应用打开
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void api()
                      .openResourcePath(selected.resourceId, selected.path, true)
                      .catch(onError)
                  }
                >
                  在文件管理器中显示
                </button>
                {file && file.kind !== 'unsupported' && (
                  <button
                    className="secondary-button local-ask"
                    onClick={() =>
                      onAskFile({
                        resourceId: selected.resourceId,
                        path: file.path,
                        title: file.name,
                      })
                    }
                  >
                    <Sparkles size={14} />
                    询问这份资料
                  </button>
                )}
              </div>
              {file && file.kind !== 'unsupported' && (
                <div className="local-find-row">
                  <label>
                    <Search size={14} />
                    <input
                      aria-label="在当前文件中查找"
                      placeholder="文内查找"
                      value={find}
                      onChange={(event) => {
                        setFind(event.target.value);
                        setFindIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && findCount) {
                          event.preventDefault();
                          setFindIndex(
                            (value) => (value + (event.shiftKey ? findCount - 1 : 1)) % findCount,
                          );
                        }
                      }}
                    />
                  </label>
                  <span className="local-find-count" aria-live="polite">
                    {find ? (findCount ? `${findIndex + 1} / ${findCount}` : '没有匹配') : ''}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="上一个匹配"
                    disabled={!findCount}
                    onClick={() => setFindIndex((value) => (value + findCount - 1) % findCount)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="下一个匹配"
                    disabled={!findCount}
                    onClick={() => setFindIndex((value) => (value + 1) % findCount)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  {find && (
                    <button
                      className="icon-button"
                      aria-label="清除文内查找"
                      onClick={() => {
                        setFind('');
                        setFindIndex(0);
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
            </header>
            <div className="local-reader-scroll" ref={scroll}>
              {loading && (
                <div className="local-reader-empty">
                  <FileText size={27} />
                  <p>正在读取文件</p>
                </div>
              )}
              {error && (
                <div className="local-reader-empty local-file-error" role="alert">
                  <File size={28} />
                  <strong>暂时无法读取这份资料</strong>
                  <p>{error}</p>
                  <button className="secondary-button" onClick={refresh}>
                    <RefreshCw size={14} />
                    重新读取
                  </button>
                </div>
              )}
              {selected.kind === 'folder' && (
                <div className="local-folder-view">
                  <div className="local-folder-caption">
                    <span>文件夹内容</span>
                    <small>
                      {selectedDirectory?.data ? `${selectedDirectory.data.total} 项` : '正在读取'}
                    </small>
                  </div>
                  {selectedDirectory?.data?.entries.map((entry) => (
                    <button
                      className="local-folder-entry"
                      key={entry.path}
                      data-resource-id={selected.resourceId}
                      data-path={entry.path}
                      data-kind={entry.kind}
                      onClick={() =>
                        choose({
                          resourceId: selected.resourceId,
                          path: entry.path,
                          kind: entry.kind,
                        })
                      }
                    >
                      {entry.kind === 'folder' ? <Folder size={18} /> : <FileText size={18} />}
                      <span>{entry.name}</span>
                      <small>
                        {entry.kind === 'folder'
                          ? '文件夹'
                          : entry.name.split('.').length > 1
                            ? entry.name.split('.').at(-1)?.toUpperCase()
                            : '文件'}
                      </small>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                  {selectedDirectory?.error && (
                    <p className="local-file-error" role="alert">
                      {selectedDirectory.error}
                    </p>
                  )}
                  {selectedDirectory?.data && !selectedDirectory.data.entries.length && (
                    <p className="local-folder-empty">这个文件夹还没有内容。</p>
                  )}
                  {selectedDirectory?.data?.nextOffset != null && (
                    <button
                      className="secondary-button local-folder-more"
                      disabled={selectedDirectory.loading}
                      onClick={() =>
                        void loadDirectory(
                          selected.resourceId,
                          selected.path,
                          selectedDirectory.data!.nextOffset!,
                        )
                      }
                    >
                      显示更多（已显示 {selectedDirectory.data.entries.length} /{' '}
                      {selectedDirectory.data.total}）
                    </button>
                  )}
                </div>
              )}
              {file?.kind === 'unsupported' && (
                <div className="local-reader-empty">
                  <File size={30} />
                  <strong>使用系统应用查看此文件</strong>
                  <p>这里支持 Markdown 和文本阅读，此格式可交给对应应用打开。</p>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void api().openResourcePath(selected.resourceId, selected.path).catch(onError)
                    }
                  >
                    用系统应用打开
                  </button>
                </div>
              )}
              {file && file.kind !== 'unsupported' && (
                <>
                  {file.kind === 'markdown' && mode === 'preview' && headings.length > 0 && (
                    <details className="local-document-outline">
                      <summary>
                        <List size={14} />
                        文档目录 · {headings.length} 个标题
                      </summary>
                      <nav aria-label="文档目录">
                        {headings.map((heading) => (
                          <button
                            key={heading.id}
                            style={{ paddingLeft: 10 + (heading.level - 1) * 10 }}
                            onClick={() => scrollToAnchor(heading.id)}
                          >
                            {heading.text || '无标题'}
                          </button>
                        ))}
                      </nav>
                    </details>
                  )}
                  <div
                    className={
                      'local-file-body' +
                      (file.kind === 'markdown' && mode === 'preview'
                        ? ' markdown local-markdown'
                        : ' local-source')
                    }
                    ref={body}
                  >
                    {file.kind === 'markdown' && mode === 'preview' ? (
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={(url) => url}
                        components={{
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              onClick={(event) => {
                                event.preventDefault();
                                if (href) void followLink(href);
                              }}
                            >
                              {children}
                            </a>
                          ),
                          img: ({ src, alt }) => (
                            <LocalImage
                              resourceId={selected.resourceId}
                              path={file.path}
                              source={typeof src === 'string' ? src : ''}
                              alt={alt || ''}
                              revision={revision}
                            />
                          ),
                        }}
                      >
                        {file.body}
                      </Markdown>
                    ) : (
                      <pre>
                        <code>{file.body}</code>
                      </pre>
                    )}
                    {!file.body && <p className="local-empty-file">这个文件目前没有内容。</p>}
                  </div>
                  <footer className="local-file-meta">
                    {new Intl.NumberFormat('zh-CN').format(file.size)} 字节 · 修改于{' '}
                    {new Date(file.modifiedAt).toLocaleString('zh-CN', { hour12: false })}
                  </footer>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="local-reader-empty">
            <FolderOpen size={36} />
            <strong>把常用资料放在手边</strong>
            <p>选择左侧文件夹，点击 Markdown 或文本即可阅读。</p>
            <p>文件保留在原位置，阅读后也可以继续询问 AI。</p>
          </div>
        )}
      </section>
    </div>
  );
}
