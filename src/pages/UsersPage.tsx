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
  data_source_permissions: DataSourcePermission[]
  calendar_persons: string[]
}

type DataSourcePermission = {
  source_type: string
  can_view: boolean
  can_sync: boolean
  can_write: boolean
  credential_owner_id: number | null
}

// 進捗管理の外部データソース。admin はレコード無しで全許可、一般ユーザーは明示的に許可した分だけ。
const DATA_SOURCES: { key: string; label: string }[] = [
  { key: 'backlog', label: 'Wing（Backlog）' },
  { key: 'notion', label: 'リビング（Notion）' },
  { key: 'trello', label: 'テックリーダーズ（Trello）' },
]

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [meId, setMeId] = useState<number | null>(null)
  const [editingManagee, setEditingManagee] = useState<number | null>(null)
  const [editingFeatures, setEditingFeatures] = useState<number | null>(null)
  const [editingSources, setEditingSources] = useState<number | null>(null)
  const [editingCalendarPersons, setEditingCalendarPersons] = useState<number | null>(null)
  const [calendarPersonCandidates, setCalendarPersonCandidates] = useState<string[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/me').then((r) => setMeId(r.data.id))
    api.get<{ users: AdminUser[]; calendar_person_candidates: string[] }>('/admin/users')
      .then((r) => { setUsers(r.data.users); setCalendarPersonCandidates(r.data.calendar_person_candidates) })
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
    { key: 'mote_qa_mindmap', label: 'モテ質問' },
    { key: 'love_youtube_mindmap', label: '恋愛YouTube' },
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

  const permissionOf = (u: AdminUser, sourceKey: string): DataSourcePermission =>
    u.data_source_permissions?.find((p) => p.source_type === sourceKey)
      ?? { source_type: sourceKey, can_view: false, can_sync: false, can_write: false, credential_owner_id: null }

  const patchSource = (u: AdminUser, sourceKey: string, patch: Partial<DataSourcePermission>) => {
    const current = permissionOf(u, sourceKey)
    patchUser(u.id, { data_source_permission: { ...current, ...patch, source_type: sourceKey } })
  }

  const sourceSummary = (u: AdminUser) => {
    if (u.admin) return '全ソース（管理者）'
    const viewable = DATA_SOURCES.filter((s) => permissionOf(u, s.key).can_view)
    return viewable.length === 0 ? 'なし' : viewable.map((s) => s.label).join('、')
  }

  // カレンダーに予定行を出す人物。1人も選ばれていない状態は「既定メンバー」に戻る
  const toggleCalendarPerson = (user: AdminUser, person: string) => {
    const next = user.calendar_persons.includes(person)
      ? user.calendar_persons.filter((name) => name !== person)
      : [...user.calendar_persons, person]
    patchUser(user.id, { calendar_persons: next })
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
              <th className="px-4 py-2 w-56">案件データ（進捗）</th>
              <th className="px-4 py-2 w-48">カレンダーで見える人</th>
              <th className="px-4 py-2 w-56">管理対象（サブ管理者）</th>
              <th className="px-4 py-2 w-36 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--color-text-sub)]">読み込み中…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--color-text-sub)]">ユーザーが居ません</td></tr>
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
                  <div className="text-[11px] text-[var(--color-text)] break-words">{sourceSummary(u)}</div>
                  {!u.admin && (
                    <button onClick={() => setEditingSources(editingSources === u.id ? null : u.id)}
                      className="mt-1 text-[10px] text-indigo-600">{editingSources === u.id ? '閉じる' : '案件データを編集'}</button>
                  )}
                  {editingSources === u.id && !u.admin && (
                    <DataSourcePermissionEditor user={u} lenderCandidates={users.filter((other) => other.id !== u.id)}
                      permissionOf={permissionOf} onChange={patchSource} />
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="text-[11px] text-[var(--color-text)] break-words">{u.calendar_persons.join('、')}</div>
                  <button onClick={() => setEditingCalendarPersons(editingCalendarPersons === u.id ? null : u.id)}
                    className="mt-1 text-[10px] text-indigo-600">{editingCalendarPersons === u.id ? '閉じる' : '見える人を編集'}</button>
                  {editingCalendarPersons === u.id && (
                    <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
                      {calendarPersonCandidates.map((person) => (
                        <label key={person} className="flex items-center gap-1.5 text-[11px]">
                          <input type="checkbox" checked={u.calendar_persons.includes(person)}
                            onChange={() => toggleCalendarPerson(u, person)} />
                          {person}
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

// 1ユーザー分のデータソース権限エディタ。ソースごとに 閲覧/取込/書込 と、Backlog だけ「キーの借り元」を選ぶ。
// 閲覧が外れている間は取込・書込を触れなくする(サーバ側も閲覧falseなら両方falseに倒す)。
function DataSourcePermissionEditor({ user, lenderCandidates, permissionOf, onChange }: {
  user: AdminUser
  lenderCandidates: AdminUser[]
  permissionOf: (user: AdminUser, sourceKey: string) => DataSourcePermission
  onChange: (user: AdminUser, sourceKey: string, patch: Partial<DataSourcePermission>) => void
}) {
  return (
    <div className="mt-1 space-y-2 rounded-md border border-[var(--color-border)] p-2">
      {DATA_SOURCES.map((source) => {
        const permission = permissionOf(user, source.key)
        const toggle = (field: 'can_view' | 'can_sync' | 'can_write') =>
          onChange(user, source.key, { [field]: !permission[field] })

        return (
          <div key={source.key} className="space-y-1">
            <div className="text-[11px] font-semibold text-[var(--color-text)]">{source.label}</div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={permission.can_view} onChange={() => toggle('can_view')} />
                閲覧
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={permission.can_sync} disabled={!permission.can_view}
                  onChange={() => toggle('can_sync')} />
                取込
              </label>
              <label className="flex items-center gap-1" title="Backlog などの外部サービス側へ書き込む">
                <input type="checkbox" checked={permission.can_write} disabled={!permission.can_view}
                  onChange={() => toggle('can_write')} />
                書込
              </label>
            </div>
            {source.key === 'backlog' && permission.can_view && (
              <label className="flex flex-col items-start gap-0.5 text-[10px] text-[var(--color-text-sub)]">
                <span className="whitespace-nowrap">キーの借り元</span>
                <select value={permission.credential_owner_id ?? ''}
                  onChange={(e) => onChange(user, source.key, { credential_owner_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded border border-[var(--color-border)] bg-white px-1 py-0.5 text-[10px]">
                  <option value="">自分のキー</option>
                  {lenderCandidates.map((lender) => (
                    <option key={lender.id} value={lender.id}>{lender.display_name || lender.email}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )
      })}
    </div>
  )
}
