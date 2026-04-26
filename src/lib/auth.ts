import { api } from './api'
import type { Me } from './api'

export async function signIn(email: string, password: string) {
  const res = await api.post('/auth/sign_in', { user: { email, password } })
  const token = res.data?.token || res.headers['authorization']?.replace('Bearer ', '')
  if (token) localStorage.setItem('jwt', token)
  return res.data?.user as Me
}

export async function signUp(email: string, password: string, display_name: string, company_name: string) {
  const res = await api.post('/auth/sign_up', {
    user: { email, password, display_name, company_name },
  })
  const token = res.data?.token || res.headers['authorization']?.replace('Bearer ', '')
  if (token) localStorage.setItem('jwt', token)
  return res.data?.user as Me
}

export async function signOut() {
  try {
    await api.delete('/auth/sign_out')
  } catch {
    // ignore
  }
  localStorage.removeItem('jwt')
}

export async function fetchMe(): Promise<Me | null> {
  if (!localStorage.getItem('jwt')) return null
  try {
    const res = await api.get('/me')
    return res.data
  } catch {
    return null
  }
}

export function isAuthed() {
  return !!localStorage.getItem('jwt')
}
