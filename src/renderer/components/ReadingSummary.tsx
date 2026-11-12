import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Provider } from '../../shared/types';
import type { LocalFilePreview, ReadingSummary as Summary } from '../../shared/workspace';

export function ReadingSummary({
  resourceId,
  file,
  providers,
  providerId,
  model,
}: {
  resourceId: string;
  file: LocalFilePreview;
  providers: Provider[];
  providerId: string;
  model: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [sourceModel, setSourceModel] = useState('');
  const request = useRef<string | null>(null);
  const generation = useRef(0);
  const key = `${resourceId}:${file.fullPath}:${file.size}:${file.modifiedAt}`;

  function cancel() {
    generation.current++;
    if (request.current)
      void window.dola.workspace.cancelReadingTranslation(request.current).catch(() => {});
    request.current = null;
    setBusy(false);
  }
  useEffect(() => {
    setOpen(false);
    setSummary(null);
    setError('');
    setSourceModel('');
    return () => {
      generation.current++;
      if (request.current)
        void window.dola.workspace.cancelReadingTranslation(request.current).catch(() => {});
      request.current = null;
    };
  }, [key]);
  async function run() {
    const provider = providers.find((item) => item.id === providerId) ?? providers[0];
    setOpen(true);
    setError('');
    setSummary(null);
    if (!provider) {
      setError('请先在设置中配置模型服务。');
      return;
    }
    const current = ++generation.current;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setSourceModel(provider.name);
    setBusy(true);
    try {
      const result = await window.dola.workspace.summarizeReadingFile(
        resourceId,
        file.path,
        `${file.size}:${file.modifiedAt}`,
        provider.id,
        provider.id === providerId && model ? model : provider.model,
        requestId,
      );
      if (generation.current === current) setSummary(result);
    } catch (reason) {
      if (generation.current === current)
        setError(
          (reason instanceof Error ? reason.message : String(reason)).replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
          ),
        );
    } finally {
      if (generation.current === current) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  return (
    <div className="reading-summary-anchor">
      <button
        className="text-button reading-summary-trigger"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            cancel();
            setOpen(false);
          } else if (summary) setOpen(true);
          else void run();
        }}
      >
        <Sparkles size={14} />
        AI 总结
      </button>
      {open && (
        <section className="reading-summary-popup" role="dialog" aria-label="AI 总结">
          <header>
            <strong>AI 总结</strong>
            <button
              className="icon-button"
              aria-label="关闭 AI 总结"
              onClick={() => {
                cancel();
                setOpen(false);
              }}
            >
              <X size={15} />
            </button>
          </header>
          {busy && <p role="status">正在读取资料并生成总结…</p>}
          {error && (
            <p className="local-file-error" role="alert">
              {error}
            </p>
          )}
          {summary && (
            <>
              <p className="reading-summary-scope">
                {summary.scope}
                {summary.truncated ? ' 本次总结仅基于已读取的部分。' : ''}
              </p>
              <div className="reading-summary-body markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}
                >
                  {summary.text}
                </Markdown>
              </div>
              <p className="reading-summary-scope">由 {sourceModel} 生成，请结合原文核对。</p>
            </>
          )}
          {!busy && (
            <button className="text-button" onClick={() => void run()}>
              {summary ? '重新总结' : '重试'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
