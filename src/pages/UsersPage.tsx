import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

type PickableUser = { id: number; display_name: string; email: string; admin: boolean }

export default function UsersPage() {
  const [users, setUsers] = useState<PickableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()
  const [me, setMe] = useState<PickableUser | null>(null)
  useEffect(() => {
    api.get('/me').then((r) => setMe({ id: r.data.id, display_name: r.data.display_name, email: r.data.email, admin: r.data.admin }))
  }, [])
  const impersonate = (u: PickableUser) => navigate(`/attendance?as_user_id=${u.id}`)

  useEffect(() => {
    api.get<PickableUser[]>('/users/pickable')
      .then((r) => setUsers(r.data))
      .catch((e) => setErr(e?.response?.data?.error ?? e?.message ?? '取得失敗'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">ユーザー一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">管理者のみ閲覧可能</div>
        </div>
        <div className="text-xs text-[var(--color-text-sub)]">{users.length} 件</div>
      </div>

      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

      <div className="glass overflow-hidden rounded-2xl shadow-md">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-text-sub)]">
              <th className="px-4 py-2 w-12">ID</th>
              <th className="px-4 py-2">表示名</th>
              <th className="px-4 py-2">メール</th>
              <th className="px-4 py-2 w-24 text-center">権限</th>
              <th className="px-4 py-2 w-44 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-sub)]">読み込み中…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-sub)]">ユーザーが居ません</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg)]">
                <td className="px-4 py-2 text-[var(--color-text-sub)] font-mono">{u.id}</td>
                <td className="px-4 py-2 font-medium text-[var(--color-text)]">{u.display_name || '—'}</td>
                <td className="px-4 py-2 text-[var(--color-text-sub)]">{u.email}</td>
                <td className="px-4 py-2 text-center">
                  {u.admin ? (
                    <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">admin</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">user</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center">
                  {me?.admin && me?.id !== u.id && (
                    <button
                      onClick={() => impersonate(u)}
                      className="rounded-md whitespace-nowrap bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white shadow"
                      title={`${u.display_name} として勤怠ダッシュボードを閲覧`}
                    >
                      👤 として閲覧
                    </button>
                  )}
                  {me?.id === u.id && (
                    <span className="text-[10px] text-[var(--color-text-sub)]">自分</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
