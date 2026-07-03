import { useEffect, useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import PurchaseOrderForm from './PurchaseOrderForm'

type CategoryKey = 'wings' | 'living' | 'techleaders' | 'resystems'

export default function PurchaseOrderList({ me, category }: { me: Me | null; category: CategoryKey }) {
  const [positions, setPositions] = useState<number[]>([0])
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(0)

  // カテゴリ切替で既存注文書の枚数を取得
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

  // 注文書カードをドラッグで並び替え → サーバの position を更新
  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const from = result.source.index
    const to = result.destination.index
    if (from === to) return
    const next = [...positions]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setPositions(next)  // 楽観更新
    try {
      const res = await api.patch('/purchase_order_settings/reorder', { positions: next }, { params: { category } })
      const arr = Array.isArray(res.data) ? res.data : []
      if (arr.length > 0) setPositions(arr.map((s: any) => s.position ?? 0).sort((a: number, b: number) => a - b))
    } catch {
      // 失敗したら元に戻す
      setPositions(positions)
    }
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
          <div className="text-sm font-semibold text-[var(--color-text)]">注文書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {positions.length} 件
            {totalPages > 1 && <span className="ml-2">／ {safePage + 1} / {totalPages} ページ</span>}
          </div>
        </div>
        <button
          onClick={addSheet}
          className="rounded-md whitespace-nowrap border border-dashed border-[var(--color-primary)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg)]"
        >
          ＋ 注文書を追加
        </button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId={`po-cards-${category}`}>
          {(dropProvided) => (
            <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-3">
              {visible.map((pos, idx) => (
                <Draggable key={`${category}-${pos}`} draggableId={`${category}-${pos}`} index={pageStart + idx}>
                  {(p, snapshot) => (
                    <div
                      ref={p.innerRef}
                      {...p.draggableProps}
                      style={p.draggableProps.style}
                      className={snapshot.isDragging ? 'ring-2 ring-fuchsia-400 rounded-2xl' : ''}
                    >
                      <div className="flex items-stretch gap-2">
                        <div
                          {...p.dragHandleProps}
                          className="flex w-6 cursor-grab select-none items-center justify-center rounded-l-2xl bg-gradient-to-b from-fuchsia-100 to-pink-100 text-fuchsia-500 hover:from-fuchsia-200 hover:to-pink-200 active:cursor-grabbing"
                          title="ドラッグで注文書の並び順を変更"
                        >⋮⋮</div>
                        <div className="flex-1 min-w-0">
                          <PurchaseOrderForm
                            me={me}
                            category={category}
                            position={pos}
                            onRemove={pos === 0 && positions.length === 1 ? undefined : () => removeSheet(pos)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

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
