import { useState } from 'react'
import type { SkillSheetReviewItem } from '../lib/api'
import AutoGrowTextarea from './AutoGrowTextarea'

// AI/手動の「指摘」を行データとして表示・インライン編集・CRUD し、
// 編集後の改善版をワンクリックで該当欄へ反映する。
type FieldOption = { value: string; label: string }
type Props = {
  items: SkillSheetReviewItem[]
  fieldOptions: FieldOption[]
  onApply: (item: SkillSheetReviewItem) => void
  onUpdate: (id: number, patch: Partial<SkillSheetReviewItem>) => void
  onDelete: (id: number) => void
  onAdd: () => void
  busy?: boolean
}

type Editable = 'target' | 'field' | 'issues' | 'suggestion'
const INPUT = 'w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs'

export default function ReviewItemsTable({ items, fieldOptions, onApply, onUpdate, onDelete, onAdd, busy }: Props) {
  // id ごとの編集ドラフト（キーストロークごとに API は叩かず、blur で保存）
  const [drafts, setDrafts] = useState<Record<number, Partial<Record<Editable, string>>>>({})

  const val = (it: SkillSheetReviewItem, key: Editable) =>
    (drafts[it.id]?.[key] ?? (it[key] ?? '')) as string
  const edit = (id: number, key: Editable, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }))
  const flush = (it: SkillSheetReviewItem, key: Editable) => {
    const v = drafts[it.id]?.[key]
    if (v !== undefined && v !== (it[key] ?? '')) onUpdate(it.id, { [key]: v } as Partial<SkillSheetReviewItem>)
  }
  const apply = (it: SkillSheetReviewItem) => {
    const pending = drafts[it.id]
    if (pending && Object.keys(pending).length) onUpdate(it.id, pending as Partial<SkillSheetReviewItem>)
    onApply({ ...it, ...(pending as Partial<SkillSheetReviewItem>) })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--color-text)]">指摘一覧（{items.length}）</div>
        <button onClick={onAdd} disabled={busy} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] disabled:opacity-50">＋ 指摘を追加</button>
      </div>
      {items.length === 0 && (
        <div className="text-[11px] text-[var(--color-text-sub)]">まだ指摘はありません。「AIで添削する」か「＋指摘を追加」で作成できます。</div>
      )}
      {items.map((it) => (
        <div key={it.id} className="rounded-lg border border-[var(--color-border)] p-2 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={val(it, 'target')} onChange={(e) => edit(it.id, 'target', e.target.value)} onBlur={() => flush(it, 'target')}
              placeholder="対象" className="flex-1 min-w-[120px] rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold" />
            {it.source === 'ai' && <span className="rounded-full bg-violet-100 px-1.5 text-[9px] text-violet-700">AI</span>}
            {it.applied && <span className="rounded-full bg-emerald-100 px-1.5 text-[9px] text-emerald-700">反映済</span>}
            <div className="ml-auto flex gap-1">
              <button onClick={() => apply(it)} disabled={!val(it, 'suggestion') || !val(it, 'field')}
                className="rounded-md bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40">↩ 反映</button>
              <button onClick={() => onDelete(it.id)} className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-red-500">削除</button>
            </div>
          </div>
          {/* AI 由来は反映先を編集しないので非表示。手動追加時だけ反映先を選ぶ */}
          {it.source === 'manual' && (
            <label className="block text-[9px] text-[var(--color-text-sub)]">
              反映先
              <select value={val(it, 'field')} onChange={(e) => { edit(it.id, 'field', e.target.value); onUpdate(it.id, { field: e.target.value }) }}
                className={INPUT}>
                {fieldOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[9px] text-[var(--color-text-sub)]">
            指摘内容
            <AutoGrowTextarea value={val(it, 'issues')} onChange={(e) => edit(it.id, 'issues', e.target.value)} onBlur={() => flush(it, 'issues')}
              minRows={2} placeholder="指摘内容" className={INPUT} />
          </label>
          <label className="block text-[9px] text-[var(--color-text-sub)]">
            改善版（編集してから「↩ 反映」できます）
            <AutoGrowTextarea value={val(it, 'suggestion')} onChange={(e) => edit(it.id, 'suggestion', e.target.value)} onBlur={() => flush(it, 'suggestion')}
              minRows={3} placeholder="改善版テキスト（そのまま欄に入る完成形）"
              className={`${INPUT} bg-gray-50`} />
          </label>
        </div>
      ))}
    </div>
  )
}
