import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import PurchaseOrderForm from './PurchaseOrderForm'

type CategoryKey = 'wings' | 'living' | 'techleaders' | 'resystems'

export default function PurchaseOrderList({ me, category }: { me: Me | null; category: CategoryKey }) {
  const [positions, setPositions] = useState<number[]>([0])
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(0)

  // カテゴリ切替で既存発注書の枚数を取得
  useEffect(() => {
    setLoaded(false)
    setPage(0)
    api.get('/purchase_order_settings', { params: { category } })
      .then(r => {
        const arr = Array.isArray(r.data) ? r.data : []
        if (arr.length === 0) {
          setPositions([0])
        } else {
          setPositions(arr.map((s: any) => s.position ?? 0).sort((a: number, b: number) => a - b))
        }
      })
      .catch(() => setPositions([0]))
      .finally(() => setLoaded(true))
  }, [category])

  const addSheet = () => {
    const nextPos = positions.length > 0 ? Math.max(...positions) + 1 : 0
    setPositions([...positions, nextPos])
  }

  const removeSheet = async (pos: number) => {
    try {
      await api.delete('/purchase_order_setting', { params: { category, position: pos } })
    } catch { /* noop */ }
    setPositions(prev => prev.filter(p => p !== pos))
  }

  if (!loaded) return null

  const PER_PAGE = 5
  const totalPages = Math.max(1, Math.ceil(positions.length / PER_PAGE))
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * PER_PAGE
  const visible = positions.slice(pageStart, pageStart + PER_PAGE)

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white/60 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text)]">発注書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {positions.length} 件
            {totalPages > 1 && <span className="ml-2">／ {safePage + 1} / {totalPages} ページ</span>}
          </div>
        </div>
        <button
          onClick={addSheet}
          className="rounded-md whitespace-nowrap border border-dashed border-[var(--color-primary)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg)]"
        >
          ＋ 発注書を追加
        </button>
      </div>

      <div className="space-y-3">
        {visible.map(pos => (
          <PurchaseOrderForm
            key={`${category}-${pos}`}
            me={me}
            category={category}
            position={pos}
            onRemove={pos === 0 && positions.length === 1 ? undefined : () => removeSheet(pos)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1 text-xs text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-40"
          >
            ← 前
          </button>
          {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`rounded-md whitespace-nowrap px-3 py-1 text-xs font-semibold ${
                i === safePage ? 'bg-[var(--color-primary)] text-white shadow' : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-gray-50'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1 text-xs text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-40"
          >
            次 →
          </button>
        </div>
      )}
    </div>
  )
}
