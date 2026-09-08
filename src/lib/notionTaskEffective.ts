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
  // 提出済スナップショット。キーは修正後フィールド名(title/assignee_name/workload/start_date/end_date/progress_rate)、
  // 値は提出時点の修正後値を文字列化したもの(バックエンドの to_f.to_s 等と同じ規則)。
  wbs_submitted_overrides?: Record<string, string> | null
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

// バックエンドの to_f.to_s と同じ規則で修正後値を文字列化する(提出済スナップショットとの比較用)。
// Ruby: 2.to_f.to_s="2.0", 2.5.to_f.to_s="2.5" と揃えるため、整数値は "N.0" にする。
function serializeOverride(value: string | number | null | undefined): string {
  if (typeof value === 'number') return Number.isInteger(value) ? `${value}.0` : String(value)
  return String(value)
}

// 修正後の値が提出済スナップショット(wbs_submitted_overrides)とまだ一致しない(=未提出の変更がある)か。
export function hasUnsubmittedChange(task: NotionTaskEffectiveSource, field: NotionTaskEffectiveField): boolean {
  if (!hasTaskOverride(task, field)) return false
  const previousValueKey = PREV_FIELD_KEY[field] as keyof NotionTaskEffectiveSource
  const currentOverrideValue = task[previousValueKey] as string | number | null | undefined
  return serializeOverride(currentOverrideValue) !== task.wbs_submitted_overrides?.[field]
}
