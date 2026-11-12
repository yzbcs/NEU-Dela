import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Provider } from '../../shared/types';
import type {
  AnnotationColor,
  LocalFilePreview,
  ReadingAnnotation,
  ReadingAnnotationInput,
  ReadingAnnotationList,
} from '../../shared/workspace';

type Selection = {
  text: string;
  view: ReadingAnnotationInput['view'];
  page?: number;
  rects?: ReadingAnnotationInput['rects'];
  start?: number;
  end?: number;
  left: number;
  top: number;
  above: boolean;
  annotationId?: string;
};
const colors: { value: AnnotationColor; label: string }[] = [
  { value: 'yellow', label: '黄色' },
  { value: 'green', label: '绿色' },
  { value: 'blue', label: '蓝色' },
  { value: 'pink', label: '粉色' },
];
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );

function textRange(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0,
    startFound = false,
    node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!startFound && start <= offset + length) {
      range.setStart(node, Math.max(0, start - offset));
      startFound = true;
    }
    if (startFound && end <= offset + length) {
      range.setEnd(node, Math.max(0, end - offset));
      return range;
    }
    offset += length;
  }
  return null;
}

export function useReadingTools({
  file,
  resourceId,
  mode,
  setMode,
  body,
  providers,
  providerId,
  model,
  onFocusPdf,
}: {
  file: LocalFilePreview | null;
  resourceId?: string;
  mode: 'preview' | 'source';
  setMode: (mode: 'preview' | 'source') => void;
  body: RefObject<HTMLDivElement | null>;
  providers: Provider[];
  providerId: string;
  model: string;
  onFocusPdf: (annotation: ReadingAnnotation) => void;
}) {
  const [list, setList] = useState<ReadingAnnotationList | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [autoTranslate, setAutoTranslate] = useState(
    () => localStorage.getItem('dola-reading-auto-translate') !== 'false',
  );
  const [autoStatus, setAutoStatus] = useState<'idle' | 'waiting' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [autoTranslation, setAutoTranslation] = useState('');
  const [autoError, setAutoError] = useState('');
  const [savedSelectionId, setSavedSelectionId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'translation' | 'annotations' | null>(null);
  const [translation, setTranslation] = useState('');
  const [translationSource, setTranslationSource] = useState('');
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');
  const [chosenProvider, setChosenProvider] = useState('');
  const [pendingTextFocus, setPendingTextFocus] = useState<ReadingAnnotation | null>(null);
  const generation = useRef(0);
  const autoGeneration = useRef(0);
  const fileKey = `${resourceId ?? ''}:${file?.fullPath ?? ''}:${file?.modifiedAt ?? ''}:${file?.size ?? ''}`;
  useEffect(() => {
    const current = ++generation.current;
    setList(null);
    setSelection(null);
    setPendingTextFocus(null);
    setPanel(null);
    setTranslation('');
    setTranslationSource('');
    setTranslating(false);
    setError('');
    if (!file || !resourceId || file.kind === 'unsupported') return;
    void window.dola.workspace
      .listReadingAnnotations(resourceId, file.path)
      .then((result) => {
        if (generation.current === current) setList(result);
      })
      .catch((reason: unknown) => {
        if (generation.current === current) setError(errorText(reason));
      });
  }, [fileKey]);
  useEffect(() => {
    setChosenProvider(providerId);
  }, [providerId]);
  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.reading-selection-toolbar'))
        setSelection(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', escape);
    };
  }, [Boolean(selection)]);
  useEffect(() => {
    localStorage.setItem('dola-reading-auto-translate', String(autoTranslate));
  }, [autoTranslate]);
  const selectionKey = selection
    ? JSON.stringify([
        fileKey,
        selection.view,
        selection.page,
        selection.start,
        selection.end,
        selection.text,
        selection.rects,
        selection.annotationId,
      ])
    : '';
  const autoProvider =
    providers.find((item) => item.id === chosenProvider) ??
    providers.find((item) => item.id === providerId) ??
    providers[0];
  const autoModel = autoProvider?.id === providerId && model ? model : (autoProvider?.model ?? '');
  useEffect(() => {
    setSavedSelectionId(null);
  }, [selectionKey]);
  useEffect(() => {
    const sequence = ++autoGeneration.current;
    setAutoTranslation('');
    setAutoError('');
    if (
      !autoTranslate ||
      !selection ||
      selection.annotationId ||
      !/[a-zA-Z]/.test(selection.text)
    ) {
      setAutoStatus('idle');
      return;
    }
    if (!autoProvider) {
      setAutoStatus('error');
      setAutoError('请先在设置中配置模型服务。');
      return;
    }
    if (selection.text.length > 5000) {
      setAutoStatus('error');
      setAutoError('选中文字超过 5000 字，请分段翻译。');
      return;
    }
    const text = selection.text;
    const requestId = crypto.randomUUID();
    let started = false;
    setAutoStatus('waiting');
    const timer = window.setTimeout(() => {
      started = true;
      setAutoStatus('loading');
      void window.dola.workspace
        .translateReadingText(autoProvider.id, autoModel, text, requestId)
        .then((result) => {
          if (autoGeneration.current !== sequence) return;
          setAutoTranslation(result);
          setAutoStatus('done');
        })
        .catch((reason: unknown) => {
          if (autoGeneration.current !== sequence) return;
          setAutoError(errorText(reason));
          setAutoStatus('error');
        })
        .finally(() => {
          started = false;
        });
    }, 650);
    return () => {
      ++autoGeneration.current;
      window.clearTimeout(timer);
      if (started) void window.dola.workspace.cancelReadingTranslation(requestId).catch(() => {});
    };
  }, [selectionKey, autoTranslate, autoProvider?.id, autoModel]);
  const currentVersion = file ? `${file.size}:${file.modifiedAt}` : '';
  const valid = Boolean(list && list.version === currentVersion);
  const activeItems = (list?.items ?? []).filter((item) => item.version === currentVersion);

  useEffect(() => {
    const names = colors.map(({ value }) => `reading-${value}`);
    if (!body.current || file?.kind === 'pdf' || !valid) return;
    const root = body.current;
    const view = file?.kind === 'markdown' && mode === 'preview' ? 'markdown' : 'source';
    for (const color of colors) {
      const ranges = activeItems
        .filter(
          (item) =>
            item.color === color.value &&
            item.view === view &&
            item.start !== undefined &&
            item.end !== undefined,
        )
        .map((item) => textRange(root, item.start!, item.end!))
        .filter((range): range is Range => Boolean(range));
      if (ranges.length) CSS.highlights.set(`reading-${color.value}`, new Highlight(...ranges));
      else CSS.highlights.delete(`reading-${color.value}`);
    }
    return () => names.forEach((name) => CSS.highlights.delete(name));
  }, [fileKey, list, mode, valid, body]);

  useEffect(() => {
    if (!pendingTextFocus || !body.current) return;
    const expected = file?.kind === 'markdown' && mode === 'preview' ? 'markdown' : 'source';
    if (pendingTextFocus.view !== expected) return;
    const item = pendingTextFocus;
    setPendingTextFocus(null);
    if (item.start === undefined || item.end === undefined) return;
    const range = textRange(body.current, item.start, item.end);
    if (!range || range.toString().trim() !== item.text.trim()) {
      setError('原文位置已变化，无法可靠定位。');
      return;
    }
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setError('');
  }, [pendingTextFocus, mode, fileKey]);

  function showSelection(next: Selection) {
    const match = activeItems.find((item) => {
      if (item.view !== next.view || item.text.trim() !== next.text.trim()) return false;
      if (next.view !== 'pdf') return item.start === next.start && item.end === next.end;
      if (item.page !== next.page) return false;
      return (item.rects ?? []).some((a) =>
        (next.rects ?? []).some((b) => {
          const intersection =
            Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
            Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
          return (
            intersection > 0 &&
            intersection / Math.min(a.width * a.height, b.width * b.height) > 0.5
          );
        }),
      );
    });
    setSelection(match ? { ...next, annotationId: match.id } : next);
  }
  function openAnnotationAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y);
    const sheet = element?.closest<HTMLElement>('.local-pdf-sheet');
    const bounds = sheet?.getBoundingClientRect();
    const item = activeItems.find((annotation) => {
      if (
        annotation.view === 'pdf' &&
        sheet &&
        bounds &&
        annotation.page === Number(sheet.dataset.pdfPage)
      ) {
        const px = (x - bounds.left) / bounds.width;
        const py = (y - bounds.top) / bounds.height;
        return (annotation.rects ?? []).some(
          (rect) =>
            px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height,
        );
      }
      const view = file?.kind === 'markdown' && mode === 'preview' ? 'markdown' : 'source';
      if (
        !body.current ||
        !element ||
        !body.current.contains(element) ||
        annotation.view !== view ||
        annotation.start === undefined ||
        annotation.end === undefined
      )
        return false;
      const range = textRange(body.current, annotation.start, annotation.end);
      return Boolean(
        range &&
        range.toString().trim() === annotation.text.trim() &&
        [...range.getClientRects()].some(
          (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
        ),
      );
    });
    if (!item) {
      setSelection(null);
      return;
    }
    setSelection({
      text: item.text,
      view: item.view,
      page: item.page,
      rects: item.rects,
      start: item.start,
      end: item.end,
      annotationId: item.id,
      left: Math.max(8, Math.min(window.innerWidth - 375, x)),
      top: y > 210 ? y - 8 : Math.min(window.innerHeight - 190, y + 8),
      above: y > 210,
    });
  }
  function captureSelection(point?: { x: number; y: number }) {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) {
      if (point) openAnnotationAt(point.x, point.y);
      else setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) {
      setSelection(null);
      return;
    }
    const container =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const layer = container?.closest('.local-pdf-text-layer');
    const rect = range.getBoundingClientRect();
    const base = {
      text,
      left: Math.max(8, Math.min(window.innerWidth - 375, rect.left)),
      top: rect.top > 210 ? rect.top - 8 : Math.min(window.innerHeight - 190, rect.bottom + 8),
      above: rect.top > 210,
    };
    if (file?.kind === 'pdf' && layer) {
      const sheet = layer.closest<HTMLElement>('.local-pdf-sheet');
      if (!sheet || !sheet.contains(range.startContainer) || !sheet.contains(range.endContainer))
        return;
      const bounds = sheet.getBoundingClientRect();
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          x: Math.max(0, Math.min(1, (r.left - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (r.top - bounds.top) / bounds.height)),
          width: Math.max(0, Math.min(1, r.width / bounds.width)),
          height: Math.max(0, Math.min(1, r.height / bounds.height)),
        }))
        .slice(0, 200);
      if (rects.length)
        showSelection({ ...base, view: 'pdf', page: Number(sheet.dataset.pdfPage), rects });
    } else if (
      body.current?.contains(range.startContainer) &&
      body.current.contains(range.endContainer)
    ) {
      const pre = document.createRange();
      pre.selectNodeContents(body.current);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      showSelection({
        ...base,
        view: file?.kind === 'markdown' && mode === 'preview' ? 'markdown' : 'source',
        start,
        end: start + text.length,
      });
    }
  }
  async function add(color: AnnotationColor) {
    if (!selection || !file || !resourceId) return;
    if (!list) {
      setError('标注尚未加载完成，请稍后重试。');
      setPanel('annotations');
      return;
    }
    if (!valid) {
      setError('文件已更改，请重新打开后再标注。');
      setPanel('annotations');
      return;
    }
    const current = generation.current;
    try {
      const existingId = selection.annotationId ?? savedSelectionId;
      if (existingId) {
        const item = list.items.find((entry) => entry.id === existingId);
        if (item) {
          const result = await window.dola.workspace.updateReadingAnnotation(
            resourceId,
            file.path,
            item.id,
            color,
            item.comment ?? '',
          );
          if (generation.current === current) setList(result);
          return;
        }
      }
      const {
        left: _left,
        top: _top,
        above: _above,
        annotationId: _annotationId,
        ...input
      } = selection;
      const result = await window.dola.workspace.addReadingAnnotation(
        resourceId,
        file.path,
        list.version,
        { ...input, color },
      );
      if (generation.current !== current) return;
      setList(result);
      setSavedSelectionId(result.items[0]?.id ?? null);
      setError('');
    } catch (reason) {
      if (generation.current !== current) return;
      setError(errorText(reason));
      setPanel('annotations');
    }
  }
  async function translate(source?: string) {
    const text = source ?? selection?.text ?? translationSource;
    if (!text || translating) return;
    const chosen =
      providers.find((item) => item.id === chosenProvider) ??
      providers.find((item) => item.id === providerId) ??
      providers[0];
    setPanel('translation');
    setError('');
    setTranslation('');
    setTranslationSource(text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (!chosen) {
      setError('请先在设置中添加并选择模型服务。');
      return;
    }
    if (text.length > 5000) {
      setError('选中文字超过 5000 字，请分段翻译。');
      return;
    }
    const current = generation.current;
    setTranslating(true);
    try {
      const answer = await window.dola.workspace.translateReadingText(
        chosen.id,
        chosen.id === providerId && model ? model : chosen.model,
        text,
      );
      if (generation.current === current) setTranslation(answer);
    } catch (reason) {
      if (generation.current === current) setError(errorText(reason));
    } finally {
      if (generation.current === current) setTranslating(false);
    }
  }
  async function update(item: ReadingAnnotation, color: AnnotationColor, comment: string) {
    if (!file || !resourceId) return;
    const current = generation.current;
    try {
      const result = await window.dola.workspace.updateReadingAnnotation(
        resourceId,
        file.path,
        item.id,
        color,
        comment,
      );
      if (generation.current !== current) return;
      setList(result);
      setError('');
    } catch (reason) {
      if (generation.current !== current) return;
      setError(errorText(reason));
    }
  }
  async function remove(item: ReadingAnnotation) {
    if (!file || !resourceId) return;
    const current = generation.current;
    try {
      const result = await window.dola.workspace.removeReadingAnnotation(
        resourceId,
        file.path,
        item.id,
      );
      if (generation.current !== current) return;
      setList(result);
      if (selection?.annotationId === item.id || savedSelectionId === item.id) {
        setSelection(null);
        setSavedSelectionId(null);
        window.getSelection()?.removeAllRanges();
      }
      setError('');
    } catch (reason) {
      if (generation.current !== current) return;
      setError(errorText(reason));
    }
  }
  function focus(item: ReadingAnnotation) {
    if (item.version !== currentVersion) {
      setError('文件已更改，无法可靠定位这条旧标注。');
      return;
    }
    if (item.view === 'pdf') {
      onFocusPdf(item);
      return;
    }
    const expected = file?.kind === 'markdown' && mode === 'preview' ? 'markdown' : 'source';
    if (item.view !== expected) {
      setMode(item.view === 'markdown' ? 'preview' : 'source');
    }
    setPendingTextFocus(item);
  }
  return {
    list,
    activeItems,
    selection,
    autoTranslate,
    setAutoTranslate,
    autoStatus,
    autoTranslation,
    autoError,
    savedSelectionId,
    selectedAnnotationId: selection?.annotationId ?? savedSelectionId,
    panel,
    setPanel,
    translation,
    translationSource,
    translating,
    error,
    chosenProvider,
    setChosenProvider,
    captureSelection,
    dismissSelection: () => setSelection(null),
    add,
    translate,
    update,
    remove,
    removeSelected: () => {
      const item = list?.items.find(
        (entry) => entry.id === (selection?.annotationId ?? savedSelectionId),
      );
      if (item) return remove(item);
    },
    focus,
    valid,
  };
}

