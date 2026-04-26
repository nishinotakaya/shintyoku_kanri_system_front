import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import PurchaseOrderForm from './PurchaseOrderForm'

type CategoryKey = 'wings' | 'living' | 'techleaders' | 'resystems'

export default function PurchaseOrderList({ me, category }: { me: Me | null; category: CategoryKey }) {
  const [positions, setPositions] = useState<number[]>([0])
  const [loaded, setLoaded] = useState(false)

  // カテゴリ切替で既存発注書の枚数を取得
  useEffect(() => {
    setLoaded(false)
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

  return (
    <div className="space-y-4">
      {positions.map(pos => (
        <PurchaseOrderForm
          key={`${category}-${pos}`}
          me={me}
          category={category}
          position={pos}
          onRemove={pos === 0 && positions.length === 1 ? undefined : () => removeSheet(pos)}
        />
      ))}
      <div className="flex justify-center">
        <button
          onClick={addSheet}
          className="rounded-full border-2 border-dashed border-[var(--color-primary)] bg-white px-6 py-2.5 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg)]"
        >
          ＋ 発注書を追加
        </button>
      </div>
    </div>
  )
}
