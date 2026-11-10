import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Degree } from '../../shared/student-profile';
import { StudentTypeChoices } from './StudentTypeChoices';
import appIcon from '../../../assets/icon.png';

export function StudentOnboarding({
  onComplete,
}: {
  onComplete: (degree: Degree) => Promise<void>;
}) {
  const [degree, setDegree] = useState<Degree | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function complete() {
    if (!degree || busy) return;
    setBusy(true);
    setError('');
    try {
      await onComplete(degree);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="student-onboarding" data-onboarding="student-type">
      <section className="student-onboarding-card" aria-labelledby="student-onboarding-title">
        <img src={appIcon} alt="" width="60" height="60" draggable={false} />
        <p className="eyebrow">WELCOME TO NEU-DELA</p>
        <h1 id="student-onboarding-title">先选择你的学生类型</h1>
        <p>课表导入、校园入口和 AI 助手会使用同一份选择。</p>
        <StudentTypeChoices value={degree} disabled={busy} onChange={setDegree} />
        <p className="student-onboarding-hint">
          之后可以在「设置 → 学生类型」中修改，已有课表与资料会保留。
        </p>
        {error && (
          <p className="student-onboarding-error" role="alert">
            保存失败：{error}
          </p>
        )}
        <button
          className="primary-button"
          disabled={!degree || busy}
          onClick={() => void complete()}
        >
          {busy ? '正在保存' : '进入工作台'} <ArrowRight size={16} />
        </button>
      </section>
    </main>
  );
}