export type ReadingToolsState = ReturnType<typeof useReadingTools>;

export function SelectionToolbar({ tools }: { tools: ReadingToolsState }) {
  const { selection } = tools;
  if (!selection) return null;
  return (
    <div
      className="reading-selection-toolbar"
      style={{
        left: selection.left,
        top: selection.top,
        transform: selection.above ? 'translateY(-100%)' : undefined,
      }}
      onMouseDown={(event) => {
        if ((event.target as Element).closest('button')) event.preventDefault();
      }}
    >
      <div className="reading-selection-actions">
        {(!tools.autoTranslate || tools.autoStatus === 'idle' || tools.autoStatus === 'error') && (
          <button disabled={tools.translating} onClick={() => void tools.translate()}>
            ✦ 翻译
          </button>
        )}
        <span className="reading-selection-label">
          {tools.selectedAnnotationId ? '已标注' : '标注'}
        </span>
        {colors.map((color) => (
          <button
            key={color.value}
            className={`reading-color ${color.value}`}
            aria-label={`${color.label}标注`}
            title={`${color.label}标注`}
            onClick={() => void tools.add(color.value)}
          />
        ))}
        {tools.selectedAnnotationId && (
          <button className="reading-remove-highlight" onClick={() => void tools.removeSelected()}>
            取消标注
          </button>
        )}
      </div>
      {tools.autoTranslate && tools.autoStatus !== 'idle' && (
        <div className="reading-auto-result" aria-live="polite">
          {(tools.autoStatus === 'waiting' || tools.autoStatus === 'loading') && (
            <span>正在翻译…</span>
          )}
          {tools.autoStatus === 'done' && (
            <>
              <strong>中文翻译</strong>
              <p>{tools.autoTranslation}</p>
              <button onClick={() => void navigator.clipboard.writeText(tools.autoTranslation)}>
                复制译文
              </button>
            </>
          )}
          {tools.autoStatus === 'error' && (
            <span className="local-file-error">{tools.autoError}</span>
          )}
        </div>
      )}
    </div>
  );
}

