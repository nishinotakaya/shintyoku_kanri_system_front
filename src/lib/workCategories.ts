// ユーザーごとに見える勤怠カテゴリ（work_categories）の定義。
// work_categories が未設定(null/undefined)のユーザーは従来どおり DEFAULT_WORK_CATEGORIES(4つ)が見える。

// 既存4カテゴリ + プロアカ(proaka) + 運送(transport)
export const WORK_CATEGORY_KEYS = ['wings', 'living', 'techleaders', 'resystems', 'proaka', 'transport'] as const

export type WorkCategory = (typeof WORK_CATEGORY_KEYS)[number]

export function isWorkCategory(value: string): value is WorkCategory {
  return (WORK_CATEGORY_KEYS as readonly string[]).includes(value)
}

// 表示ラベル。既存4つは現状コード(Dashboard.tsx / SettingsModal.tsx)の表記をそのまま採用。
export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
  proaka: 'プロアカ',
  transport: '運送',
}

// work_categories 未設定ユーザーの既定カテゴリ(従来どおりの4つ)
export const DEFAULT_WORK_CATEGORIES: WorkCategory[] = ['wings', 'living', 'techleaders', 'resystems']

// visibleWorkCategories() の引数は Me 型そのものではなく、
// work_categories だけを持つ最小の形にしておく(AdminUser など他の型でもそのまま渡せるようにするため)。
type HasWorkCategories = { work_categories?: string[] | null }

// ログイン中ユーザーが閲覧できる勤怠カテゴリ。
// work_categories が設定されていればそれを(不正な値は除外)、無ければ従来の4カテゴリを返す。
export function visibleWorkCategories(me: HasWorkCategories | null | undefined): WorkCategory[] {
  const configured = me?.work_categories?.filter(isWorkCategory)
  return configured && configured.length > 0 ? configured : DEFAULT_WORK_CATEGORIES
}

// 勤怠入力フォームの項目ラベル(作業内容・乗車区間・交通費)。カテゴリ別の上書きが無ければ既定ラベルを返す。
type WorkReportFieldKey = 'content' | 'transit_section' | 'transit_fee'

const DEFAULT_FIELD_LABELS: Record<WorkReportFieldKey, string> = {
  content: '作業内容',
  transit_section: '乗車区間',
  transit_fee: '交通費',
}

export const FIELD_LABELS_BY_CATEGORY: Partial<Record<WorkCategory, Partial<Record<WorkReportFieldKey, string>>>> = {
  transport: {
    content: '配送内容・件数',
    transit_section: 'コース・エリア',
    transit_fee: 'ガソリン代',
  },
}

export function fieldLabel(category: WorkCategory, field: WorkReportFieldKey): string {
  return FIELD_LABELS_BY_CATEGORY[category]?.[field] ?? DEFAULT_FIELD_LABELS[field]
}
