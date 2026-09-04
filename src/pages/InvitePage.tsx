import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { publicApi } from '../lib/contracts'
import { toast } from '../lib/toast'

type InvitationInfo = {
  email: string
  display_name: string
  accepted: boolean
}

// 招待メール記載のリンク(/invite/:token)から開く登録完了ページ。
// メールアドレスは招待時に確定済み(表示のみ)。パスワードを設定すると登録完了→自動ログインする。
export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const nav = useNavigate()
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)

  useEffect(() => { document.title = '招待から登録 — 勤怠アプリ' }, [])

  useEffect(() => {
    if (!token) return
    publicApi.get<InvitationInfo>(`/public/invitations/${token}`)
      .then((res) => {
        setInvitation(res.data)
        setDisplayName(res.data.display_name)
      })
      .catch((err) => {
        setLoadError(err?.response?.data?.error ?? '招待リンクが無効か、期限切れです')
      })
      .finally(() => setLoading(false))
  }, [token])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setSubmitError('パスワードは6文字以上で入力してください')
      return
    }
    if (password !== passwordConfirm) {
      setSubmitError('パスワード(確認)が一致しません')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await publicApi.post(`/public/invitations/${token}/accept`, {
        password,
        display_name: displayName,
      })
      if (res.data?.token) localStorage.setItem('jwt', res.data.token)
      setCompleted(true)
      toast.success('登録が完了しました。確認メールをお送りしました')
    } catch (err: any) {
      setSubmitError(err?.response?.data?.error ?? '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="glass w-full max-w-md rounded-3xl p-8 shadow-xl">{children}</div>
    </div>
  )

  if (loading) {
    return shell(<div className="text-center text-sm text-[var(--color-text-sub)]">招待を確認中…</div>)
  }

  if (loadError || !invitation) {
    return shell(
      <div className="space-y-4 text-center">
        <div className="text-4xl">⚠️</div>
        <div className="text-lg font-semibold text-[var(--color-text)]">{loadError ?? '招待リンクが無効です'}</div>
        <div className="text-sm text-[var(--color-text-sub)]">招待した方に、招待メールの再送を依頼してください。</div>
        <Link to="/sign_in" className="inline-block text-sm text-fuchsia-500">ログイン画面へ</Link>
      </div>,
    )
  }

  if (invitation.accepted && !completed) {
    return shell(
      <div className="space-y-4 text-center">
        <div className="text-4xl">✅</div>
        <div className="text-lg font-semibold text-[var(--color-text)]">この招待は登録済みです</div>
        <div className="text-sm text-[var(--color-text-sub)]">設定したパスワード、または Google アカウントでログインしてください。</div>
        <Link
          to="/sign_in"
          className="inline-block w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg"
        >
          ログイン画面へ
        </Link>
      </div>,
    )
  }

  if (completed) {
    return shell(
      <div className="space-y-4 text-center">
        <div className="text-4xl">🎉</div>
        <div className="text-xl font-bold text-emerald-600">登録が完了しました</div>
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {invitation.email} に確認メールをお送りしました。
        </div>
        <div className="text-sm text-[var(--color-text-sub)]">そのままアプリを利用できます。</div>
        <button
          type="button"
          onClick={() => nav('/')}
          className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-semibold text-white shadow-lg"
        >
          アプリをはじめる
        </button>
      </div>,
    )
  }

  return shell(
    <>
      <div className="mb-6 text-center">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">招待から登録</h1>
        <p className="mt-2 text-sm text-[var(--color-text-sub)]">パスワードを設定すると登録が完了します。</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">メールアドレス（招待されたアドレス）</span>
          <input
            type="email"
            value={invitation.email}
            readOnly
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-gray-100 px-4 py-3 text-[var(--color-text-sub)] outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">表示名</span>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">パスワード (6文字以上)</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-text-sub)]">パスワード (確認)</span>
          <input
            type="password"
            required
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
          />
        </label>
        {submitError && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-red-500">{submitError}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
        >
          {submitting ? '登録中…' : '登録を完了する'}
        </button>
      </form>
      <div className="mt-6 text-center text-xs text-[var(--color-text-sub)]">
        Google アカウント（{invitation.email}）をお持ちの場合は{' '}
        <Link to="/sign_in" className="text-fuchsia-500">Googleでログイン</Link>
        {' '}でもそのまま利用を開始できます。
      </div>
    </>,
  )
}
