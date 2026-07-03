import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signUp } from '../lib/auth'

export default function SignUp() {
  const [form, setForm] = useState({ email: '', password: '', display_name: '', company_name: 'Wings株式会社' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  useEffect(() => { document.title = '新規登録 — 進捗管理システム' }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signUp(form.email, form.password, form.display_name, form.company_name)
      nav('/')
    } catch (err: any) {
      setError(JSON.stringify(err?.response?.data?.error ?? '登録に失敗しました'))
    } finally {
      setLoading(false)
    }
  }

  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="block">
      <span className="text-xs text-[var(--color-text-sub)]">{label}</span>
      <input
        type={type}
        required
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
      />
    </label>
  )

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">新規登録</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {field('email', 'メール', 'email')}
          {field('password', 'パスワード (6文字以上)', 'password')}
          {field('display_name', '表示名 (例: 西野 鷹也)')}
          {field('company_name', '所属会社')}
          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
          >
            {loading ? '登録中…' : 'アカウント作成'}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-[var(--color-text-sub)]">
          すでにアカウントあり？{' '}
          <Link to="/sign_in" className="text-fuchsia-500">
            サインイン
          </Link>
        </div>
      </div>
    </div>
  )
}