function AnnotationCard({
  item,
  current,
  tools,
}: {
  item: ReadingAnnotation;
  current: boolean;
  tools: ReadingToolsState;
}) {
  const [comment, setComment] = useState(item.comment ?? '');
  return (
    <article className="reading-annotation-card">
      <div className="reading-annotation-heading">
        <span className={`reading-color ${item.color}`} />{' '}
        <span>
          {item.view === 'pdf' ? `第 ${item.page} 页` : item.view === 'markdown' ? '预览' : '源码'}
          {!current ? ' · 文件已变更' : ''}
        </span>
        <button className="text-button" onClick={() => tools.focus(item)}>
          定位
        </button>
        <button className="text-button" onClick={() => void tools.remove(item)}>
          删除
        </button>
      </div>
      <p>{item.text}</p>
      <div className="reading-colors">
        {colors.map((color) => (
          <button
            key={color.value}
            className={`reading-color ${color.value}`}
            aria-label={`改为${color.label}标注`}
            title={`改为${color.label}标注`}
            onClick={() => void tools.update(item, color.value, comment)}
          />
        ))}
      </div>
      <textarea
        aria-label="标注笔记"
        placeholder="添加自己的笔记…"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <button
        className="text-button"
        disabled={comment === (item.comment ?? '')}
        onClick={() => void tools.update(item, item.color, comment)}
      >
        保存笔记
      </button>
    </article>
  );
}

