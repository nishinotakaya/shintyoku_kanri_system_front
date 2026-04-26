import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signIn } from '../lib/auth'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signIn(email, password)
      nav('/')
    } catch (err: any) {
      setError(err?.response?.data?.error?.toString() ?? 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-lg shadow-fuchsia-500/20" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">進捗管理システム</h1>
          <p className="mt-1 text-sm text-[var(--color-text-sub)]">ログインして続行</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">メール</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-sub)]">パスワード</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
              placeholder="••••••••"
            />
          </label>
          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
          >
            {loading ? 'サインイン中…' : 'サインイン'}
          </button>
        </form>

        <div className="mt-5 relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--color-border)]" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-white px-3 text-[var(--color-text-sub)]">または</span></div>
        </div>

        <button
          type="button"
          onClick={() => {
            // hidden form で POST を送信（OmniAuth v2 は POST のみ受け付ける）
            const form = document.createElement('form')
            form.method = 'POST'
            form.action = 'http://localhost:3001/api/v1/auth/auth/google_oauth2'
            document.body.appendChild(form)
            form.submit()
          }}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 font-semibold text-[var(--color-text)] shadow-sm hover:bg-[var(--color-bg)] transition cursor-pointer"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google でログイン
        </button>

        <div className="mt-5 text-center text-sm text-[var(--color-text-sub)]">
          初めて？{' '}
          <Link to="/sign_up" className="text-fuchsia-500 hover:text-fuchsia-400">
            新規登録
          </Link>
        </div>
      </div>
    </div>
  )
}
