// 進捗カンバンの共有定義。ProgressPage / KanbanBoard / TaskCard で同じ型と列定義を使う。
export type BLTask = {
  id: number
  issue_key: string
  summary: string
  status_id: number
  status_name: string
  progress: number
  position: number | null
  created_on: string | null
  completed_on: string | null
  due_date: string | null
  start_date: string | null
  end_date: string | null
  // 前回同期からの変更前の値。入っていればカードに「修正前 → 修正後」を出す
  start_date_prev: string | null
  end_date_prev: string | null
  memo: string | null
  deploy_date: string | null
  deploy_note: string | null
  source: string | null
  assignee_name: string | null
  assignee_id: number | null
  url: string | null
  did_previous: boolean
  do_today: boolean
  trello_list_name: string | null
}

// ステータス列。id はサーバの status_id と一致させる。
export const COLUMNS = [
  { id: 1, label: '未対応', color: 'border-t-gray-400', bg: 'bg-gray-50', badge: 'bg-gray-200 text-gray-700', tabActive: 'bg-gray-500 text-white', tabInactive: 'text-gray-500' },
  { id: 2, label: '処理中', color: 'border-t-blue-500', bg: 'bg-blue-50/50', badge: 'bg-blue-100 text-blue-700', tabActive: 'bg-blue-500 text-white', tabInactive: 'text-blue-500' },
  { id: 3, label: '処理済', color: 'border-t-amber-500', bg: 'bg-amber-50/50', badge: 'bg-amber-100 text-amber-700', tabActive: 'bg-amber-500 text-white', tabInactive: 'text-amber-600' },
  { id: 4, label: '完了', color: 'border-t-emerald-500', bg: 'bg-emerald-50/50', badge: 'bg-emerald-100 text-emerald-700', tabActive: 'bg-emerald-500 text-white', tabInactive: 'text-emerald-600' },
] as const

// 完了列だけは completed_on の新しい順に並べるので、手動の並び替えは効かない。
export const COMPLETED_STATUS_ID = 4

export const PROGRESS_OPTIONS = [
  { value: 0, label: '0%' },
  { value: 20, label: '20% 調査中' },
  { value: 40, label: '40% 実装中' },
  { value: 60, label: '60% 実装完了' },
  { value: 80, label: '80% エビデンス完了' },
  { value: 100, label: '100% 完了' },
] as const

// サーバの並び順 order(:status_id, COALESCE(position, 9999), :issue_key) をそのまま再現する。
// 楽観更新でも同じ規則で並べておけば、次に取り直したときに順番が飛ばない。
const NO_POSITION = 9999
export const sortTasks = (tasks: BLTask[]): BLTask[] =>
  [...tasks].sort((left, right) =>
    left.status_id - right.status_id ||
    (left.position ?? NO_POSITION) - (right.position ?? NO_POSITION) ||
    left.issue_key.localeCompare(right.issue_key))

// 画面に出ているカードの並びを、絞り込みで隠れている分も含めた「その列の全 id」に写し直す。
// サーバは受け取った id に position を 0..n-1 で振るので、見えている分だけ送ると
// 隠れているカードと位置がぶつかり、次に開いたとき別の並びになってしまう。
//
// tasks              … 列に関係なく現在キャッシュしている全タスク(サーバと同じ並び)
// visibleOrderedIds  … ドロップ後の、その列で画面に出ている id の並び
// droppedInTaskId    … 別の列から入ってきたタスク(同一列の並び替えなら undefined)
export const wholeColumnOrder = (
  tasks: BLTask[],
  statusId: number,
  visibleOrderedIds: number[],
  droppedInTaskId?: number,
): number[] => {
  const visibleIds = new Set(visibleOrderedIds)
  const currentColumnIds = tasks
    .filter((task) => task.status_id === statusId && task.id !== droppedInTaskId)
    .map((task) => task.id)

  // 見えているカードが占めていた位置だけを新しい順で埋め直す。隠れているカードは動かさない。
  const incomingOrder = visibleOrderedIds.filter((id) => id !== droppedInTaskId)
  let nextIncoming = 0
  const reordered = currentColumnIds.map((id) => (visibleIds.has(id) ? incomingOrder[nextIncoming++] : id))
  if (droppedInTaskId === undefined) return reordered

  // 落とした位置は「画面上でひとつ上にあったカードの直後」として列全体に反映する
  const cardAbove = visibleOrderedIds[visibleOrderedIds.indexOf(droppedInTaskId) - 1]
  const insertAt = cardAbove === undefined ? 0 : reordered.indexOf(cardAbove) + 1
  return [...reordered.slice(0, insertAt), droppedInTaskId, ...reordered.slice(insertAt)]
}
