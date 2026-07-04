import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

type AdminUser = {
  id: number
  display_name: string | null
  email: string
  admin: boolean
  has_google?: boolean
  feature_flags: Record<string, boolean>
  sub_admin: boolean
  managee_ids: number[]
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [meId, setMeId] = useState<number | null>(null)
  const [editingManagee, setEditingManagee] = useState<number | null>(null)
  const [editingFeatures, setEditingFeatures] = useState<number | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/me').then((r) => setMeId(r.data.id))
    api.get<AdminUser[]>('/admin/users')
      .then((r) => setUsers(r.data))
      .catch((e) => setErr(e?.response?.data?.error ?? e?.message ?? '取得失敗'))
      .finally(() => setLoading(false))
  }, [])

  const impersonate = (u: AdminUser) => navigate(`/attendance?as_user_id=${u.id}`)

  const patchUser = async (id: number, payload: Record<string, unknown>) => {
    try {
      const r = await api.patch<AdminUser>(`/admin/users/${id}`, payload)
      setUsers((prev) => prev.map((u) => (u.id === id ? r.data : u)))
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '更新に失敗しました')
    }
  }

  const FEATURES: { key: string; label: string }[] = [
    { key: 'attendance', label: '勤怠/カレンダー' },
    { key: 'progress', label: '進捗' },
    { key: 'purchase_orders', label: '注文書' },
    { key: 'invoices', label: '請求書' },
    { key: 'skill_sheet', label: 'スキルシート' },
    { key: 'skill_sheet_generate', label: '実績から生成' },
    { key: 'interview_mindmap', label: '面談対策' },
    { key: 'youtube_mindmap', label: 'YouTube動画' },
    { key: 'mote_mindmap', label: 'モテ会話' },
    { key: 'backlog_activities', label: '対応ログ' },
    { key: 'video_studio', label: '動画スタジオ' },
    { key: 'keihi', label: '経費計上' },
  ]

  // 管理者はデフォルト全チェック（明示的に false のときだけ OFF）。一般ユーザーは true のときだけ ON。
  const featureChecked = (u: AdminUser, key: string) =>
    u.admin ? u.feature_flags?.[key] !== false : !!u.feature_flags?.[key]

  const toggleFeature = (u: AdminUser, key: string) =>
    patchUser(u.id, { feature_flags: { [key]: !featureChecked(u, key) } })

  // 折りたたみ時の要約（全部 ON なら「全画面」、0 件なら「なし」）
  const featureSummary = (u: AdminUser) => {
    const enabled = FEATURES.filter((f) => featureChecked(u, f.key))
    if (enabled.length === 0) return 'なし'
    if (enabled.length === FEATURES.length) return '全画面'
    return enabled.map((f) => f.label).join('、')
  }

  const toggleManagee = (manager: AdminUser, manageeId: number) => {
    const next = manager.managee_ids.includes(manageeId)
      ? manager.managee_ids.filter((i) => i !== manageeId)
      : [...manager.managee_ids, manageeId]
    patchUser(manager.id, { managee_ids: next })
  }

  const nameOf = (id: number) => users.find((u) => u.id === id)?.display_name || `#${id}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">ユーザー一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">管理者のみ。機能権限・管理対象（サブ管理者）を設定できます</div>
        </div>
        <div className="text-xs text-[var(--color-text-sub)]">{users.length} 件</div>
      </div>

      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

      <div className="glass overflow-hidden rounded-2xl shadow-md">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--color-text-sub)]">
              <th className="px-4 py-2">表示名</th>
              <th className="px-4 py-2">メール</th>
              <th className="px-4 py-2 w-24 text-center">権限</th>
              <th className="px-4 py-2 w-48">閲覧できる画面</th>
              <th className="px-4 py-2 w-56">管理対象（サブ管理者）</th>
              <th className="px-4 py-2 w-36 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-sub)]">読み込み中…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--color-text-sub)]">ユーザーが居ません</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg)] align-top">
                <td className="px-4 py-2 text-xs font-medium text-[var(--color-text)] whitespace-nowrap">{u.display_name || '—'}</td>
                <td className="px-4 py-2 text-[var(--color-text-sub)]">{u.email}</td>
                <td className="px-4 py-2 text-center">
                  {u.admin ? (
                    <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">admin</span>
                  ) : u.sub_admin ? (
                    <span className="inline-block whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">サブ管理</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">user</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="text-[11px] text-[var(--color-text)] break-words">{featureSummary(u)}</div>
                  <button onClick={() => setEditingFeatures(editingFeatures === u.id ? null : u.id)}
                    className="mt-1 text-[10px] text-indigo-600">{editingFeatures === u.id ? '閉じる' : '画面を編集'}</button>
                  {editingFeatures === u.id && (
                    <div className="mt-1 rounded-md border border-[var(--color-border)] p-2 space-y-1 max-h-52 overflow-y-auto">
                      {FEATURES.map((f) => (
                        <label key={f.key} className="flex items-center gap-1.5 text-[11px]">
                          <input type="checkbox" checked={featureChecked(u, f.key)} onChange={() => toggleFeature(u, f.key)} />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  {u.admin ? (
                    <span className="text-[10px] text-[var(--color-text-sub)]">全ユーザー</span>
                  ) : (
                    <div>
                      <div className="text-[11px] text-[var(--color-text)]">
                        {u.managee_ids.length === 0 ? '—' : u.managee_ids.map(nameOf).join('、')}
                      </div>
                      <button onClick={() => setEditingManagee(editingManagee === u.id ? null : u.id)}
                        className="mt-1 text-[10px] text-indigo-600">{editingManagee === u.id ? '閉じる' : '管理対象を編集'}</button>
                      {editingManagee === u.id && (
                        <div className="mt-1 rounded-md border border-[var(--color-border)] p-2 space-y-1 max-h-40 overflow-y-auto">
                          {users.filter((o) => o.id !== u.id).map((o) => (
                            <label key={o.id} className="flex items-center gap-1.5 text-[11px]">
                              <input type="checkbox" checked={u.managee_ids.includes(o.id)} onChange={() => toggleManagee(u, o.id)} />
                              {o.display_name || o.email}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-center">
                  {meId !== u.id ? (
                    <button onClick={() => impersonate(u)}
                      className="rounded-md whitespace-nowrap bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white shadow"
                      title={`${u.display_name} として勤怠ダッシュボードを閲覧`}>👤 として閲覧</button>
                  ) : (
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