export function ReadingPanel({
  tools,
  providers,
  file,
}: {
  tools: ReadingToolsState;
  providers: Provider[];
  file: LocalFilePreview;
}) {
  if (!tools.panel) return null;
  const items = tools.list?.items ?? [];
  return (
    <aside className="reading-panel" aria-label="阅读助手">
      <div className="reading-panel-header">
        <strong>阅读助手</strong>
        <button
          className="text-button"
          onClick={() => tools.setPanel(null)}
          aria-label="关闭阅读助手"
        >
          关闭
        </button>
      </div>
      <div className="reading-panel-tabs">
        <button
          aria-pressed={tools.panel === 'translation'}
          onClick={() => tools.setPanel('translation')}
        >
          翻译
        </button>
        <button
          aria-pressed={tools.panel === 'annotations'}
          onClick={() => tools.setPanel('annotations')}
        >
          标注 {items.length}
        </button>
      </div>
      {tools.error && (
        <p className="local-file-error" role="alert">
          {tools.error}
        </p>
      )}
      {tools.panel === 'translation' ? (
        <div className="reading-panel-content">
          <label>
            翻译模型
            <select
              value={tools.chosenProvider || providers[0]?.id || ''}
              onChange={(event) => tools.setChosenProvider(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.model}
                </option>
              ))}
            </select>
          </label>
          <p className="reading-help">选中文字会发送给所选模型服务，用于生成译文。</p>
          {tools.translationSource && <blockquote>{tools.translationSource}</blockquote>}
          {tools.translating ? (
            <p role="status">正在翻译…</p>
          ) : tools.translation ? (
            <div className="reading-translation">{tools.translation}</div>
          ) : (
            <p className="reading-help">译文会显示在这里。</p>
          )}
          {tools.translation && (
            <button
              className="secondary-button"
              onClick={() => void navigator.clipboard.writeText(tools.translation)}
            >
              复制译文
            </button>
          )}
          {tools.translationSource && (
            <button
              className="secondary-button"
              disabled={tools.translating}
              onClick={() => void tools.translate(tools.translationSource)}
            >
              重新翻译
            </button>
          )}
        </div>
      ) : (
        <div className="reading-panel-content">
          {!items.length && <p className="reading-help">选择文字并点击颜色，即可创建标注。</p>}
          {items.map((item) => (
            <AnnotationCard
              key={item.id}
              item={item}
              tools={tools}
              current={item.version === `${file.size}:${file.modifiedAt}`}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
