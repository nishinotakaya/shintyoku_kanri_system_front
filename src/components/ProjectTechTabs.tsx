import { useState } from 'react'
import TagSelectField from './TagSelectField'
import { splitTags } from '../lib/tagSplit'

// 技術欄をカテゴリ別タブで分けて編集する。各カテゴリはタグ選択(候補=マスタ+再集計stack)+自由入力。
const TABS = [
  { key: 'languages', label: '使用言語' },
  { key: 'db', label: 'DB' },
  { key: 'server_os', label: 'サーバOS' },
  { key: 'tools', label: 'FW・MW・ツール' },
] as const

type TabKey = typeof TABS[number]['key']

type Props = {
  values: Record<TabKey, string | null>
  candidates: Record<string, string[]>
  onChange: (field: TabKey, value: string) => void
}

export default function ProjectTechTabs({ values, candidates, onChange }: Props) {
  const [tab, setTab] = useState<TabKey>('languages')
  const active = TABS.find((t) => t.key === tab)!
  const count = (key: TabKey) => splitTags(values[key], candidates[key] ?? []).length

  return (
    <div className="rounded-md border border-[var(--color-border)] p-1.5">
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              tab === t.key ? 'bg-fuchsia-500 text-white' : 'bg-gray-100 text-[var(--color-text-sub)] hover:bg-gray-200'
            }`}>
            {t.label}{count(t.key) ? ` (${count(t.key)})` : ''}
          </button>
        ))}
      </div>
      <div className="mt-1.5">
        <TagSelectField label={active.label} value={values[tab] ?? ''} candidates={candidates[tab] ?? []}
          onChange={(v) => onChange(tab, v)} />
      </div>
    </div>
  )
}
