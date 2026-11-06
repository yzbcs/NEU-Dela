import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { periodTimes, type Timetable } from '../../shared/workspace';

export function TermSettingsForm({
  timetable,
  busy,
  setBusy,
  onSaved,
  onCancel,
  onError,
  onNotice,
}: {
  timetable: Timetable;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
  onNotice: (notice: string) => void;
}) {
  const [term, setTerm] = useState(timetable.term);
  const [firstMonday, setFirstMonday] = useState(timetable.firstMonday);
  const [periods, setPeriods] = useState<[string, string][]>(() =>
    (timetable.periods || periodTimes).map(([start, end]) => [start, end]),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await window.dola.workspace.updateTimetableSettings({ term, firstMonday, periods });
      onNotice('学期与节次已保存，现有课程保留。');
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="work-form settings-editor"
      data-settings-page="semester-editor"
      onSubmit={(event) => void submit(event)}
    >
      <div className="settings-editor-heading">
        <div>
          <h2>编辑学期与节次</h2>
          <p>调整课程对应日期与上课时间。</p>
        </div>
      </div>
      <fieldset disabled={busy}>
        <div className="field-pair">
          <label>
            学期名称
            <input
              name="term"
              required
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="例如：2026—2027 秋季学期"
            />
          </label>
          <label>
            第一周的周一
            <input
              name="firstMonday"
              type="date"
              required
              value={firstMonday}
              onChange={(event) => setFirstMonday(event.target.value)}
            />
          </label>
        </div>
        <h3 className="settings-form-section-title">节次时间</h3>
        <div className="settings-period-editor">
          {periods.map(([start, end], index) => (
            <div className="settings-period-row" key={index}>
              <span>第 {index + 1} 节</span>
              <label>
                <span className="sr-only">第 {index + 1} 节开始</span>
                <input
                  type="time"
                  aria-label={`第 ${index + 1} 节开始`}
                  name={`period-start-${index}`}
                  required
                  value={start}
                  onChange={(event) =>
                    setPeriods((previous) =>
                      previous.map((pair, i) =>
                        i === index ? [event.target.value, pair[1]] : pair,
                      ),
                    )
                  }
                />
              </label>
              <span>至</span>
              <label>
                <span className="sr-only">第 {index + 1} 节结束</span>
                <input
                  type="time"
                  aria-label={`第 ${index + 1} 节结束`}
                  name={`period-end-${index}`}
                  required
                  value={end}
                  onChange={(event) =>
                    setPeriods((previous) =>
                      previous.map((pair, i) =>
                        i === index ? [pair[0], event.target.value] : pair,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <p className="settings-hint">
          修改首周日期会影响课程对应的实际日期，修改节次会影响课表显示的上课时间。已有课程及导入来源保留。
        </p>
        <div className="settings-editor-footer">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" type="submit">
            <Check size={15} />
            {busy ? '正在保存' : '保存学期设置'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
