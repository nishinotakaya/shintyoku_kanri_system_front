import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import { visibleWorkCategories, WORK_CATEGORY_LABELS } from '../lib/workCategories'
import type { WorkCategory } from '../lib/workCategories'
import DocumentFolderSync from './DocumentFolderSync'

type InvoiceSetting = {
  client_name: string
  honorific: string
  subject: string
  item_label: string
  unit_price: number
  merged_unit_price: number | null // 統合請求書(ラボップ宛)でこの人の稼働に掛ける時給。支払時給とは別
  tax_rate: number
  payment_due_days: number
  payment_due_type: string
  issuer_name: string
  registration_no: string
  postal_code: string
  address: string
  tel: string
  email: string
  bank_info: string
  seal_image?: string | null // 印鑑(ハンコ)画像 data URL。ユーザー単位(全カテゴリ共通)。
  default_items: { label: string; qty: number; unit: string; price: number }[]
}

export default function SettingsModal({
  open,
  initialTab = 'account',
  year,
  month,
  onClose,
  onSaved,
}: {
  open: boolean
  initialTab?: 'account' | 'invoice' | 'backlog' | 'github' | 'freee'
  year: number
  month: number
  onClose: () => void
  onSaved?: () => void
}) {
  const monthParam = `${year}-${String(month).padStart(2, '0')}`
  const todayIso = new Date().toISOString().slice(0, 10)
  const [applicationDate, setApplicationDate] = useState<string>(todayIso)
  const [tab, setTab] = useState<'account' | 'invoice' | 'backlog' | 'github' | 'freee' | 'users'>(initialTab)
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  const [isAdmin, setIsAdmin] = useState(false)
  const [me, setMe] = useState<Me | null>(null)

  // === 会社(テナント) ===
  // カレンダーの行ラベルにこの会社名が出る。変更できるのは代表本人と admin だけ。
  type EditableTenant = { id: number; name: string; code: string; editable: boolean }
  const [tenants, setTenants] = useState<EditableTenant[]>([])
  const [tenantNameDrafts, setTenantNameDrafts] = useState<Record<number, string>>({})
  const [tenantMessage, setTenantMessage] = useState<string | null>(null)
  const [tenantSavingId, setTenantSavingId] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    api.get<{ tenants: EditableTenant[] }>('/tenants')
      .then((r) => {
        const list = r.data.tenants ?? []
        setTenants(list)
        setTenantNameDrafts(Object.fromEntries(list.map((tenant) => [tenant.id, tenant.name])))
      })
      .catch(() => {})
  }, [open])
  const saveTenantName = async (tenant: EditableTenant) => {
    const name = (tenantNameDrafts[tenant.id] ?? '').trim()
    if (!name || name === tenant.name) return
    setTenantSavingId(tenant.id)
    setTenantMessage(null)
    try {
      const r = await api.patch<EditableTenant>(`/tenants/${tenant.id}`, { name })
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, name: r.data.name } : t)))
      setTenantMessage(`会社名を「${r.data.name}」に変更しました`)
      onSaved?.()
    } catch (e: any) {
      setTenantMessage(e?.response?.data?.error ?? e?.message ?? '会社名の変更に失敗しました')
    } finally {
      setTenantSavingId(null)
    }
  }

  // === admin: ユーザー管理 ===
  type AdminUser = { id: number; email: string; display_name: string | null; admin: boolean; has_google: boolean; created_at: string | null }
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserAdmin, setNewUserAdmin] = useState(false)
  const [userBusy, setUserBusy] = useState(false)
  const [userMsg, setUserMsg] = useState<string | null>(null)
  const loadAdminUsers = async () => {
    try {
      const r = await api.get<AdminUser[]>('/admin/users')
      setAdminUsers(r.data)
    } catch (e: any) {
      setUserMsg(`取得失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  useEffect(() => { if (open && tab === 'users') loadAdminUsers() }, [open, tab])
  const createAdminUser = async () => {
    if (!newUserEmail.trim()) { setUserMsg('email を入力してください'); return }
    setUserBusy(true); setUserMsg(null)
    try {
      const r = await api.post<{ id: number; invite_sent: boolean; invite_error: string | null }>('/admin/users', {
        email: newUserEmail.trim(), display_name: newUserName.trim(), admin: newUserAdmin, send_invite: true,
      })
      setUserMsg(r.data.invite_sent ? `✅ 作成 + 招待メール送信 (id=${r.data.id})` : `⚠ 作成 (id=${r.data.id}) / 招待メール失敗: ${r.data.invite_error}`)
      setNewUserEmail(''); setNewUserName(''); setNewUserAdmin(false)
      await loadAdminUsers()
    } catch (e: any) {
      setUserMsg(`失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setUserBusy(false) }
  }
  const [keySet, setKeySet] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [heygenKeySet, setHeygenKeySet] = useState(false)
  const [heygenKey, setHeygenKey] = useState('')
  const [trelloKeySet, setTrelloKeySet] = useState(false)
  const [trelloKey, setTrelloKey] = useState('')
  const [trelloTokenSet, setTrelloTokenSet] = useState(false)
  const [trelloToken, setTrelloToken] = useState('')
  const [trelloBoardId, setTrelloBoardId] = useState('')
  const [closingDay, setClosingDay] = useState(25)
  const [gender, setGender] = useState<string>('')
  const [scheduleUrl, setScheduleUrl] = useState('')
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [transit, setTransit] = useState({ from: '', to: '', fee: 0, line: '' })
  const [routes, setRoutes] = useState<{ from: string; to: string; fee: number; line: string }[]>([])
  const [commuteDays, setCommuteDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [inv, setInv] = useState<InvoiceSetting | null>(null)
  const [invCat, setInvCat] = useState<WorkCategory>('wings')
  useEffect(() => {
    if (!open) return
    api.get('/invoice_setting', { params: { category: invCat } }).then((r) => setInv(r.data))
  }, [invCat, open])
  const [blSetting, setBlSetting] = useState({ backlog_url: '', backlog_email: '', backlog_password: '', board_id: 0, user_backlog_id: 0, session_cookie: '', has_cookie: false, api_key: '', has_api_key: false, assignee_name_filter: '' })
  const [gh, setGh] = useState({ personal_access_token: '', default_repos: '', has_token: false })
  const [ghTestResult, setGhTestResult] = useState<{ success: boolean; login?: string; name?: string; error?: string } | null>(null)
  const [freee, setFreee] = useState<{ identity: string; password: string; status: { connected: boolean; identity?: string; company_id?: string; last_connected_at?: string; last_status_code?: number; last_error?: string } | null; busy: boolean; result: string | null }>({ identity: '', password: '', status: null, busy: false, result: null })
  const [blTestResult, setBlTestResult] = useState<{ success: boolean; total?: number; error?: string } | null>(null)
  const [, setBlSyncResult] = useState<{ synced: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // 確定申告・消費税申告書の宛先（所轄税務署・納税地）
  const [taxInfo, setTaxInfo] = useState({ tax_office: '', address: '', name_kana: '' })

  useEffect(() => {
    if (!open) return
    setMsg(null)
    setApiKey('')
    setHeygenKey('')
    setTrelloKey('')
    setTrelloToken('')
    api.get('/me').then((r) => {
      setMe(r.data as Me)
      // 見えないカテゴリを選んだままにしない（見える範囲が変わった/初回ロード時の補正）
      const categoriesForFetchedMe = visibleWorkCategories(r.data)
      if (!categoriesForFetchedMe.includes(invCat)) {
        setInvCat(categoriesForFetchedMe[0])
      }
      setKeySet(!!r.data.openai_api_key_set)
      setHeygenKeySet(!!r.data.heygen_api_key_set)
      setTrelloKeySet(!!r.data.trello_api_key_set)
      setTrelloTokenSet(!!r.data.trello_api_token_set)
      setTrelloBoardId(r.data.trello_board_id ?? '')
      setClosingDay(r.data.closing_day ?? 25)
      setGender(r.data.gender ?? '')
      setTransit({
        from: r.data.default_transit_from ?? '',
        to: r.data.default_transit_to ?? '',
        fee: r.data.default_transit_fee ?? 0,
        line: r.data.default_transit_line ?? '',
      })
      setRoutes(r.data.transit_routes ?? [])
      setCommuteDays(r.data.commute_days ?? [1, 2, 3, 4, 5])
      setScheduleUrl(r.data.attendance_schedule_url ?? '')
      setTaxInfo({ tax_office: r.data.tax_office ?? '', address: r.data.address ?? '', name_kana: r.data.name_kana ?? '' })
      setIsAdmin(!!r.data.admin)
    })
    api.get('/invoice_setting', { params: { category: invCat } }).then((r) => setInv(r.data))
    api.get('/backlog/setting').then((r) => setBlSetting((prev) => ({ ...prev, ...r.data })))
    api.get('/github/setting').then((r) => setGh((prev) => ({ ...prev, has_token: !!r.data.has_token, default_repos: r.data.default_repos ?? '' }))).catch(() => {})
    api.get('/freee/setting').then((r) => setFreee((prev) => ({ ...prev, status: r.data, identity: r.data.identity ?? '' }))).catch(() => {})
    api.get('/monthly_setting', { params: { month: monthParam } }).then((r) => {
      setApplicationDate(r.data.application_date ?? r.data.default_application_date ?? todayIso)
    })
  }, [open, monthParam])

  if (!open) return null

  const saveAccount = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const payload: Record<string, unknown> = {
        closing_day: closingDay,
        gender: gender || null,
        default_transit_from: transit.from,
        default_transit_to: transit.to,
        default_transit_fee: transit.fee,
        default_transit_line: transit.line,
        transit_routes: routes,
        commute_days: commuteDays,
        attendance_schedule_url: scheduleUrl,
        tax_office: taxInfo.tax_office,
        address: taxInfo.address,
        name_kana: taxInfo.name_kana,
      }
      if (apiKey) payload.openai_api_key = apiKey
      if (heygenKey) payload.heygen_api_key = heygenKey
      if (trelloKey) payload.trello_api_key = trelloKey
      if (trelloToken) payload.trello_api_token = trelloToken
      payload.trello_board_id = trelloBoardId
      await api.patch('/me', { user: payload })
      await api.patch('/monthly_setting', { application_date: applicationDate || null }, { params: { month: monthParam } })
      // 乗車区間を業務報告 + 立替金に一括反映
      if (transit.from && transit.fee) {
        const now = new Date()
        const mp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const res = await api.post('/work_reports/apply_transit', { month: mp })
        setMsg(`保存しました（通勤 ${res.data.applied} 日分を反映）`)
      } else {
        setMsg('保存しました')
      }
      setApiKey('')
      if (heygenKey) { setHeygenKey(''); setHeygenKeySet(true) }
      if (trelloKey) { setTrelloKey(''); setTrelloKeySet(true) }
      if (trelloToken) { setTrelloToken(''); setTrelloTokenSet(true) }
      setKeySet(true)
      onSaved?.()
    } catch (e: any) {
      setMsg(e?.response?.data?.error?.toString() ?? '保存に失敗')
    } finally {
      setSaving(false)
    }
  }

  const saveInvoice = async () => {
    if (!inv) return
    setSaving(true)
    setMsg(null)
    try {
      await api.patch('/invoice_setting', { invoice_setting: inv, category: invCat, seal_image: inv.seal_image ?? '' })
      setMsg('保存しました')
      onSaved?.()
    } catch (e: any) {
      setMsg(e?.response?.data?.error?.toString() ?? '保存に失敗')
    } finally {
      setSaving(false)
    }
  }

  // 印鑑画像を選択 → 大きすぎる写真は 500px に縮小して data URL 化（SVG はそのまま）
  const onSealFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      if (file.type === 'image/svg+xml') { setInv((p) => p && { ...p, seal_image: src }); return }
      const img = new Image()
      img.onload = () => {
        const max = 500
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        setInv((p) => p && { ...p, seal_image: canvas.toDataURL('image/png') })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }

  const fld = (label: string, key: keyof InvoiceSetting, type: 'text' | 'number' = 'text', span = 'col-span-2') => (
    <label className={`block ${span}`}>
      <span className="text-[11px] text-[var(--color-text-sub)]">{label}</span>
      <input
        type={type}
        value={(inv?.[key] as string | number | undefined) ?? ''}
        onChange={(e) =>
          setInv((p) => p && { ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value })
        }
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
      />
    </label>
  )

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-6 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-[var(--color-text)]">設定</div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-[var(--color-text)]">
            ×
          </button>
        </div>

        <div className="mt-5 flex gap-2 flex-wrap">
          {(isAdmin
            ? ['account', 'invoice', 'backlog', 'github', 'freee', 'users'] as const
            : ['account', 'invoice', 'backlog', 'github', 'freee'] as const
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${
                tab === t ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)] hover:text-[var(--color-text)]'
              }`}
            >
              {t === 'account' ? 'アカウント' : t === 'invoice' ? '請求書' : t === 'backlog' ? 'バックログ' : t === 'github' ? 'GitHub' : t === 'freee' ? 'freee' : '👥 ユーザー'}
            </button>
          ))}
        </div>

        {tab === 'account' && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="text-xs text-[var(--color-text-sub)]">締日</div>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={closingDay}
                  onChange={(e) => setClosingDay(Number(e.target.value))}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d} 日
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[var(--color-text-sub)]">例: 25 日 → 「4 月分」は 3/26 〜 4/25</span>
              </div>
            </div>

            {tenants.length > 0 && (
              <div>
                <div className="text-xs text-[var(--color-text-sub)]">会社（カレンダーの行に出る名前）</div>
                <div className="mt-2 space-y-2">
                  {tenants.map((tenant) => (
                    <div key={tenant.id} className="flex flex-wrap items-center gap-2">
                      <input
                        value={tenantNameDrafts[tenant.id] ?? ''}
                        onChange={(e) => setTenantNameDrafts((prev) => ({ ...prev, [tenant.id]: e.target.value }))}
                        disabled={!tenant.editable}
                        className="min-w-[12rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60 disabled:opacity-60"
                      />
                      {tenant.editable ? (
                        <button
                          type="button"
                          onClick={() => saveTenantName(tenant)}
                          disabled={tenantSavingId === tenant.id || (tenantNameDrafts[tenant.id] ?? '').trim() === tenant.name}
                          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          {tenantSavingId === tenant.id ? '保存中…' : '会社名を保存'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--color-text-sub)]">代表者だけが変更できます</span>
                      )}
                    </div>
                  ))}
                </div>
                {tenantMessage && <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">{tenantMessage}</div>}
              </div>
            )}

            <DocumentFolderSync />

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">申請日（{year}年{month}月分）</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={applicationDate}
                  onChange={(e) => setApplicationDate(e.target.value)}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
                />
                <button
                  type="button"
                  onClick={() => setApplicationDate(todayIso)}
                  className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50"
                >
                  本日
                </button>
                <span className="text-xs text-[var(--color-text-sub)]">立替金 Excel・請求書 PDF の右上に出力</span>
              </div>
            </div>

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">デフォルト乗車区間（勤怠同期時に自動入力）</div>

              {/* プルダウンで既存ルート選択 */}
              {routes.length > 0 && (
                <select
                  onChange={(e) => {
                    const r = routes[Number(e.target.value)]
                    if (r) setTransit({ from: r.from, to: r.to, fee: r.fee, line: r.line })
                  }}
                  className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                  defaultValue=""
                >
                  <option value="" disabled>保存済みルートから選択...</option>
                  {routes.map((r, i) => (
                    <option key={i} value={i}>{r.from} ～ {r.to}（¥{r.fee.toLocaleString()}）{r.line}</option>
                  ))}
                </select>
              )}

              <div className="mt-2 grid grid-cols-12 gap-2">
                <input value={transit.from} onChange={(e) => setTransit({ ...transit, from: e.target.value })} placeholder="出発"
                  className="col-span-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
                <span className="col-span-1 flex items-center justify-center text-[var(--color-text-sub)]">〜</span>
                <input value={transit.to} onChange={(e) => setTransit({ ...transit, to: e.target.value })} placeholder="到着"
                  className="col-span-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
                <input type="number" value={transit.fee} onChange={(e) => setTransit({ ...transit, fee: Number(e.target.value) })} placeholder="金額"
                  className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-right font-mono text-[var(--color-text)]" />
                <span className="col-span-1 flex items-center text-xs text-[var(--color-text-sub)]">円</span>
                <button onClick={() => {
                  if (transit.from && transit.to) setRoutes([...routes, { ...transit }])
                }} className="col-span-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-2 text-xs text-[var(--color-text-sub)] hover:bg-gray-50">
                  ＋ 保存
                </button>
              </div>
              <input value={transit.line} onChange={(e) => setTransit({ ...transit, line: e.target.value })} placeholder="路線名 (例: JR線,東武アーバンパークライン)"
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400" />

              {/* 保存済みルート一覧 */}
              {routes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {routes.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--color-bg)] px-3 py-1.5 text-xs">
                      <span className="text-[var(--color-text)]">{r.from} ～ {r.to}　¥{r.fee.toLocaleString()}　{r.line}</span>
                      <button onClick={() => setRoutes(routes.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 通勤曜日 */}
            <div>
              <div className="text-xs text-[var(--color-text-sub)]">通勤日（勤怠同期時に乗車区間を入れる曜日）</div>
              <div className="mt-2 flex gap-2">
                {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (
                  <button
                    key={i}
                    onClick={() => setCommuteDays(commuteDays.includes(i) ? commuteDays.filter((d) => d !== i) : [...commuteDays, i])}
                    className={`w-10 h-10 rounded-lg text-sm font-semibold transition ${
                      commuteDays.includes(i)
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-bg)] text-[var(--color-text-sub)] border border-[var(--color-border)]'
                    } ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* 勤怠スケジュール（Google スプレッドシート） */}
            <div>
              <div className="text-xs text-[var(--color-text-sub)]">勤怠スケジュール URL（Google スプレッドシート）</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                表ヘッダの姓（例: 西野 / 川村）を自動検出し、「休み」セルを抽出します
              </div>
              <input
                value={scheduleUrl}
                onChange={(e) => setScheduleUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  disabled={importing || !scheduleUrl}
                  onClick={async () => {
                    setImporting(true); setScheduleMsg(null)
                    try {
                      // URL 保存
                      await api.patch('/me', { user: { attendance_schedule_url: scheduleUrl } })
                      // 取込
                      const res = await api.post('/me/import_schedule', {}, { params: { year, month } })
                      setScheduleMsg(`${res.data.off_days.length} 日分を取込みました（${res.data.surname} / ${res.data.sheet}）`)
                      onSaved?.()
                    } catch (e: any) {
                      setScheduleMsg(e?.response?.data?.error ?? '取込に失敗しました')
                    } finally {
                      setImporting(false)
                    }
                  }}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-md disabled:opacity-50"
                >
                  {importing ? '取込中…' : '📅 当月の休みを取込'}
                </button>
                {scheduleMsg && <span className="text-xs text-emerald-600">{scheduleMsg}</span>}
              </div>
            </div>

            {/* 確定申告・消費税申告書の宛先 */}
            <div>
              <div className="text-xs text-[var(--color-text-sub)]">確定申告書・消費税申告書の宛先</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                申告書PDFの「◯◯税務署長」と納税地に印字されます（例: 税務署=松戸）
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={taxInfo.tax_office}
                  onChange={(e) => setTaxInfo({ ...taxInfo, tax_office: e.target.value })}
                  placeholder="所轄税務署 (例: 松戸)"
                  className="w-40 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400"
                />
                <input
                  value={taxInfo.address}
                  onChange={(e) => setTaxInfo({ ...taxInfo, address: e.target.value })}
                  placeholder="納税地の住所 (未入力なら請求書設定の住所を使用)"
                  className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400"
                />
              </div>
              <div className="mt-2">
                <input
                  value={taxInfo.name_kana}
                  onChange={(e) => setTaxInfo({ ...taxInfo, name_kana: e.target.value })}
                  placeholder="氏名フリガナ (例: ニシノ タカヤ) — 申告書のフリガナ欄に印字"
                  className="w-72 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-gray-400"
                />
              </div>
            </div>

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">性別</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                モテQ&Aマインドマップの内容（相手の性別）に使われます
              </div>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 text-[var(--color-text)] outline-none focus:border-fuchsia-400/60"
              >
                <option value="">未設定</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
              </select>
            </div>

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">OpenAI API キー</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                現在: {keySet ? <span className="text-emerald-600">設定済み</span> : <span className="text-red-500">未設定</span>}
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="変更する場合のみ入力 (sk-proj-...)"
                className="mt-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-mono text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
              />
            </div>

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">HeyGen API キー（喋るインタビュー動画）</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                現在: {heygenKeySet ? <span className="text-emerald-600">設定済み</span> : <span className="text-gray-500">未設定（管理者の共通キーを使用）</span>}
              </div>
              <div className="mt-1 text-[11px]">
                <a href="https://app.heygen.com/developers/api" target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline">
                  ↗ HeyGen でAPIキーを取得・クレジットを購入する
                </a>
              </div>
              <input
                type="password"
                value={heygenKey}
                onChange={(e) => setHeygenKey(e.target.value)}
                placeholder="自分のキーを使う場合のみ入力"
                className="mt-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-mono text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
              />
            </div>

            <div>
              <div className="text-xs text-[var(--color-text-sub)]">Trello 連携</div>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">
                Trello のカードをカレンダー・進捗管理に連携します。未設定の場合は共通設定を使用します。
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-[11px] text-[var(--color-text-sub)]">
                    APIキー — 現在: {trelloKeySet ? <span className="text-emerald-600">設定済み</span> : <span className="text-gray-500">未設定（共通設定を使用）</span>}
                  </div>
                  <input
                    type="password"
                    value={trelloKey}
                    onChange={(e) => setTrelloKey(e.target.value)}
                    placeholder="自分のキーを使う場合のみ入力"
                    className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-mono text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-[var(--color-text-sub)]">
                    トークン — 現在: {trelloTokenSet ? <span className="text-emerald-600">設定済み</span> : <span className="text-gray-500">未設定（共通設定を使用）</span>}
                  </div>
                  <input
                    type="password"
                    value={trelloToken}
                    onChange={(e) => setTrelloToken(e.target.value)}
                    placeholder="自分のトークンを使う場合のみ入力"
                    className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-mono text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-[var(--color-text-sub)]">ボードID</div>
                  <input
                    type="text"
                    value={trelloBoardId}
                    onChange={(e) => setTrelloBoardId(e.target.value)}
                    placeholder="自分のボードを使う場合のみ入力"
                    className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-mono text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
                  />
                </div>
              </div>
            </div>

            {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{msg}</div>}
            <button
              onClick={saveAccount}
              disabled={saving}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        )}

        {tab === 'invoice' && inv && (
          <div className="mt-5">
            <div className="flex gap-2 mb-4">
              {visibleWorkCategories(me).map((key) => (
                <button key={key} onClick={() => setInvCat(key)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                    invCat === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
                  }`}>{WORK_CATEGORY_LABELS[key]}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex gap-2 col-span-2">
                <div className="flex-1">{fld('請求先', 'client_name')}</div>
                <label className="block w-24">
                  <span className="text-[11px] text-[var(--color-text-sub)]">敬称</span>
                  <select
                    value={inv?.honorific ?? '御中'}
                    onChange={(e) => setInv((prev) => prev ? { ...prev, honorific: e.target.value } : prev)}
                    className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
                  >
                    <option value="御中">御中</option>
                    <option value="様">様</option>
                  </select>
                </label>
              </div>
              {fld('件名', 'subject')}
              {fld('品目ラベル', 'item_label', 'text', 'col-span-1')}
              {fld('単価 (円/h)', 'unit_price', 'number', 'col-span-1')}
              <label className="block col-span-1">
                <span className="text-[11px] text-[var(--color-text-sub)]">統合請求の時給 (円/h)</span>
                <input
                  type="number"
                  value={inv?.merged_unit_price ?? ''}
                  placeholder="未設定なら 3,750 円"
                  onChange={(e) =>
                    setInv((p) => p && { ...p, merged_unit_price: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
                />
                <span className="mt-1 block text-[10px] leading-tight text-[var(--color-text-sub)]">
                  ラボップ宛の統合請求書に使う時給。上の「単価」は支払う側の時給で別物です
                </span>
              </label>
              {fld('消費税率 (%)', 'tax_rate', 'number', 'col-span-1')}
              <label className="block col-span-1">
                <span className="text-[11px] text-[var(--color-text-sub)]">支払期限</span>
                <select
                  value={inv.payment_due_type || ''}
                  onChange={(e) => setInv((p) => p && { ...p, payment_due_type: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                >
                  <option value="">発行日 +{inv.payment_due_days ?? 35}日</option>
                  <option value="next_month_end">来月末</option>
                  <option value="next_next_month_end">再来月末</option>
                  <option value="month_end">当月末</option>
                  <option value="days_30">発行日 +30日</option>
                  <option value="days_35">発行日 +35日</option>
                  <option value="days_45">発行日 +45日</option>
                  <option value="days_60">発行日 +60日</option>
                </select>
              </label>
              {fld('発行者氏名', 'issuer_name', 'text', 'col-span-1')}
              {fld('登録番号', 'registration_no', 'text', 'col-span-1')}
              {fld('郵便番号', 'postal_code', 'text', 'col-span-1')}
              {fld('TEL', 'tel', 'text', 'col-span-1')}
              {fld('住所', 'address')}
              {fld('Email', 'email')}
              {fld('振込先', 'bank_info')}
              <div className="col-span-2">
                <span className="text-[11px] text-[var(--color-text-sub)]">印鑑（ハンコ）画像 — 請求書/立替金PDFの右上に押印されます（全カテゴリ共通）</span>
                <div className="mt-1 flex items-center gap-3">
                  {inv.seal_image ? (
                    <img src={inv.seal_image} alt="印鑑" className="h-16 w-16 rounded border border-[var(--color-border)] object-contain" />
                  ) : (
                    <div className="grid h-16 w-16 place-items-center rounded border border-dashed border-[var(--color-border)] text-[10px] text-[var(--color-text-sub)]">未設定</div>
                  )}
                  <div className="flex flex-col gap-1">
                    <input type="file" accept="image/*" onChange={onSealFile} className="text-[11px]" />
                    {inv.seal_image && (
                      <button type="button" onClick={() => setInv((p) => p && { ...p, seal_image: '' })} className="text-left text-[11px] text-red-500">印鑑を削除</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-[11px] text-[var(--color-text-sub)]">既定の追加品目（マイナスで控除）</div>
              <div className="mt-2 space-y-2">
                {inv.default_items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input
                      value={it.label}
                      onChange={(e) =>
                        setInv((p) => p && { ...p, default_items: p.default_items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                      }
                      placeholder="品名"
                      className="col-span-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                    />
                    <input
                      type="number"
                      value={it.qty}
                      onChange={(e) =>
                        setInv((p) => p && { ...p, default_items: p.default_items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })
                      }
                      placeholder="数量"
                      className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-right text-sm text-[var(--color-text)]"
                    />
                    <input
                      value={it.unit}
                      onChange={(e) =>
                        setInv((p) => p && { ...p, default_items: p.default_items.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })
                      }
                      placeholder="単位"
                      className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                    />
                    <input
                      type="number"
                      value={it.price}
                      onChange={(e) =>
                        setInv((p) => p && { ...p, default_items: p.default_items.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })
                      }
                      placeholder="単価"
                      className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-right text-sm text-[var(--color-text)]"
                    />
                    <button
                      onClick={() => setInv((p) => p && { ...p, default_items: p.default_items.filter((_, j) => j !== i) })}
                      className="col-span-1 text-[var(--color-text-sub)] hover:text-red-500"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setInv((p) => p && { ...p, default_items: [...p.default_items, { label: '', qty: 1, unit: '回', price: 0 }] })
                  }
                  className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50"
                >
                  + 行追加
                </button>
              </div>
            </div>

            {msg && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{msg}</div>}
            <button
              onClick={saveInvoice}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
            >
              {saving ? '保存中…' : '請求書設定を保存'}
            </button>
          </div>
        )}

        {tab === 'backlog' && (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[11px] text-[var(--color-text-sub)]">バックログ URL</span>
              <input value={blSetting.backlog_url} onChange={(e) => setBlSetting({ ...blSetting, backlog_url: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">メール</span>
                <input value={blSetting.backlog_email} onChange={(e) => setBlSetting({ ...blSetting, backlog_email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
              </label>
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">パスワード</span>
                <input type="password" value={blSetting.backlog_password} onChange={(e) => setBlSetting({ ...blSetting, backlog_password: e.target.value })}
                  placeholder="変更する場合のみ"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">ボード ID</span>
                <input type="number" value={blSetting.board_id} onChange={(e) => setBlSetting({ ...blSetting, board_id: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
              </label>
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">ユーザー ID</span>
                <input type="number" value={blSetting.user_backlog_id} onChange={(e) => setBlSetting({ ...blSetting, user_backlog_id: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] text-[var(--color-text-sub)]">API キー（推奨）</span>
              <input type="password" value={blSetting.api_key ?? ''} onChange={(e) => setBlSetting({ ...blSetting, api_key: e.target.value })}
                placeholder="バックログ → 個人設定 → API で発行"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono" />
              <div className="mt-1 text-[10px] text-[var(--color-text-sub)]">
                現在: {blSetting.has_api_key ? <span className="text-emerald-600">設定済み</span> : <span className="text-red-500">未設定</span>}
                　<a href="https://tamahome.backlog.com/EditApiSettings.action" target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline">API キーを発行</a>
              </div>
            </label>

            <label className="block">
              <span className="text-[11px] text-[var(--color-text-sub)]">アサイン者名フィルタ（任意）</span>
              <input value={blSetting.assignee_name_filter ?? ''} onChange={(e) => setBlSetting({ ...blSetting, assignee_name_filter: e.target.value })}
                placeholder="例: 川村 卓也（指定するとそのユーザーのタスクのみ同期）"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]" />
            </label>

            {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{msg}</div>}

            <button
              onClick={async () => {
                setSaving(true); setMsg(null)
                try {
                  await api.patch('/backlog/setting', { backlog_setting: blSetting })
                  setMsg('保存しました')
                } catch (e: any) { setMsg(e?.response?.data?.error?.toString() ?? '保存失敗') }
                finally { setSaving(false) }
              }}
              disabled={saving}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
            >
              {saving ? '保存中…' : '設定を保存'}
            </button>

            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setBlTestResult(null)
                  const { data } = await api.post('/backlog/test')
                  setBlTestResult(data)
                }}
                className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-semibold text-[var(--color-text)] hover:bg-gray-50"
              >
                接続テスト
              </button>
              <button
                onClick={async () => {
                  setBlSyncResult(null); setSaving(true)
                  try {
                    const { data } = await api.post('/backlog/sync')
                    setBlSyncResult(data)
                    setMsg(`${data.synced} 件のタスクを同期しました`)
                    onSaved?.()
                  } catch (e: any) { setMsg(e?.response?.data?.error?.toString() ?? '同期失敗') }
                  finally { setSaving(false) }
                }}
                disabled={saving}
                className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-semibold text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {saving ? '同期中…' : 'タスク同期'}
              </button>
            </div>

            {blTestResult && (
              <div className={`rounded-lg px-3 py-2 text-xs ${blTestResult.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                {blTestResult.success ? `✅ 接続成功 (${blTestResult.total} 件取得)` : `❌ ${blTestResult.error}`}
              </div>
            )}
          </div>
        )}

        {tab === 'github' && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              GitHub の Personal Access Token を登録すると、Git ページで GitHub のリポジトリ・PR・コメントを閲覧できます。
              <br />発行手順: GitHub → Settings → Developer settings → Personal access tokens で発行（repo スコープが必要）
            </div>

            <label className="block">
              <span className="text-[11px] text-[var(--color-text-sub)]">Personal Access Token</span>
              <input type="password" value={gh.personal_access_token} onChange={(e) => setGh({ ...gh, personal_access_token: e.target.value })}
                placeholder={gh.has_token ? '登録済み（変更する場合のみ入力）' : 'ghp_...'}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono" />
              <div className="mt-1 text-[10px] text-[var(--color-text-sub)]">
                現在: {gh.has_token ? <span className="text-emerald-600">設定済み</span> : <span className="text-red-500">未設定</span>}
                　<a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline">Personal Access Token を発行</a>
              </div>
            </label>

            <label className="block">
              <span className="text-[11px] text-[var(--color-text-sub)]">表示リポジトリ</span>
              <div className="mt-1 text-[11px] text-[var(--color-text-sub)]">owner/repo を改行区切り。ここに書いたものが先頭に表示されます</div>
              <textarea value={gh.default_repos} onChange={(e) => setGh({ ...gh, default_repos: e.target.value })} rows={4}
                placeholder={'tech-put/example-repo\nowner/another-repo'}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono" />
            </label>

            {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">{msg}</div>}

            <button
              onClick={async () => {
                setSaving(true); setMsg(null)
                try {
                  // コントローラは params.require(:github_setting) なので必ずラップして送る(GithubPanelの改名保存と同じ形)
                  const githubSetting: Record<string, unknown> = { default_repos: gh.default_repos }
                  if (gh.personal_access_token) githubSetting.personal_access_token = gh.personal_access_token
                  const { data } = await api.patch('/github/setting', { github_setting: githubSetting })
                  setGh({ personal_access_token: '', default_repos: data.default_repos ?? '', has_token: !!data.has_token })
                  setMsg('保存しました')
                  onSaved?.()
                } catch (e: any) { setMsg(e?.response?.data?.error?.toString() ?? '保存に失敗') }
                finally { setSaving(false) }
              }}
              disabled={saving}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
            >
              {saving ? '保存中…' : '設定を保存'}
            </button>

            <button
              onClick={async () => {
                setGhTestResult(null)
                try {
                  const { data } = await api.post('/github/test')
                  setGhTestResult(data)
                } catch (e: any) {
                  setGhTestResult({ success: false, error: e?.response?.data?.error ?? '接続に失敗しました' })
                }
              }}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-semibold text-[var(--color-text)] hover:bg-gray-50"
            >
              接続テスト
            </button>

            {ghTestResult && (
              <div className={`rounded-lg px-3 py-2 text-xs ${ghTestResult.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                {ghTestResult.success ? `✅ 接続OK: ${ghTestResult.login ?? ''}${ghTestResult.name ? `（${ghTestResult.name}）` : ''}` : `❌ ${ghTestResult.error}`}
              </div>
            )}
          </div>
        )}

        {tab === 'freee' && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              freee 会計の Web ログイン情報を保存して、請求書の売上計上などを自動で行います。
              <br />（freee API ではなく Web のセッション API を使用 — 利用規約上グレーのため、本番運用前に公式 API への切替検討推奨）
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">freee メールアドレス</span>
                <input
                  type="email"
                  value={freee.identity}
                  onChange={(e) => setFreee({ ...freee, identity: e.target.value })}
                  placeholder="example@gmail.com"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[var(--color-text-sub)]">パスワード</span>
                <input
                  type="password"
                  value={freee.password}
                  onChange={(e) => setFreee({ ...freee, password: e.target.value })}
                  placeholder="（保存済みの場合は再入力不要）"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
                />
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setFreee({ ...freee, busy: true, result: null })
                  try {
                    const { data } = await api.post('/freee/connect', {
                      identity: freee.identity,
                      password: freee.password,
                    })
                    setFreee({ ...freee, busy: false, password: '', status: data, result: data.message ?? '✅ 200 OK 接続完了' })
                  } catch (e: unknown) {
                    const err = e as { response?: { data?: { error?: string; status?: number } } }
                    setFreee({ ...freee, busy: false, result: `❌ ${err?.response?.data?.error ?? '接続失敗'} (status=${err?.response?.data?.status ?? '?'})` })
                  }
                }}
                disabled={freee.busy || !freee.identity || !freee.password}
                className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-lg shadow-fuchsia-500/20 disabled:opacity-50"
              >
                {freee.busy ? '接続中…' : '接続'}
              </button>
              <button
                onClick={async () => {
                  setFreee({ ...freee, busy: true, result: null })
                  try {
                    const { data } = await api.post('/freee/test')
                    setFreee({ ...freee, busy: false, status: { ...(freee.status ?? { connected: false }), connected: true, last_status_code: data.status }, result: `✅ 接続テスト OK (status=${data.status})` })
                  } catch (e: unknown) {
                    const err = e as { response?: { data?: { error?: string; status?: number } } }
                    setFreee({ ...freee, busy: false, result: `❌ ${err?.response?.data?.error ?? '失敗'} (status=${err?.response?.data?.status ?? '?'})` })
                  }
                }}
                disabled={freee.busy || !freee.status?.identity}
                className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
              >
                接続テスト（200 確認）
              </button>
            </div>

            {freee.status && (
              <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-[11px] text-[var(--color-text-sub)]">
                <div>状態: {freee.status.connected ? <span className="text-emerald-600 font-semibold">接続中</span> : <span className="text-red-500">未接続</span>}</div>
                {freee.status.identity && <div>メール: {freee.status.identity}</div>}
                {freee.status.company_id && <div>事業所 ID: {freee.status.company_id}</div>}
                {freee.status.last_connected_at && <div>最終接続: {new Date(freee.status.last_connected_at).toLocaleString('ja-JP')}</div>}
                {freee.status.last_status_code != null && <div>最終 HTTP ステータス: {freee.status.last_status_code}</div>}
                {freee.status.last_error && <div className="text-red-500">最終エラー: {freee.status.last_error}</div>}
              </div>
            )}

            {freee.result && (
              <div className={`rounded-lg px-3 py-2 text-xs ${freee.result.startsWith('✅') ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                {freee.result}
              </div>
            )}
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-700">
              admin 権限: 新しいユーザーを作成して招待メール (Google ログイン案内) を送信できます。
              <br />招待された人がそのメールアドレスで Google ログインすると、自動で本アカウントに紐づきます。
            </div>

            <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
              <div className="text-xs font-semibold">＋ 新規ユーザー追加</div>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] text-[var(--color-text-sub)]">Email *</span>
                  <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="example@gmail.com"
                    className="mt-0.5 w-full rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[var(--color-text-sub)]">表示名</span>
                  <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="山田 太郎"
                    className="mt-0.5 w-full rounded border border-[var(--color-border)] px-2 py-1 text-sm" />
                </label>
                <label className="flex items-end gap-1.5 text-xs">
                  <input type="checkbox" checked={newUserAdmin} onChange={(e) => setNewUserAdmin(e.target.checked)} />
                  <span>admin 権限</span>
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] ${userMsg?.includes('失敗') || userMsg?.includes('⚠') ? 'text-red-500' : 'text-emerald-600'}`}>{userMsg ?? ''}</span>
                <button onClick={createAdminUser} disabled={userBusy}
                  className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                  {userBusy ? '送信中…' : '📧 作成 + 招待メール送信'}
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold mb-1">登録済ユーザー ({adminUsers.length}件)</div>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-[var(--color-text-sub)]">
                  <tr>
                    <th className="px-2 py-1 text-left">id</th>
                    <th className="px-2 py-1 text-left">Email</th>
                    <th className="px-2 py-1 text-left">表示名</th>
                    <th className="px-2 py-1 text-center">admin</th>
                    <th className="px-2 py-1 text-center">Google連携</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => (
                    <tr key={u.id} className="border-t border-[var(--color-border)]">
                      <td className="px-2 py-1 font-mono">{u.id}</td>
                      <td className="px-2 py-1">{u.email}</td>
                      <td className="px-2 py-1">{u.display_name ?? '—'}</td>
                      <td className="px-2 py-1 text-center">{u.admin ? '✓' : ''}</td>
                      <td className="px-2 py-1 text-center">{u.has_google ? '✅' : '⏳ 未ログイン'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
