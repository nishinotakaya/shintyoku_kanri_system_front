import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Google スプレッドシートのフィルタと同じ操作感の列見出しフィルタ。
// ▼ボタン → 並べ替え(A→Z / Z→A)・値の検索・値のチェックボックス(複数選択) → OK で確定。
// selectedValues が null のときは「絞り込みなし(すべて表示)」。

export type SheetColumnFilterOption = { value: string; label: string; count: number }
export type SheetSortDirection = 'asc' | 'desc'

const POPOVER_WIDTH_PX = 240
const INACTIVE_BUTTON_CLASS_BY_TONE = {
  dark: 'bg-white/15 text-white hover:bg-white/30',
  light: 'bg-slate-200 text-slate-600 hover:bg-slate-300',
} as const
const VIEWPORT_MARGIN_PX = 8

export function SheetColumnFilter({
  columnLabel,
  options,
  selectedValues,
  sortDirection,
  onApply,
  onSort,
  tone = 'dark',
}: {
  columnLabel: string
  options: SheetColumnFilterOption[]
  selectedValues: string[] | null
  sortDirection: SheetSortDirection | null
  onApply: (nextSelectedValues: string[] | null) => void
  onSort: (direction: SheetSortDirection) => void
  // 見出しの背景色に合わせたボタン配色(dark=濃色見出し / light=淡色見出し)
  tone?: 'dark' | 'light'
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 })
  const [searchText, setSearchText] = useState('')
  const [draftValues, setDraftValues] = useState<Set<string>>(new Set())

  const isActive = selectedValues !== null

  const openPopover = () => {
    setDraftValues(new Set(selectedValues ?? options.map((option) => option.value)))
    setSearchText('')
    setIsOpen(true)
  }

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return
    const buttonRect = buttonRef.current.getBoundingClientRect()
    const maxLeft = window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_MARGIN_PX
    setPopoverPosition({
      top: buttonRect.bottom + 4,
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(buttonRect.left, maxLeft)),
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOpen(false) }
    const closeOnScroll = (event: Event) => { if (!popoverRef.current?.contains(event.target as Node)) setIsOpen(false) }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [isOpen])

  const visibleOptions = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.label.toLowerCase().includes(query))
  }, [options, searchText])

  const toggleDraftValue = (value: string) =>
    setDraftValues((previous) => {
      const next = new Set(previous)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  const selectAllVisible = () => setDraftValues((previous) => new Set([...previous, ...visibleOptions.map((option) => option.value)]))
  const clearAllVisible = () =>
    setDraftValues((previous) => {
      const next = new Set(previous)
      for (const option of visibleOptions) next.delete(option.value)
      return next
    })

  const applyDraft = () => {
    const isEveryOptionSelected = options.every((option) => draftValues.has(option.value))
    onApply(isEveryOptionSelected ? null : [...draftValues])
    setIsOpen(false)
  }
  const sortAndClose = (direction: SheetSortDirection) => {
    onSort(direction)
    setIsOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openPopover())}
        title={`${columnLabel}で絞り込み・並べ替え`}
        aria-label={`${columnLabel}で絞り込み・並べ替え`}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] leading-none ${
          isActive ? 'bg-emerald-500 text-white' : INACTIVE_BUTTON_CLASS_BY_TONE[tone]
        }`}
      >
        {isActive ? '▼' : sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '▾'}
      </button>
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          style={{ top: popoverPosition.top, left: popoverPosition.left, width: POPOVER_WIDTH_PX }}
          className="fixed z-[1000] rounded-md border border-slate-200 bg-white text-left text-xs font-normal text-slate-700 shadow-xl"
        >
          <div className="border-b border-slate-100 py-1">
            <button type="button" onClick={() => sortAndClose('asc')} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${sortDirection === 'asc' ? 'font-bold text-emerald-700' : ''}`}>
              A → Z で並べ替え
            </button>
            <button type="button" onClick={() => sortAndClose('desc')} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${sortDirection === 'desc' ? 'font-bold text-emerald-700' : ''}`}>
              Z → A で並べ替え
            </button>
          </div>
          <div className="space-y-1.5 p-2">
            <div className="font-semibold text-slate-600">値でフィルタ</div>
            <div className="flex gap-3 text-emerald-700">
              <button type="button" onClick={selectAllVisible} className="hover:underline">すべて選択</button>
              <button type="button" onClick={clearAllVisible} className="hover:underline">クリア</button>
              <span className="ml-auto text-slate-400">{options.filter((option) => draftValues.has(option.value)).length} / {options.length}</span>
            </div>
            <input
              type="search"
              autoFocus
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="値を検索"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            />
            <ul className="max-h-60 overflow-y-auto rounded border border-slate-100">
              {visibleOptions.length === 0 && <li className="px-2 py-2 text-slate-400">該当する値がありません</li>}
              {visibleOptions.map((option) => (
                <li key={option.value}>
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-slate-50">
                    <input type="checkbox" checked={draftValues.has(option.value)} onChange={() => toggleDraftValue(option.value)} />
                    <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                    <span className="shrink-0 text-slate-400">{option.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 p-2">
            <button type="button" onClick={() => setIsOpen(false)} className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100">キャンセル</button>
            <button
              type="button"
              onClick={applyDraft}
              disabled={draftValues.size === 0}
              className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              OK
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
