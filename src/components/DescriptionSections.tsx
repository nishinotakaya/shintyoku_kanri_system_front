import { useEffect, useRef, useState } from 'react'
import AutoGrowTextarea from './AutoGrowTextarea'

// 業務内容(description)を ≪案件概要≫/≪担当業務≫/≪コメント≫ に分けて編集する。
// 値は1本の description 文字列のまま保持し、マーカー付きで相互変換する（改行はそのまま保持）。
// ≪経験・スキル≫/≪習得スキル≫ は技術欄へ分離する方針のため、編集対象に出さず破棄する。
const SECTIONS = [
  { key: 'overview', label: '案件概要', marker: '≪案件概要≫' },
  { key: 'duties', label: '担当業務', marker: '≪担当業務≫' },
  { key: 'comment', label: 'コメント', marker: '≪コメント≫' },
] as const

// 区切りとしては認識するが、内容は捨てるマーカー
const DROP_MARKERS = ['≪経験・スキル≫', '≪習得スキル≫']

type SecKey = typeof SECTIONS[number]['key']
type Sec = Record<SecKey, string>

function parse(desc: string | null): Sec {
  const text = desc ?? ''
  const out = Object.fromEntries(SECTIONS.map((s) => [s.key, ''])) as Sec
  const markers = [
    ...SECTIONS.map((s) => ({ key: s.key as SecKey | '__drop__', marker: s.marker })),
    ...DROP_MARKERS.map((m) => ({ key: '__drop__' as SecKey | '__drop__', marker: m })),
  ]
  const found = markers
    .map((m) => ({ ...m, at: text.indexOf(m.marker) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
  if (found.length === 0) { out.overview = text; return out }
  const pre = text.slice(0, found[0].at).replace(/\s+$/, '')
  found.forEach((m, i) => {
    const start = m.at + m.marker.length
    const end = i + 1 < found.length ? found[i + 1].at : text.length
    if (m.key === '__drop__') return // ≪経験・スキル≫ 等は破棄
    out[m.key as SecKey] = text.slice(start, end).replace(/^\n/, '').replace(/\n+$/, '')
  })
  if (pre.trim()) out.overview = (pre + (out.overview ? '\n' + out.overview : '')).replace(/^\n+/, '')
  return out
}

function compose(sec: Sec): string {
  return SECTIONS
    .filter((s) => (sec[s.key] ?? '').trim())
    .map((s) => `${s.marker}\n${sec[s.key]}`)
    .join('\n\n')
}

type Props = { value: string | null; onChange: (next: string) => void }

export default function DescriptionSections({ value, onChange }: Props) {
  const [sec, setSec] = useState<Sec>(() => parse(value))
  const lastComposed = useRef<string>(value ?? '')

  // 外部から value が変わったとき（読み込み/AI反映等）だけ再パース。自前の onChange ではループしない。
  useEffect(() => {
    if ((value ?? '') !== lastComposed.current) {
      setSec(parse(value))
      lastComposed.current = value ?? ''
    }
  }, [value])

  const update = (key: SecKey, v: string) => {
    const next = { ...sec, [key]: v }
    setSec(next)
    const composed = compose(next)
    lastComposed.current = composed
    onChange(composed)
  }

  return (
    <div className="space-y-1.5">
      {SECTIONS.map((s) => (
        <label key={s.key} className="block text-[10px] text-[var(--color-text-sub)]">
          {s.label}
          <AutoGrowTextarea value={sec[s.key]} onChange={(e) => update(s.key, e.target.value)} minRows={2}
            placeholder={s.label}
            className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)]" />
        </label>
      ))}
    </div>
  )
}
