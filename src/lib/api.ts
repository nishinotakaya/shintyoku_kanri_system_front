import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/api/v1`
  : '/api/v1'

export const api = axios.create({
  baseURL: apiBaseUrl,
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
}

export type Me = {
  id: number
  email: string
  display_name: string | null
  company_name: string | null
  closing_day: number
  openai_api_key_set?: boolean
  can_issue_orders?: boolean
  postal_code?: string | null
  address?: string | null
}

export type Period = { from: string; to: string }
export type WorkReportResponse = { period: Period; reports: WorkReport[] }
export type ExpenseResponse = { period: Period; expenses: Expense[] }

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

