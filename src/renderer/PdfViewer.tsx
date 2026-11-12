import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ReadingAnnotation } from '../shared/workspace';

GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({
  document,
  pageNumber,
  zoom,
  width,
  annotations,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  width: number;
  annotations: ReadingAnnotation[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    let renderTask:
      ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let textLayer: TextLayer | undefined;
    setError('');
    setLoading(true);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (!current || !canvas.current || !sheet.current || !textContainer.current) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (Math.max(200, width - 40) / base.width) * zoom;
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16000000 / (viewport.width * viewport.height)),
        );
        const element = canvas.current;
        element.width = Math.floor(viewport.width * pixelRatio);
        element.height = Math.floor(viewport.height * pixelRatio);
        element.style.width = Math.floor(viewport.width) + 'px';
        element.style.height = Math.floor(viewport.height) + 'px';
        sheet.current.style.width = Math.floor(viewport.width) + 'px';
        sheet.current.style.height = Math.floor(viewport.height) + 'px';
        sheet.current.style.setProperty(
          '--total-scale-factor',
          String(viewport.scale * viewport.userUnit),
        );
        textContainer.current.replaceChildren();
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer.current,
          viewport,
        });
        renderTask = page.render({
          canvas: element,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        return Promise.all([renderTask.promise, textLayer.render()]);
      })
      .then(() => {
        if (current) setLoading(false);
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      });
    return () => {
      current = false;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, zoom, width]);

  return (
    <div className="local-pdf-page">
      {loading && <p role="status">正在渲染第 {pageNumber} 页…</p>}
      {error && (
        <p className="local-file-error" role="alert">
          无法显示此页：{error}
        </p>
      )}
      <div className="local-pdf-sheet" ref={sheet} data-pdf-page={pageNumber}>
        <canvas ref={canvas} aria-label={`PDF 第 ${pageNumber} 页`} />
        <div className="local-pdf-annotations" aria-hidden="true">
          {annotations
            .filter((item) => item.page === pageNumber)
            .flatMap((item) =>
              (item.rects ?? []).map((rect, index) => (
                <span
                  key={`${item.id}-${index}`}
                  data-annotation-id={item.id}
                  className={`local-pdf-mark ${item.color}`}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  }}
                />
              )),
            )}
        </div>
        <div className="local-pdf-text-layer" ref={textContainer} />
      </div>
    </div>
  );
}

export function PdfViewer({
  data,
  annotations = [],
  focus,
}: {
  data: Uint8Array;
  annotations?: ReadingAnnotation[];
  focus?: { annotation: ReadingAnnotation; request: number };
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setDocument(null);
    setError('');
    setPage(1);
    setZoom(1);
    const base = new URL('pdfjs/', window.document.baseURI);
    const task = getDocument({
      data: data.slice(),
      cMapUrl: new URL('cmaps/', base).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', base).href,
      wasmUrl: new URL('wasm/', base).href,
      useSystemFonts: true,
    });
    void task.promise
      .then((pdf) => {
        if (current) setDocument(pdf);
      })
      .catch((reason: unknown) => {
        if (current) {
          const name = reason instanceof Error ? reason.name : '';
          setError(
            name === 'PasswordException'
              ? '此 PDF 需要密码，请使用系统应用打开。'
              : '无法读取 PDF，请检查文件是否完整，或使用系统应用打开。',
          );
        }
      });
    return () => {
      current = false;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    container.current?.closest('.local-reader-scroll')?.scrollTo({ top: 0 });
  }, [page]);
  useEffect(() => {
    if (!focus?.annotation.page || !document) return;
    const target = Math.min(document.numPages, focus.annotation.page);
    setPage(target);
    let frame = 0;
    const started = performance.now();
    const locate = () => {
      const sheet = container.current?.querySelector<HTMLElement>(`[data-pdf-page="${target}"]`);
      const loading = sheet?.parentElement?.querySelector('[role="status"]');
      const mark = sheet?.querySelector<HTMLElement>(
        `[data-annotation-id="${focus.annotation.id}"]`,
      );
      if (mark && !loading && sheet?.getBoundingClientRect().width) {
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (performance.now() - started < 10000) frame = requestAnimationFrame(locate);
    };
    frame = requestAnimationFrame(locate);
    return () => cancelAnimationFrame(frame);
  }, [focus?.request, document]);

  return (
    <div className="local-pdf-viewer" ref={container}>
      {error && (
        <p className="local-file-error" role="alert">
          {error}
        </p>
      )}
      {!document && !error && <p role="status">正在打开 PDF…</p>}
      {document && (
        <>
          <div className="local-pdf-toolbar" aria-label="PDF 阅读控制">
            <button
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span aria-live="polite">
              第 {page} / {document.numPages} 页
            </span>
            <button
              className="secondary-button"
              disabled={page >= document.numPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
            <button
              className="secondary-button"
              disabled={zoom <= 0.5}
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            >
              缩小
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="secondary-button"
              disabled={zoom >= 2}
              onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
            >
              放大
            </button>
          </div>
          <PdfPage
            key={`${page}-${zoom}-${width}`}
            document={document}
            pageNumber={page}
            zoom={zoom}
            width={width}
            annotations={annotations}
          />
        </>
      )}
    </div>
  );
}
