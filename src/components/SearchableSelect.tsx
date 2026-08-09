import { useEffect, useMemo, useRef, useState } from 'react'

// 検索ボックス付きセレクト。ネイティブ<select>の代替で、選択肢が多いときに絞り込んで選べる。
// マインドマップのタイトル切替（InterviewMindmapPage）などで使用。

type Option = { value: number; label: string; checked?: boolean }

// チェック状態での絞り込みタブ。all=全件 / checked=チェック済のみ / unchecked=未チェックのみ
type CheckTabKey = 'all' | 'checked' | 'unchecked'
const CHECK_TAB_KEYS: CheckTabKey[] = ['all', 'checked', 'unchecked']

type Props = {
  options: Option[]
  value: number | null
  onChange: (value: number) => void
  disabled?: boolean
  title?: string
  placeholder?: string // 検索入力のプレースホルダ
  className?: string // トリガーボタンの追加クラス（幅など）
  // チェック絞り込みタブのラベル（例: 全て/撮影済/撮影前）。指定するとドロップダウン内にタブを表示する
  checkTabs?: Record<CheckTabKey, string>
  // 行ごとのチェックボックス切替（撮影済フラグなど）。指定すると各行にチェックボックスを表示する
  onToggleCheck?: (value: number, checked: boolean) => void
}

export default function SearchableSelect({ options, value, onChange, disabled, title, placeholder = '検索…', className = '', checkTabs, onToggleCheck }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [checkTab, setCheckTab] = useState<CheckTabKey>('all')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((option) => option.value === value) ?? null
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return options.filter((option) => {
      if (checkTabs && checkTab === 'checked' && !option.checked) return false
      if (checkTabs && checkTab === 'unchecked' && option.checked) return false
      return keyword === '' || option.label.toLowerCase().includes(keyword)
    })
  }, [options, query, checkTabs, checkTab])
  const tabCounts = useMemo(() => ({
    all: options.length,
    checked: options.filter((option) => option.checked).length,
    unchecked: options.filter((option) => !option.checked).length,
  }), [options])

  // 外側クリック / Escape で閉じる
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // 開いたら検索欄にフォーカスし、前回の検索語をクリア
  useEffect(() => {
    if (open) {
      setQuery('')
      searchInputRef.current?.focus()
    }
  }, [open])

  const selectOption = (option: Option) => {
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={disabled} title={title}
        className={`flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-left text-xs disabled:opacity-50 ${className}`}>
        <span className="flex-1 truncate">{selected ? selected.label : '選択してください'}</span>
        <span className="shrink-0 text-[9px] text-[var(--color-text-sub)]">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(420px,90vw)] rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
          <div className="border-b border-[var(--color-border)] p-1.5">
            <input ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder}
              className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
          </div>
          {checkTabs && (
            <div className="flex gap-1 border-b border-[var(--color-border)] p-1.5">
              {CHECK_TAB_KEYS.map((tabKey) => (
                <button key={tabKey} type="button" onClick={() => setCheckTab(tabKey)}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${checkTab === tabKey ? 'bg-fuchsia-100 font-semibold text-fuchsia-700' : 'text-[var(--color-text-sub)] hover:bg-gray-100'}`}>
                  {checkTabs[tabKey]}（{tabCounts[tabKey]}）
                </button>
              ))}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-sub)]">該当なし</div>}
            {filtered.map((option) => (
              <div key={option.value} className="flex items-center gap-1">
                {onToggleCheck && (
                  <input type="checkbox" checked={!!option.checked}
                    onChange={(e) => onToggleCheck(option.value, e.target.checked)}
                    aria-label={`${option.label} を${checkTabs?.checked ?? 'チェック済'}にする`}
                    title={`チェックで「${checkTabs?.checked ?? 'チェック済'}」にする`}
                    className="ml-1 shrink-0 accent-fuchsia-600" />
                )}
                <button type="button" onClick={() => selectOption(option)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-fuchsia-50 ${option.value === value ? 'bg-fuchsia-50 font-semibold text-fuchsia-700' : 'text-[var(--color-text)]'}`}>
                  {option.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
