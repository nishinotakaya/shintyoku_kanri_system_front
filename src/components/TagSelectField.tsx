import { useMemo, useState } from 'react'
import { splitTags } from '../lib/tagSplit'

// 技術欄(使用言語/DB/サーバOS/FW・MW・ツール)用のタグ入力。
// 値は改行区切り文字列で保持(Exporter がそのまま複数行表示する)。
// 既存データはスペース/スラッシュ/カンマ区切りの 1 本のことがあるので、表示時に分割する(splitTags)。
// 候補セレクト＋＋ボタン、または自由入力＋＋ボタンで追加。各タグは×で削除。
type Props = {
  label: string
  value: string
  candidates: string[]
  onChange: (next: string) => void
}

export default function TagSelectField({ label, value, candidates, onChange }: Props) {
  const tags = useMemo(() => splitTags(value, candidates), [value, candidates])
  const [picked, setPicked] = useState('')
  const [free, setFree] = useState('')

  const add = (raw: string) => {
    const v = raw.trim()
    if (!v || tags.includes(v)) return
    onChange([...tags, v].join('\n'))
  }
  const remove = (t: string) => onChange(tags.filter((x) => x !== t).join('\n'))
  const available = candidates.filter((c) => !tags.includes(c))

  return (
    <div className="rounded-md border border-[var(--color-border)] px-2 py-1.5">
      <div className="text-[10px] text-[var(--color-text-sub)]">{label}</div>
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] text-fuchsia-700">
              {t}
              <button type="button" onClick={() => remove(t)} className="leading-none text-fuchsia-400 hover:text-red-500" aria-label={`${t} を削除`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-1 py-1 text-[11px]">
          <option value="">候補から選択…</option>
          {available.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" onClick={() => { add(picked); setPicked('') }} disabled={!picked}
          className="rounded bg-fuchsia-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40" aria-label="候補を追加">＋</button>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <input value={free} onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(free); setFree('') } }}
          placeholder="一覧に無ければ自由入力で追加"
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-1 py-1 text-[11px]" />
        <button type="button" onClick={() => { add(free); setFree('') }} disabled={!free.trim()}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] disabled:opacity-40" aria-label="自由入力を追加">＋</button>
      </div>
    </div>
  )
}
