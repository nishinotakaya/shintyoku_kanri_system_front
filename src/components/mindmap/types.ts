// マインドマップのグラフ表示で使う型と「見た目」の定義。
// 配置計算は useGraphLayout、描画は GraphNodeBox / MindmapGraph が担当する。
export type GraphNode = {
  id: number
  parent_id: number | null
  kind: 'root' | 'question' | 'answer' | 'keyword' | 'followup'
  text: string
  position: number
}

// ノード種別ごとの配色
export const KIND_STYLE: Record<string, string> = {
  root: 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white border-transparent',
  question: 'bg-sky-50 border-sky-300 text-sky-900',
  followup: 'bg-indigo-50 border-indigo-300 text-indigo-900',
  answer: 'bg-white border-[var(--color-border)] text-[var(--color-text)]',
}

// 第1階層の枝ごとに割り当てる色（エッジと左アクセントで枝を追いやすくする）
export const BRANCH_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#f97316', '#6366f1']
