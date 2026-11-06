import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, RefreshCw, Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

export function SelectMenu({
  id,
  name,
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
  placeholder = '请选择',
  placement = 'bottom',
  onOpen,
  refresh,
  notice,
}: {
  id?: string;
  name: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  placeholder?: string;
  placement?: 'top' | 'bottom';
  onOpen?: () => void;
  refresh?: { busy: boolean; onClick: () => void };
  notice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    [option.label, option.value, option.group]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  function show() {
    setQuery('');
    setOpen(true);
    onOpen?.();
  }
  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocused(
        (old) =>
          (old + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
          Math.max(1, filtered.length),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered[focused]) choose(filtered[focused]);
    }
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const above = rect.top - 16;
      const below = window.innerHeight - rect.bottom - 16;
      const topSide =
        placement === 'top' ? above >= 180 || above > below : below < 220 && above > below;
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 32);
      setPosition({
        left: Math.min(rect.left, window.innerWidth - width - 16),
        width,
        top: topSide ? undefined : rect.bottom + 7,
        bottom: topSide ? window.innerHeight - rect.top + 7 : undefined,
        maxHeight: Math.min(360, topSide ? above : below),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement]);
  useEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    else menu.current?.querySelector<HTMLElement>('[role=listbox]')?.focus();
    function outside(event: PointerEvent) {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, searchable]);
  useEffect(() => {
    if (open)
      setFocused(
        Math.max(
          0,
          filtered.findIndex((option) => option.value === value),
        ),
      );
  }, [open, query, value, options]);
  useEffect(() => {
    menu.current
      ?.querySelectorAll<HTMLElement>('[role=option]')
      [focused]?.scrollIntoView({ block: 'nearest' });
  }, [focused, open, query]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        data-select={name}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selected?.label || placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="select-menu"
            data-menu={name}
            style={position}
            tabIndex={-1}
            onKeyDown={keyDown}
          >
            {(searchable || refresh) && (
              <div className="select-menu-search">
                {searchable && (
                  <>
                    <Search size={14} />
                    <input
                      ref={search}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索模型"
                      aria-label="搜索模型"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={menuId}
                      aria-activedescendant={filtered[focused] ? menuId + '-' + focused : undefined}
                    />
                  </>
                )}
                {refresh && (
                  <button
                    type="button"
                    className="select-refresh"
                    aria-label="刷新模型列表"
                    title="刷新模型列表"
                    disabled={refresh.busy}
                    onClick={refresh.onClick}
                  >
                    <RefreshCw size={15} className={refresh.busy ? 'spinning' : ''} />
                  </button>
                )}
              </div>
            )}
            {refresh?.busy && (
              <p className="select-menu-notice" role="status">
                正在获取模型列表
              </p>
            )}
            {notice && (
              <p className="select-menu-notice" role="status">
                {notice}
              </p>
            )}
            <div
              id={menuId}
              className="select-menu-options"
              role="listbox"
              tabIndex={-1}
              aria-label={label}
              aria-activedescendant={filtered[focused] ? menuId + '-' + focused : undefined}
            >
              {!filtered.length && (
                <div className="select-empty">{query ? '没有匹配的模型' : '暂无可选模型'}</div>
              )}
              {filtered.map((option, index) => (
                <div key={option.value}>
                  {option.group && option.group !== filtered[index - 1]?.group && (
                    <div className="select-group">{option.group}</div>
                  )}
                  <button
                    type="button"
                    id={menuId + '-' + index}
                    role="option"
                    aria-selected={option.value === value}
                    tabIndex={-1}
                    className={
                      'select-option ' +
                      (focused === index ? 'focused ' : '') +
                      (option.value === value ? 'selected' : '')
                    }
                    data-value={option.value}
                    onPointerMove={() => setFocused(index)}
                    onClick={() => choose(option)}
                  >
                    <span>{option.label}</span>
                    {option.value === value && <Check size={14} />}
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
