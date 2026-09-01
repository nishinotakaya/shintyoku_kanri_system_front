// 管理者が他ユーザーとしてログインする(なりすまし)ための状態管理。
// 管理者自身のトークンを退避しておき、「管理者に戻る」やログアウトで元のアカウントに戻す。
import { api } from './api'

const ADMIN_TOKEN_KEY = 'jwt_admin'
const IMPERSONATION_KEY = 'impersonation'

export type Impersonation = {
  id: number
  display_name: string
  email: string
  admin_display_name: string
}

export function currentImpersonation(): Impersonation | null {
  const raw = localStorage.getItem(IMPERSONATION_KEY)
  if (!raw || !localStorage.getItem(ADMIN_TOKEN_KEY)) return null
  try {
    return JSON.parse(raw) as Impersonation
  } catch {
    return null
  }
}

export function isImpersonating(): boolean {
  return currentImpersonation() !== null
}

// 管理者のトークンを退避 → 対象ユーザーのトークンに差し替える
export async function startImpersonation(userId: number): Promise<Impersonation> {
  const adminToken = localStorage.getItem('jwt')
  if (!adminToken) throw new Error('ログインしていません')

  const res = await api.post('/admin/impersonations', { user_id: userId })
  const { token, user, admin } = res.data as {
    token: string
    user: { id: number; display_name: string; email: string }
    admin: { id: number; display_name: string }
  }
  const impersonation: Impersonation = {
    id: user.id,
    display_name: user.display_name,
    email: user.email,
    admin_display_name: admin.display_name,
  }
  localStorage.setItem(ADMIN_TOKEN_KEY, adminToken)
  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(impersonation))
  localStorage.setItem('jwt', token)
  return impersonation
}

// なりすましを終了して管理者アカウントに戻す。
// なりすまし用トークンはサーバ側でも失効させる(使い回されないように)。
export async function stopImpersonation(): Promise<boolean> {
  const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY)
  if (!adminToken) return false

  try {
    await api.delete('/auth/sign_out')
  } catch {
    // 失効に失敗しても管理者には戻す
  }
  localStorage.setItem('jwt', adminToken)
  localStorage.removeItem(ADMIN_TOKEN_KEY)
  localStorage.removeItem(IMPERSONATION_KEY)
  return true
}
