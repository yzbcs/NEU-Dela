import { RefreshCw } from 'lucide-react';
import appIcon from '../../../assets/icon.png';
import '../startup.css';

export function StartupScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <main className="startup-screen" data-state={error ? 'error' : 'loading'} aria-busy={!error}>
      <div className="startup-card">
        <img className="startup-icon" src={appIcon} alt="" draggable={false} />
        <h1>NEU-Dela</h1>
        <p className="startup-subtitle">你的校园个人工作台</p>
        {error ? (
          <div className="startup-error" role="alert">
            <strong>暂时无法打开工作台</strong>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={15} />
              重新加载
            </button>
          </div>
        ) : (
          <p className="startup-status" role="status">
            <span className="startup-pulse" aria-hidden="true" />
            正在打开工作台
          </p>
        )}
      </div>
    </main>
  );
}
