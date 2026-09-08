// Notion(WBS) タスクの「表示値 = 修正後(_prev) があればそれ、無ければ修正前」を返す共通ヘルパー。
// バックエンドの NotionTask#effective_* と同じ規則（空文字/undefined は「未入力」として修正前にフォールバック）。

export type NotionTaskEffectiveSource = {
  title: string
  title_prev?: string | null
  assignee_name: string | null
  assignee_name_prev?: string | null
  workload: number | null
  workload_prev?: number | null
  start_date: string | null
  start_date_prev: string | null
  end_date: string | null
  end_date_prev: string | null
  progress_rate: number | null
  progress_rate_prev: number | null
  status: string | null
  status_prev: string | null
}

const PREV_FIELD_KEY = {
  title: 'title_prev',
  assignee_name: 'assignee_name_prev',
  workload: 'workload_prev',
  start_date: 'start_date_prev',
  end_date: 'end_date_prev',
  progress_rate: 'progress_rate_prev',
  status: 'status_prev',
} as const

export type NotionTaskEffectiveField = keyof typeof PREV_FIELD_KEY

// 修正後(_prev)が「入力あり」とみなせるか(空文字/null/undefinedは未入力)
export function hasTaskOverride(task: NotionTaskEffectiveSource, field: NotionTaskEffectiveField): boolean {
  const previousValueKey = PREV_FIELD_KEY[field] as keyof NotionTaskEffectiveSource
  const previousValue = task[previousValueKey]
  return previousValue !== null && previousValue !== undefined && previousValue !== ''
}

// 表示に使う実効値。修正後があればそれ、無ければ修正前の値を返す。
export function effectiveTaskValue<Field extends NotionTaskEffectiveField>(
  task: NotionTaskEffectiveSource,
  field: Field,
): NotionTaskEffectiveSource[Field] {
  if (hasTaskOverride(task, field)) {
    const previousValueKey = PREV_FIELD_KEY[field] as keyof NotionTaskEffectiveSource
    return task[previousValueKey] as NotionTaskEffectiveSource[Field]
  }
  return task[field]
}
