import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root } from 'mdast';
import { Check } from 'lucide-react';

function taskPositions() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (node.type === 'listItem' && typeof node.checked === 'boolean' && node.position) {
        node.data ??= {};
        node.data.hProperties = {
          ...node.data.hProperties,
          'data-task-line': node.position.start.line,
          'data-task-checked': node.checked,
        };
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function NoteMarkdown({
  body,
  onChange,
}: {
  body: string;
  onChange: (body: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, taskPositions]}
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        li: ({ node, children, ...props }) => {
          const line = Number(node?.properties['data-task-line']);
          const checked = Boolean(node?.properties['data-task-checked']);
          const taskTitle = line
            ? body.split('\n')[line - 1]?.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/, '')
            : '';
          return (
            <li
              {...props}
              className={line ? 'memo-task' + (checked ? ' checked' : '') : props.className}
            >
              {line > 0 && (
                <button
                  type="button"
                  className="memo-task-check"
                  aria-label={(checked ? '恢复清单项 ' : '完成清单项 ') + taskTitle}
                  aria-pressed={checked}
                  onClick={() => {
                    const lines = body.split('\n');
                    lines[line - 1] = lines[line - 1].replace(
                      /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/,
                      '$1[' + (checked ? ' ' : 'x') + ']',
                    );
                    onChange(lines.join('\n'));
                  }}
                >
                  <Check size={13} />
                </button>
              )}
              {children}
            </li>
          );
        },
      }}
    >
      {body || '还没有内容，切换到编辑模式记下一点想法。'}
    </Markdown>
  );
}

export function formatNoteSelection(
  body: string,
  start: number,
  end: number,
  style: 'bold' | 'heading' | 'list' | 'checklist',
) {
  if (style === 'bold') {
    const text = body.slice(start, end) || '加粗文字';
    return {
      body: body.slice(0, start) + '**' + text + '**' + body.slice(end),
      start: start + 2,
      end: start + 2 + text.length,
    };
  }
  const from = start === 0 ? 0 : body.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = body.indexOf('\n', end);
  const to = lineEnd < 0 ? body.length : lineEnd;
  const prefix = { heading: '## ', list: '- ', checklist: '- [ ] ' }[style];
  const text = (body.slice(from, to) || (style === 'checklist' ? '待办事项' : '写下内容'))
    .split('\n')
    .map((line) => prefix + line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s*)?)/, ''))
    .join('\n');
  return {
    body: body.slice(0, from) + text + body.slice(to),
    start: from + prefix.length,
    end: from + text.length,
  };
}
