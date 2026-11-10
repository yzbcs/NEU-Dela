import type { Workspace } from './workspace';

export type Degree = Workspace['degree'];

export const studentProfiles = {
  undergrad: {
    label: '本科生',
    systemName: '本科教务系统',
    portal: 'https://jwxt.neu.edu.cn',
    sourceName: '本科教务系统网页课表',
  },
  graduate: {
    label: '研究生',
    systemName: '研究生系统',
    portal: 'https://yjs.neu.edu.cn/gsapp/sys/yjsemaphome/portal/index.do',
    sourceName: '研究生系统网页课表',
  },
} satisfies Record<
  Degree,
  { label: string; systemName: string; portal: string; sourceName: string }
>;

export function isTimetablePage(url: string, degree: Degree) {
  try {
    const parsed = new URL(url);
    return (
      ['https:', 'http:'].includes(parsed.protocol) &&
      parsed.hostname === new URL(studentProfiles[degree].portal).hostname
    );
  } catch {
    return false;
  }
}
