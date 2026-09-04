import { useEffect, useState } from 'react'
import { subscribeToasts } from '../lib/toast'
import type { ToastItem } from '../lib/toast'

const KIND_STYLE: Record<ToastItem['kind'], string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-gray-800 text-white',
}
const KIND_ICON: Record<ToastItem['kind'], string> = { success: '✅', error: '⚠️', info: 'ℹ️' }

// フラッシュメッセージの表示ホスト。App 直下に1つだけ置く。
// スマホの親指圏を避けて画面下部中央・safe-area 考慮。
export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribeToasts(setItems), [])
  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <div
          key={item.id}
          className={`ttc-pop pointer-events-auto max-w-full rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg ${KIND_STYLE[item.kind]}`}
        >
          {KIND_ICON[item.kind]} {item.message}
        </div>
      ))}
    </div>
  )
}
