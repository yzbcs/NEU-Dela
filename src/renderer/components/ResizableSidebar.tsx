import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export function useSidebarCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(key) === 'true');
  useEffect(() => {
    localStorage.setItem(key, String(collapsed));
  }, [key, collapsed]);
  return [collapsed, setCollapsed] as const;
}

export function useSidebarWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, String(width));
  }, [key, width]);
  return [width, setWidth] as const;
}

export function ResizeHandle({
  label,
  width,
  onChange,
  min,
  max,
  remaining,
  initial,
  collapsed,
}: {
  label: string;
  width: number;
  onChange: (width: number) => void;
  min: number;
  max: number;
  remaining: number;
  initial: number;
  collapsed: boolean;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  function update(value: number) {
    const containerWidth =
      handle.current?.parentElement?.parentElement?.getBoundingClientRect().width ?? Infinity;
    onChange(
      Math.round(Math.max(min, Math.min(value, max, Math.max(min, containerWidth - remaining)))),
    );
  }
  return (
    <div className={'sidebar-divider' + (collapsed ? ' collapsed' : '')}>
      {!collapsed && (
        <div
          ref={handle}
          className="sidebar-resize-handle"
          role="separator"
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={width}
          tabIndex={0}
          title="拖动调整宽度，双击恢复默认宽度"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            start.current = { x: event.clientX, width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (start.current) update(start.current.width + event.clientX - start.current.x);
          }}
          onPointerUp={() => {
            start.current = null;
          }}
          onPointerCancel={() => {
            start.current = null;
          }}
          onLostPointerCapture={() => {
            start.current = null;
          }}
          onDoubleClick={() => update(initial)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              update(width + (event.key === 'ArrowRight' ? 10 : -10));
            } else if (event.key === 'Home') {
              event.preventDefault();
              update(min);
            } else if (event.key === 'End') {
              event.preventDefault();
              update(max);
            }
          }}
        />
      )}
    </div>
  );
}

export function SidebarToggle({
  collapsed,
  onToggle,
  panelId,
  panelName,
}: {
  collapsed: boolean;
  onToggle: () => void;
  panelId: string;
  panelName: string;
}) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      aria-controls={panelId}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? '显示' : '隐藏'}${panelName}`}
      title={`${collapsed ? '显示' : '隐藏'}${panelName}`}
      onClick={onToggle}
    >
      {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
    </button>
  );
}
