import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type InvoiceSetting = {
  client_name: string
  subject: string
  item_label: string
  unit_price: number
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
  initialTab?: 'account' | 'invoice' | 'backlog'
  year: number
  month: number
  onClose: () => void
  onSaved?: () => void
}) {
  const monthParam = `${year}-${String(month).padStart(2, '0')}`
  const todayIso = new Date().toISOString().slice(0, 10)
  const [applicationDate, setApplicationDate] = useState<string>(todayIso)
  const [tab, setTab] = useState<'account' | 'invoice' | 'backlog'>(initialTab)
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  const [keySet, setKeySet] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [closingDay, setClosingDay] = useState(25)
  const [scheduleUrl, setScheduleUrl] = useState('')
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [transit, setTransit] = useState({ from: '', to: '', fee: 0, line: '' })
  const [routes, setRoutes] = useState<{ from: string; to: string; fee: number; line: string }[]>([])
  const [commuteDays, setCommuteDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [inv, setInv] = useState<InvoiceSetting | null>(null)
  const [invCat, setInvCat] = useState<'wings' | 'living' | 'techleaders' | 'resystems'>('wings')
  useEffect(() => {
    if (!open) return
    api.get('/invoice_setting', { params: { category: invCat } }).then((r) => setInv(r.data))
  }, [invCat, open])
  const [blSetting, setBlSetting] = useState({ backlog_url: '', backlog_email: '', backlog_password: '', board_id: 0, user_backlog_id: 0, session_cookie: '', has_cookie: false, api_key: '', has_api_key: false, assignee_name_filter: '' })
  const [blTestResult, setBlTestResult] = useState<{ success: boolean; total?: number; error?: string } | null>(null)
  const [blSyncResult, setBlSyncResult] = useState<{ synced: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMsg(null)
    setApiKey('')
    api.get('/me').then((r) => {
      setKeySet(!!r.data.openai_api_key_set)
      setClosingDay(r.data.closing_day ?? 25)
      setTransit({
        from: r.data.default_transit_from ?? '',
        to: r.data.default_transit_to ?? '',
        fee: r.data.default_transit_fee ?? 0,
        line: r.data.default_transit_line ?? '',
      })
      setRoutes(r.data.transit_routes ?? [])
      setCommuteDays(r.data.commute_days ?? [1, 2, 3, 4, 5])
      setScheduleUrl(r.data.attendance_schedule_url ?? '')
    })
    api.get('/invoice_setting', { params: { category: invCat } }).then((r) => setInv(r.data))
    api.get('/backlog/setting').then((r) => setBlSetting((prev) => ({ ...prev, ...r.data })))
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
        default_transit_from: transit.from,
        default_transit_to: transit.to,
        default_transit_fee: transit.fee,
        default_transit_line: transit.line,
        transit_routes: routes,
        commute_days: commuteDays,
        attendance_schedule_url: scheduleUrl,
      }
      if (apiKey) payload.openai_api_key = apiKey
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
      await api.patch('/invoice_setting', { invoice_setting: inv, category: invCat })
      setMsg('保存しました')
      onSaved?.()
    } catch (e: any) {
      setMsg(e?.response?.data?.error?.toString() ?? '保存に失敗')
    } finally {
      setSaving(false)
    }
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

        <div className="mt-5 flex gap-2">
          {(['account', 'invoice', 'backlog'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${
                tab === t ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)] hover:text-[var(--color-text)]'
              }`}
            >
              {t === 'account' ? 'アカウント' : t === 'invoice' ? '請求書' : 'バックログ'}
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
              {([['wings', 'Wings'], ['living', 'リビング'], ['techleaders', 'テックリーダーズ'], ['resystems', 'REシステムズ']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setInvCat(key)}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                    invCat === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)]'
                  }`}>{label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {fld('請求先 (御中)', 'client_name')}
              {fld('件名', 'subject')}
              {fld('品目ラベル', 'item_label', 'text', 'col-span-1')}
              {fld('単価 (円/h)', 'unit_price', 'number', 'col-span-1')}
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
      </div>
    </div>
  )
}
