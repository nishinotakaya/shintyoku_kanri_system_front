import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'

// 受領注文書(ラボップ発行 = received_purchase_orders)を「検索つきセレクトボックス」で選ぶ入力。
// 各候補は 番号 / 件名 / 期間 を表示し、選ぶと value に order_no が入る。
// 手入力もそのまま許容する（自由入力の注文番号にも対応）。
export type ReceivedPurchaseOrder = {
  id: number
  order_no: string
  customer_name: string | null
  subject: string | null
  category: string | null
  period_start: string | null
  period_end: string | null
}

type Props = {
  value: string
  onChange: (orderNo: string) => void
  category?: string | null      // 指定時はまず同カテゴリを優先表示
  placeholder?: string
}

function periodLabel(po: ReceivedPurchaseOrder): string {
  if (po.period_start && po.period_end) return `${po.period_start}〜${po.period_end}`
  if (po.period_end) return `〜${po.period_end}`
  if (po.period_start) return `${po.period_start}〜`
  return '期限未設定'
}

export default function PurchaseOrderSelect({ value, onChange, category, placeholder }: Props) {
  const [orders, setOrders] = useState<ReceivedPurchaseOrder[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    api.get<ReceivedPurchaseOrder[]>('/received_purchase_orders')
      .then((r) => setOrders(r.data ?? []))
      .catch(() => setOrders([]))
  }, [])

  // 外側クリックで閉じる
  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const sameCategoryFirst = [...orders].sort((a, b) => {
      const aHit = category && a.category === category ? 0 : 1
      const bHit = category && b.category === category ? 0 : 1
      return aHit - bHit
    })
    if (!keyword) return sameCategoryFirst
    return sameCategoryFirst.filter((po) =>
      [po.order_no, po.subject, po.customer_name].filter(Boolean).some((text) => text!.toLowerCase().includes(keyword)),
    )
  }, [orders, query, category])

  const pick = (po: ReceivedPurchaseOrder) => {
    onChange(po.order_no)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={open ? query : value}
        onChange={(e) => {
          const typed = e.target.value
          setQuery(typed)
          // 手入力した値もそのまま注文番号として反映する（候補クリックだけでなく自由入力を許容）
          onChange(typed)
          if (!open) setOpen(true)
        }}
        onFocus={() => { setQuery(''); setOpen(true) }}
        placeholder={placeholder ?? '注文番号で検索、または選択'}
        className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[var(--color-border)] bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-[var(--color-text-sub)]">
              該当なし{query.trim() ? `（「${query.trim()}」を注文番号として使用）` : ''}
            </div>
          ) : (
            filtered.map((po) => (
              <button
                key={po.id}
                type="button"
                onClick={() => pick(po)}
                className={`block w-full border-b border-gray-100 px-2 py-1 text-left text-[11px] hover:bg-sky-50 ${po.order_no === value ? 'bg-sky-50' : ''}`}
              >
                <span className="font-mono font-semibold text-sky-700">{po.order_no}</span>
                {po.subject && <span className="ml-1 text-[var(--color-text)]">／ {po.subject}</span>}
                <span className="ml-1 text-[10px] text-[var(--color-text-sub)]">／ 期限 {periodLabel(po)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
