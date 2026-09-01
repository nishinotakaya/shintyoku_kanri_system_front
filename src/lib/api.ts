import axios from 'axios'

// VITE_API_BASE_URL 未設定時は同一オリジンの /api/v1 を使う。
// 認証あり api と、契約書の公開ページ用 publicApi (src/lib/contracts.ts) の両方で共有する。
export function resolveApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL
    ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/api/v1`
    : '/api/v1'
}

export const api = axios.create({
  baseURL: resolveApiBaseUrl(),
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => {
    const auth = res.headers['authorization']
    if (auth?.startsWith('Bearer ')) {
      localStorage.setItem('jwt', auth.replace('Bearer ', ''))
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('jwt')
      if (location.pathname !== '/sign_in' && location.pathname !== '/sign_up') {
        location.href = '/sign_in'
      }
    }
    return Promise.reject(err)
  },
)

export type WorkReport = {
  id: number
  work_date: string
  content: string | null
  hours: number | null
  clock_in: string | null
  clock_out: string | null
  break_minutes: number | null
  transit_section: string | null
  transit_fee: number | null
  category: string | null
  // 運送(transport)向け項目
  distance_km: number | null
  delivery_count: number | null
  meter_start: number | null
  meter_end: number | null
  note: string | null
  weekly_payment: boolean | null
  approved: boolean
  approved_at: string | null
  approved_by: { id: number; display_name: string | null } | null
}

export type Expense = {
  id: number
  expense_date: string
  purpose: string | null
  transport_type: string | null
  from_station: string | null
  to_station: string | null
  round_trip: boolean
  receipt_no: string | null
  amount: number
  payee_or_line: string | null
  category: string | null
  company_burden?: boolean
}

export type Me = {
  id: number
  email: string
  display_name: string | null
  company_name: string | null
  closing_day: number
  openai_api_key_set?: boolean
  heygen_api_key_set?: boolean
  heygen_available?: boolean
  trello_api_key_set?: boolean
  trello_api_token_set?: boolean
  trello_board_id?: string | null
  can_issue_orders?: boolean
  postal_code?: string | null
  address?: string | null
  attendance_schedule_url?: string | null
  local_save_dir?: string | null
  admin?: boolean
  feature_flags?: Record<string, boolean>
  can_use_skill_sheet?: boolean
  can_use_interview_mindmap?: boolean
  can_use_youtube_mindmap?: boolean
  can_use_mote_mindmap?: boolean
  can_use_mote_qa_mindmap?: boolean
  can_use_love_youtube_mindmap?: boolean
  can_use_talk_cards_mindmap?: boolean
  viewable_data_sources?: string[]
  calendar_persons?: string[]
  writable_data_sources?: string[]
  sub_admin?: boolean
  gender?: 'male' | 'female' | null
  work_categories?: string[] | null
}

// スキルシート
export type SkillSheetProject = {
  id?: number
  position?: number
  period_from: string | null
  period_to: string | null
  title: string | null
  description: string | null
  role_scale: string | null
  languages: string | null
  db: string | null
  server_os: string | null
  tools: string | null
  phases: Record<string, boolean>
  source?: string | null
  wantedly_work_experience_uuid?: string | null
  anotherworks_resume_id?: string | null
}

export type SkillSheetReview = {
  overall?: string
  sections?: Array<{ target: string; issues?: string[]; suggestion?: string }>
  typos?: string[]
}

export type SkillSheetComment = {
  id: number
  target: string | null
  body: string
  author_name: string | null
  author_user_id: number | null
  created_at: string | null
}

// 添削前(Before)スナップショットの構造
export type SkillSheetSnapshot = {
  engineer_name?: string | null
  age?: string | null
  gender?: string | null
  address?: string | null
  start_date?: string | null
  nearest_station?: string | null
  specialties?: string | null
  skills?: string | null
  duties?: string | null
  self_pr?: string | null
  projects?: SkillSheetProject[]
}

export type SkillSheetTech = {
  id: number
  category: string
  category_label: string
  name: string
  version: string | null
  months_used: number
  experience_label: string
  last_used_on: string | null
}

export type SkillSheet = {
  id: number
  user_id: number
  spreadsheet_url: string | null
  spreadsheet_id: string | null
  gid: string | null
  /** 書き出しテンプレート。engineer=版面ごと生成 / creator=既存テンプレのタブへ値だけ流し込む */
  template_type: 'engineer' | 'creator'
  /** creator のときに値を流し込む先のタブ(gid) */
  export_gid: string | null
  engineer_name: string | null
  age: string | null
  gender: string | null
  address: string | null
  start_date: string | null
  nearest_station: string | null
  specialties: string | null
  skills: string | null
  duties: string | null
  self_pr: string | null
  youtube_self_pr: string | null
  review_result: SkillSheetReview | null
  before_snapshot: SkillSheetSnapshot | null
  reviewed_at: string | null
  synced_at: string | null
  projects: SkillSheetProject[]
  comments: SkillSheetComment[]
  techs: SkillSheetTech[]
  review_items: SkillSheetReviewItem[]
  user?: { id: number; display_name: string | null; email: string }
}

export type SkillSheetReviewItem = {
  id: number
  target: string | null
  field: string | null
  issues: string | null
  suggestion: string | null
  applied: boolean
  source: 'ai' | 'manual'
  position: number
}

export type SkillSheetTarget = {
  id: number
  display_name: string | null
  email: string
  has_sheet: boolean
  can_generate: boolean
}

export const SKILL_SHEET_PHASES = [
  '要件定義', '基本設計', '詳細設計', '実装・単体', '結合テスト', '総合テスト', '保守・運用',
] as const

export type Period = { from: string; to: string }
export type WorkReportResponse = { period: Period; reports: WorkReport[] }
export type ExpenseResponse = { period: Period; expenses: Expense[] }

// /users/pickable で返る登録ユーザー一覧
export type PickableUser = {
  id: number
  display_name: string
  email: string
  admin: boolean
}

// 西野 → 川村への発注書（/attendance の編集対象 = /purchase-orders の表示対象）
// PurchaseOrderSetting + recipient_user 紐付け済み
export type IssuedPurchaseOrderSetting = {
  id: number
  category: string
  position: number
  exists?: boolean
  order_no: string | null
  subject: string | null
  recipient_name: string | null
  recipient_user_id: number | null
  recipient_user_display_name: string | null
  issuer_user_id: number | null
  issuer_user_display_name: string | null
  period_start: string | null
  period_end: string | null
  closing_day?: number | null
  base_monthly: number | null
  rate_per_hour: number | null
  hours_per_cycle: number | null
  total_amount: number | null
  remarks?: string | null
  delivery_location?: string | null
  payment_method?: string | null
  issuer_company?: string | null
  issuer_representative?: string | null
  items?: Array<{ description: string; qty: number; unit: string; unit_price: number; amount: number }>
}

export async function downloadXlsx(path: string, filename: string) {
  const res = await api.get(path, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ローカルのフォルダへ直接保存（GET 用）
export async function saveToFolder(path: string): Promise<string> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await api.get(`${path}${sep}save_local=true`)
  return (res.data as any)?.saved_to || ''
}

