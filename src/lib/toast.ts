// アプリ共通のフラッシュメッセージ(トースト)。追加/更新/削除の完了を画面下部に数秒表示する。
// どこからでも toast.success('保存しました') のように呼べるモジュールシングルトン。
// 表示本体は components/ToastHost.tsx(App 直下に1つだけマウント)。
export type ToastKind = 'success' | 'error' | 'info'
export type ToastItem = { id: number; kind: ToastKind; message: string }

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

const emit = () => listeners.forEach((listener) => listener([...items]))

const push = (kind: ToastKind, message: string) => {
  const id = nextId++
  items = [...items, { id, kind, message }]
  emit()
  setTimeout(() => {
    items = items.filter((item) => item.id !== id)
    emit()
  }, 3200)
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
}

export const subscribeToasts = (listener: Listener): (() => void) => {
  listeners.add(listener)
  listener([...items])
  return () => { listeners.delete(listener) }
}
