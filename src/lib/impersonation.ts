// 管理者が他ユーザーとしてログインする(なりすまし)ための状態管理。
//
// 状態の正は「サーバが発行したトークンに埋め込まれた impersonator_id」であって localStorage ではない。
// localStorage はバナー表示を速くするためのキャッシュにすぎず、消えてもサーバ側だけで管理者に戻れる。
import { api } from './api'

const ADMIN_TOKEN_KEY = 'jwt_admin'
const IMPERSONATION_KEY = 'impersonation'

export type Impersonation = {
  id: number
  display_name: string
  email: string
  admin_display_name: string
}

export type ImpersonationCandidate = {
  id: number
  display_name: string
  email: string
}

export function currentImpersonation(): Impersonation | null {
  const raw = localStorage.getItem(IMPERSONATION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Impersonation
  } catch {
    return null
  }
}

export function isImpersonating(): boolean {
  return currentImpersonation() !== null
}

export function clearImpersonationCache() {
  localStorage.removeItem(ADMIN_TOKEN_KEY)
  localStorage.removeItem(IMPERSONATION_KEY)
}

// 対象ユーザーのトークンに差し替える。
// なりすまし中に呼べば、管理者に戻らずそのまま別ユーザーへ乗り換わる。
export async function startImpersonation(userId: number): Promise<Impersonation> {
  const currentToken = localStorage.getItem('jwt')
  if (!currentToken) throw new Error('ログインしていません')

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
  // 退避するのは素の管理者から始めた最初の1回だけ。
  // 乗り換えのたびに上書きすると、退避先がなりすましトークンになって帰り道が壊れる。
  if (!localStorage.getItem(ADMIN_TOKEN_KEY)) localStorage.setItem(ADMIN_TOKEN_KEY, currentToken)
  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(impersonation))
  localStorage.setItem('jwt', token)
  return impersonation
}

// なりすましを終了して管理者アカウントに戻す。
// サーバがトークンから戻り先を判断するので、localStorage が消えていても戻れる。
export async function stopImpersonation(): Promise<boolean> {
  const impersonationToken = localStorage.getItem('jwt')
  try {
    const res = await api.delete('/admin/impersonations')
    const { token } = res.data as { token: string }
    localStorage.setItem('jwt', token)
    clearImpersonationCache()
    // 使い終わったなりすましトークンは失効させる(使い回されないように)。
    // 戻り先を確保した後なので、失敗しても管理者には戻れている。
    if (impersonationToken) {
      api.delete('/auth/sign_out', { headers: { Authorization: `Bearer ${impersonationToken}` } }).catch(() => {})
    }
    return true
  } catch {
    // 戻り先を持たない古いトークンのときだけ、退避しておいた管理者トークンに頼る
    const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY)
    if (!adminToken) return false
    localStorage.setItem('jwt', adminToken)
    clearImpersonationCache()
    return true
  }
}

// なりすまし先の候補。なりすまし中でも取得できるので、バナーの切替セレクトに使える。
export async function fetchImpersonationCandidates(): Promise<ImpersonationCandidate[]> {
  const res = await api.get('/admin/impersonations')
  return res.data as ImpersonationCandidate[]
}
