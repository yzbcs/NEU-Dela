import { BookOpen, Check, GraduationCap } from 'lucide-react';
import { studentProfiles, type Degree } from '../../shared/student-profile';
import './student-type.css';

export function StudentTypeChoices({
  value,
  disabled = false,
  onChange,
}: {
  value: Degree | null;
  disabled?: boolean;
  onChange: (degree: Degree) => void;
}) {
  return (
    <div className="student-type-choices" role="group" aria-label="学生类型">
      {(['undergrad', 'graduate'] as const).map((degree) => {
        const profile = studentProfiles[degree];
        const Icon = degree === 'undergrad' ? BookOpen : GraduationCap;
        return (
          <button
            key={degree}
            type="button"
            className={'student-type-choice' + (value === degree ? ' selected' : '')}
            data-degree-choice={degree}
            aria-pressed={value === degree}
            disabled={disabled}
            onClick={() => onChange(degree)}
          >
            <Icon size={25} />
            <strong>{profile.label}</strong>
            <span>{profile.systemName}课表与常用校园服务</span>
            {value === degree && <Check className="student-type-check" size={17} />}
          </button>
        );
      })}
    </div>
  );
}
