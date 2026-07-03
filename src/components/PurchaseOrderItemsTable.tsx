import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'

export type PurchaseOrderItem = {
  description: string
  qty: number
  unit: string
  unit_price: number
  amount: number
}

type Props = {
  items: PurchaseOrderItem[]
  onChange: (next: PurchaseOrderItem[]) => void
  deliveryDeadline: string
}

const GRID_COLS = 'grid grid-cols-[24px_minmax(0,1fr)_5rem_5rem_7rem_8rem_2rem]'

const fmtYen = (n: number) => '¥' + n.toLocaleString()

export default function PurchaseOrderItemsTable({ items, onChange, deliveryDeadline }: Props) {
  const subtotal = items.reduce((acc, it) => acc + (it.amount || 0), 0)
  const tax = Math.round(subtotal * 0.1)
  const total = subtotal + tax

  const updateItem = (index: number, patch: Partial<PurchaseOrderItem>) => {
    onChange(items.map((it, idx) => {
      if (idx !== index) return it
      const updated = { ...it, ...patch }
      if ('qty' in patch || 'unit_price' in patch) {
        updated.amount = (Number(updated.qty) || 0) * (Number(updated.unit_price) || 0)
      }
      return updated
    }))
  }

  const addItem = () => onChange([...items, { description: '', qty: 0, unit: '', unit_price: 0, amount: 0 }])
  const removeItem = (index: number) => onChange(items.filter((_, idx) => idx !== index))

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const from = result.source.index
    const to = result.destination.index
    if (from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--color-text-sub)]">
          明細 — 納品期限: <span className="font-mono">{deliveryDeadline}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button onClick={addItem} className="text-fuchsia-500 hover:text-fuchsia-400">＋ 行を追加</button>
        </div>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-[var(--color-border)] text-xs">
        <div className={`${GRID_COLS} bg-gray-50 text-[var(--color-text-sub)]`}>
          <div></div>
          <div className="px-3 py-2 text-left">摘要</div>
          <div className="px-3 py-2 text-right">数量</div>
          <div className="px-3 py-2 text-left">単位</div>
          <div className="px-3 py-2 text-right">単価</div>
          <div className="px-3 py-2 text-right">明細金額</div>
          <div></div>
        </div>

        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="po-items">
            {(dropProvided) => (
              <div ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
                {items.map((it, i) => (
                  <Draggable key={`po-item-${i}`} draggableId={`po-item-${i}`} index={i}>
                    {(p, snapshot) => (
                      <div
                        ref={p.innerRef}
                        {...p.draggableProps}
                        style={p.draggableProps.style}
                        className={`${GRID_COLS} items-center border-t border-[var(--color-border)] ${snapshot.isDragging ? 'bg-fuchsia-50 shadow ring-1 ring-fuchsia-300' : 'bg-white'}`}
                      >
                        <div
                          {...p.dragHandleProps}
                          className="flex h-full cursor-grab select-none items-center justify-center text-[var(--color-text-sub)] hover:text-fuchsia-500 active:cursor-grabbing"
                          title="ドラッグで並べ替え"
                        >⋮⋮</div>
                        <div className="px-2 py-1">
                          <input value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 focus:border-[var(--color-border)] focus:bg-white" />
                        </div>
                        <div className="px-2 py-1">
                          <input type="number" value={it.qty || ''} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right font-mono tabular-nums focus:border-[var(--color-border)] focus:bg-white" />
                        </div>
                        <div className="px-2 py-1">
                          <input value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 focus:border-[var(--color-border)] focus:bg-white" />
                        </div>
                        <div className="px-2 py-1">
                          <input type="number" value={it.unit_price || ''} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right font-mono tabular-nums focus:border-[var(--color-border)] focus:bg-white" />
                        </div>
                        <div className="px-2 py-1 text-right font-mono tabular-nums text-[var(--color-text-sub)]">
                          {it.amount ? it.amount.toLocaleString() : ''}
                        </div>
                        <div className="px-2 py-1 text-center">
                          <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-500" title="削除">×</button>
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

        <div className={`${GRID_COLS} border-t border-[var(--color-border)] bg-gray-50 text-[var(--color-text-sub)]`}>
          <div></div><div></div><div></div><div></div>
          <div className="px-3 py-1.5 text-right">小計</div>
          <div className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtYen(subtotal)}</div>
          <div></div>
        </div>
        <div className={`${GRID_COLS} bg-gray-50 text-[var(--color-text-sub)]`}>
          <div></div><div></div><div></div><div></div>
          <div className="px-3 py-1.5 text-right">10% 消費税</div>
          <div className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtYen(tax)}</div>
          <div></div>
        </div>
        <div className={`${GRID_COLS} bg-gray-50`}>
          <div></div><div></div><div></div><div></div>
          <div className="px-3 py-1.5 text-right font-semibold text-amber-600">発注金額</div>
          <div className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-amber-600">{fmtYen(total)}</div>
          <div></div>
        </div>
      </div>
    </div>
  )
}
