import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'

// 確定申告用の事業経費。レシート撮影(📷FAB)・明細CSV取込・年間集計(申告)まで。
// 画面は「月次」「年間(申告)」のピル切替 + 右下フローティング撮影ボタンのみ（下部タブは置かない）。
// admin(西野)専用。

type BusinessExpense = {
  id: number
  expense_date: string | null
  store_name: string | null
  amount: number | null
  tax_rate: number
  account_category: string | null
  memo: string | null
  business_ratio: number
  deductible_amount: number
  status: 'needs_review' | 'confirmed'
  ai_confidence: number | null
  has_receipt: boolean
}
type Summary = {
  total: number
  deductible_total: number
  count: number
  needs_review_count: number
  by_category: { category: string; total: number; count: number }[]
}
type ImportRow = {
  date: string
  description: string
  amount: number
  import_hash: string
  business: boolean
  account_category: string | null
  memo: string | null
  confidence: number
  duplicate: boolean
  checked?: boolean
}
type TaxSummary = {
  year: number
  income_total: number
  expense_total: number
  depreciation_total: number
  profit: number
  by_category: { category: string; total: number; count: number }[]
  monthly: { month: number; income: number; expense: number }[]
  expense_count: number
  needs_review_count: number
}
type FixedAsset = {
  id: number
  name: string
  acquired_on: string
  cost: number
  useful_life_years: number
  business_ratio: number
  memo: string | null
  depreciation_this_year: number
}

const CATEGORIES = [
  '租税公課', '荷造運賃', '水道光熱費', '旅費交通費', '通信費',
  '広告宣伝費', '接待交際費', '損害保険料', '修繕費', '消耗品費',
  '減価償却費', '福利厚生費', '給料賃金', '外注工賃', '利子割引料',
  '地代家賃', '貸倒金', '会議費', '新聞図書費', '支払手数料',
  '車両費', '雑費',
]
const CAT_ICON: Record<string, string> = {
  租税公課: '🏛️', 荷造運賃: '📦', 水道光熱費: '💡', 旅費交通費: '🚃', 通信費: '📶',
  広告宣伝費: '📢', 接待交際費: '🍶', 損害保険料: '🛡️', 修繕費: '🔧', 消耗品費: '🖇️',
  減価償却費: '🏗️', 福利厚生費: '🎁', 給料賃金: '👥', 外注工賃: '🤝', 利子割引料: '🏦',
  地代家賃: '🏠', 貸倒金: '⚠️', 会議費: '☕', 新聞図書費: '📚', 支払手数料: '🧾',
  車両費: '🚗', 雑費: '🌀',
}
const yen = (n: number | null | undefined) => (n == null ? '—' : `¥${n.toLocaleString()}`)
const thisMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
const downloadBlob = (blob: Blob, filename: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function BusinessExpensesPage() {
  const [view, setView] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(thisMonth())
  const [year, setYear] = useState(new Date().getFullYear())
  const [items, setItems] = useState<BusinessExpense[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [catFilter, setCatFilter] = useState('')
  const [editing, setEditing] = useState<BusinessExpense | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const csvRef = useRef<HTMLInputElement | null>(null)

  // CSV取込
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importing, setImporting] = useState(false)

  // 年間(申告)
  const [tax, setTax] = useState<TaxSummary | null>(null)
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [assetForm, setAssetForm] = useState({ name: '', acquired_on: '', cost: '', useful_life_years: '4', business_ratio: 100 })
  const [showAssetForm, setShowAssetForm] = useState(false)

  const load = async () => {
    const r = await api.get<{ expenses: BusinessExpense[]; summary: Summary }>('/business_expenses', { params: { month } })
    setItems(r.data.expenses)
    setSummary(r.data.summary)
  }
  const loadTax = async () => {
    const [s, a] = await Promise.all([
      api.get<TaxSummary>('/tax_reports/summary', { params: { year } }),
      api.get<FixedAsset[]>('/fixed_assets', { params: { year } }),
    ])
    setTax(s.data)
    setAssets(a.data)
  }
  useEffect(() => { void load().catch(() => setMsg('読み込みに失敗しました')) }, [month])
  useEffect(() => { if (view === 'year') void loadTax().catch(() => setMsg('集計の読み込みに失敗しました')) }, [view, year])

  // 📷 レシート撮影 → AI読取 → 確認モーダル
  const onShot = async (file: File | null) => {
    if (!file) return
    setUploading(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post<BusinessExpense>('/business_expenses', fd)
      await load()
      setEditing(r.data)
    } catch (e: any) {
      setMsg(`読取失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 📥 明細CSV → AI仕訳プレビュー
  const onCsv = async (file: File | null) => {
    if (!file) return
    setImporting(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post<{ rows: ImportRow[] }>('/business_expenses/import_csv', fd)
      setImportRows(r.data.rows.map((row) => ({ ...row, checked: row.business && !row.duplicate })))
    } catch (e: any) {
      setMsg(`CSV解析失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setImporting(false)
      if (csvRef.current) csvRef.current.value = ''
    }
  }
  const commitImport = async () => {
    if (!importRows) return
    const rows = importRows.filter((r) => r.checked && !r.duplicate)
    if (rows.length === 0) { setImportRows(null); return }
    setImporting(true)
    try {
      const r = await api.post<{ imported: number; skipped: number }>('/business_expenses/import_commit', {
        rows: rows.map((row) => ({ date: row.date, description: row.description, amount: row.amount, account_category: row.account_category, memo: row.memo, import_hash: row.import_hash })),
      })
      setImportRows(null)
      setMsg(`✅ ${r.data.imported}件取り込みました${r.data.skipped ? `（重複スキップ${r.data.skipped}件）` : ''}`)
      await load()
    } catch (e: any) {
      setMsg(`取込失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setImporting(false) }
  }

  // 編集モーダルのレシート画像 (JWT付きのため blob 経由)
  useEffect(() => {
    if (!editing?.has_receipt) { setReceiptUrl(null); return }
    let objectUrl: string | null = null
    let cancelled = false
    api.get(`/business_expenses/${editing.id}/receipt`, { responseType: 'blob' })
      .then((r) => { if (!cancelled) { objectUrl = URL.createObjectURL(r.data as Blob); setReceiptUrl(objectUrl) } })
      .catch(() => setReceiptUrl(null))
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [editing?.id, editing?.has_receipt])

  const saveEditing = async () => {
    if (!editing) return
    try {
      await api.patch(`/business_expenses/${editing.id}`, {
        expense_date: editing.expense_date, store_name: editing.store_name ?? '', amount: editing.amount,
        tax_rate: editing.tax_rate, account_category: editing.account_category, memo: editing.memo ?? '',
        business_ratio: editing.business_ratio, status: 'confirmed',
      })
      setEditing(null)
      await load()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  const removeEditing = async () => {
    if (!editing || !confirm('この経費を削除しますか？')) return
    await api.delete(`/business_expenses/${editing.id}`)
    setEditing(null)
    await load()
  }

  const addAsset = async () => {
    try {
      await api.post('/fixed_assets', { ...assetForm, cost: Number(assetForm.cost), useful_life_years: Number(assetForm.useful_life_years) })
      setAssetForm({ name: '', acquired_on: '', cost: '', useful_life_years: '4', business_ratio: 100 })
      setShowAssetForm(false)
      await loadTax()
    } catch (e: any) {
      setMsg(`資産登録失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  const removeAsset = async (id: number) => {
    if (!confirm('この資産を削除しますか？')) return
    await api.delete(`/fixed_assets/${id}`)
    await loadTax()
  }
  const downloadTaxCsv = async (kind: 'summary' | 'details') => {
    const r = await api.get('/tax_reports/export_csv', { params: { year, kind }, responseType: 'blob' })
    downloadBlob(r.data as Blob, kind === 'details' ? `経費明細_${year}年.csv` : `青色申告集計_${year}年.csv`)
  }

  const filtered = useMemo(() => (catFilter ? items.filter((it) => it.account_category === catFilter) : items), [items, catFilter])
  const maxCatTotal = Math.max(1, ...(summary?.by_category.map((c) => c.total) ?? [1]))
  const shiftMonth = (diff: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + diff, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const Row = ({ it }: { it: BusinessExpense }) => (
    <button onClick={() => setEditing(it)} className="flex w-full items-center gap-3 border-b border-[var(--color-border)] bg-white px-3 py-2.5 text-left last:border-b-0 hover:bg-fuchsia-50/40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fuchsia-50 text-lg">{CAT_ICON[it.account_category ?? ''] ?? '🧾'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-[var(--color-text)]">{it.store_name || '（店名なし）'}</span>
        <span className="block text-[11px] text-[var(--color-text-sub)]">{it.expense_date ?? '日付なし'} ・ {it.account_category ?? '未分類'}{it.business_ratio < 100 ? ` ・ 按分${it.business_ratio}%` : ''}</span>
      </span>
      <span className="text-right">
        <span className="block text-sm font-semibold tabular-nums">{yen(it.amount)}</span>
        {it.status === 'needs_review' && <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">要確認</span>}
      </span>
    </button>
  )

  return (
    <div className="mx-auto max-w-2xl pb-24">
      {/* ヘッダー: タイトル + ピル切替 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-[var(--color-text)]">🧾 経費（確定申告）</h1>
        <div className="flex rounded-full border border-[var(--color-border)] bg-white p-0.5 text-sm">
          <button onClick={() => setView('month')} className={`rounded-full px-4 py-1 ${view === 'month' ? 'bg-fuchsia-500 text-white font-semibold' : 'text-[var(--color-text-sub)]'}`}>月次</button>
          <button onClick={() => setView('year')} className={`rounded-full px-4 py-1 ${view === 'year' ? 'bg-fuchsia-500 text-white font-semibold' : 'text-[var(--color-text-sub)]'}`}>年間（申告）</button>
        </div>
      </div>
      {msg && <div className={`mb-2 rounded-lg px-3 py-2 text-xs ${msg.includes('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg}</div>}

      {/* ============ 月次ビュー ============ */}
      {view === 'month' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-1 py-0.5">
              <button onClick={() => shiftMonth(-1)} className="px-2 text-[var(--color-text-sub)]">‹</button>
              <span className="text-sm font-semibold tabular-nums">{month.replace('-', '年')}月</span>
              <button onClick={() => shiftMonth(1)} className="px-2 text-[var(--color-text-sub)]">›</button>
            </div>
            <button onClick={() => csvRef.current?.click()} disabled={importing}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50"
              title="銀行・クレジットカードの明細CSVをAIで仕訳して取り込む">
              {importing ? '解析中…' : '📥 明細CSV取込'}
            </button>
          </div>

          {summary && (
            <div className="rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-md">
              <div className="text-xs opacity-90">今月の経費（計上額・家事按分後）</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{yen(summary.deductible_total)}</div>
              <div className="mt-1 text-[11px] opacity-90">{summary.count}件 ／ 税込支払額 {yen(summary.total)}{summary.needs_review_count > 0 ? ` ／ ⚠️ 要確認 ${summary.needs_review_count}件` : ''}</div>
            </div>
          )}

          {summary && summary.by_category.length > 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white p-3 space-y-1.5">
              {summary.by_category.slice(0, 5).map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-xs"><span>{CAT_ICON[c.category] ?? '🧾'} {c.category}</span><span className="tabular-nums font-medium">{yen(c.total)}</span></div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-gradient-to-r from-fuchsia-400 to-pink-400" style={{ width: `${Math.round((c.total / maxCatTotal) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex gap-1.5 overflow-x-auto">
              <button onClick={() => setCatFilter('')} className={`shrink-0 rounded-full px-3 py-1 text-xs ${catFilter === '' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)]'}`}>すべて</button>
              {CATEGORIES.filter((c) => items.some((it) => it.account_category === c)).map((c) => (
                <button key={c} onClick={() => setCatFilter(c)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${catFilter === c ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)]'}`}>{CAT_ICON[c]} {c}</button>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
              {filtered.map((it) => <Row key={it.id} it={it} />)}
              {filtered.length === 0 && <div className="p-6 text-center text-xs text-[var(--color-text-sub)]">この月の経費はありません。右下の 📷 でレシートを撮影するか、「📥 明細CSV取込」から始められます。</div>}
            </div>
          </div>
        </div>
      )}

      {/* ============ 年間（申告）ビュー ============ */}
      {view === 'year' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-1 py-0.5">
              <button onClick={() => setYear((y) => y - 1)} className="px-2 text-[var(--color-text-sub)]">‹</button>
              <span className="text-sm font-semibold tabular-nums">{year}年分</span>
              <button onClick={() => setYear((y) => y + 1)} className="px-2 text-[var(--color-text-sub)]">›</button>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => downloadTaxCsv('summary')} className="rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50" title="青色申告決算書へ転記できる科目別集計CSV">📊 集計CSV</button>
              <button onClick={() => downloadTaxCsv('details')} className="rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50" title="経費明細の一覧CSV">📄 明細CSV</button>
            </div>
          </div>

          {tax && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-3"><div className="text-[10px] text-[var(--color-text-sub)]">売上（承認済請求書）</div><div className="mt-0.5 text-base font-bold tabular-nums text-sky-700">{yen(tax.income_total)}</div></div>
                <div className="rounded-xl border border-[var(--color-border)] bg-white p-3"><div className="text-[10px] text-[var(--color-text-sub)]">経費（減価償却込）</div><div className="mt-0.5 text-base font-bold tabular-nums text-rose-600">{yen(tax.expense_total)}</div></div>
                <div className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 p-3 text-white"><div className="text-[10px] opacity-90">差引金額（所得）</div><div className="mt-0.5 text-base font-bold tabular-nums">{yen(tax.profit)}</div></div>
              </div>
              {tax.needs_review_count > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠️ AI読取の確認待ち経費が {tax.needs_review_count} 件あります（月次ビューで確認してください）</div>
              )}

              <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-[var(--color-text-sub)]">勘定科目別（家事按分後・年間）</div>
                {tax.by_category.map((c) => (
                  <div key={c.category} className="flex items-center justify-between border-b border-gray-50 py-1 text-sm last:border-b-0">
                    <span>{CAT_ICON[c.category] ?? '🧾'} {c.category} <span className="text-[10px] text-[var(--color-text-sub)]">({c.count}件)</span></span>
                    <span className="tabular-nums font-medium">{yen(c.total)}</span>
                  </div>
                ))}
                {tax.by_category.length === 0 && <div className="py-2 text-xs text-[var(--color-text-sub)]">経費データがありません</div>}
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold text-[var(--color-text-sub)]">🏗️ 減価償却資産（定額法・月割）</div>
                  <button onClick={() => setShowAssetForm((v) => !v)} className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] text-[var(--color-text-sub)]">{showAssetForm ? '閉じる' : '＋ 資産を追加'}</button>
                </div>
                {showAssetForm && (
                  <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-lg bg-gray-50 p-2 text-xs">
                    <input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="資産名 (例: MacBook Pro)" className="col-span-2 rounded border border-[var(--color-border)] px-2 py-1.5" />
                    <input type="date" value={assetForm.acquired_on} onChange={(e) => setAssetForm({ ...assetForm, acquired_on: e.target.value })} className="rounded border border-[var(--color-border)] px-2 py-1.5" />
                    <input type="number" value={assetForm.cost} onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })} placeholder="取得価額(円)" className="rounded border border-[var(--color-border)] px-2 py-1.5 text-right" />
                    <label className="flex items-center gap-1">耐用年数<input type="number" min={2} max={50} value={assetForm.useful_life_years} onChange={(e) => setAssetForm({ ...assetForm, useful_life_years: e.target.value })} className="w-14 rounded border border-[var(--color-border)] px-2 py-1.5 text-right" />年</label>
                    <label className="flex items-center gap-1">事業割合<input type="number" min={1} max={100} value={assetForm.business_ratio} onChange={(e) => setAssetForm({ ...assetForm, business_ratio: Number(e.target.value) })} className="w-14 rounded border border-[var(--color-border)] px-2 py-1.5 text-right" />%</label>
                    <button onClick={addAsset} disabled={!assetForm.name || !assetForm.acquired_on || !assetForm.cost} className="col-span-2 rounded bg-fuchsia-500 px-2 py-1.5 font-semibold text-white disabled:opacity-40">登録</button>
                  </div>
                )}
                {assets.map((a) => (
                  <div key={a.id} className="flex items-center justify-between border-b border-gray-50 py-1.5 text-sm last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block text-[10px] text-[var(--color-text-sub)]">{a.acquired_on} 取得 ・ {yen(a.cost)} ・ {a.useful_life_years}年{a.business_ratio < 100 ? ` ・ 事業${a.business_ratio}%` : ''}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-xs">今年 {yen(a.depreciation_this_year)}</span>
                      <button onClick={() => removeAsset(a.id)} className="text-gray-300 hover:text-red-500">🗑</button>
                    </span>
                  </div>
                ))}
                {assets.length === 0 && <div className="py-1 text-xs text-[var(--color-text-sub)]">10万円以上の備品(PC等)を登録すると減価償却費を自動計算します</div>}
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-[var(--color-text-sub)]">月別推移</div>
                <table className="w-full text-xs tabular-nums">
                  <thead><tr className="text-[var(--color-text-sub)]"><th className="text-left font-normal">月</th><th className="text-right font-normal">売上</th><th className="text-right font-normal">経費</th></tr></thead>
                  <tbody>
                    {tax.monthly.map((m) => (
                      <tr key={m.month} className="border-t border-gray-50"><td className="py-1">{m.month}月</td><td className="text-right">{m.income ? yen(m.income) : '—'}</td><td className="text-right">{m.expense ? yen(m.expense) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-[var(--color-text-sub)]">※ e-Tax への申告は「確定申告書等作成コーナー」で行ってください。上の「📊 集計CSV」の科目別金額をそのまま転記できます。</div>
            </>
          )}
        </div>
      )}

      {/* 隠しファイル入力 + 右下フローティング📷 */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onShot(e.target.files?.[0] ?? null)} />
      <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onCsv(e.target.files?.[0] ?? null)} />
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        className="fixed bottom-6 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-2xl text-white shadow-xl transition active:scale-95 disabled:opacity-60"
        title="レシートを撮影">
        {uploading ? <span className="animate-pulse text-xs">解析中</span> : '📷'}
      </button>

      {/* CSV取込プレビューモーダル */}
      {importRows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setImportRows(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-bold">📥 明細CSV取込プレビュー（AI仕訳）</div>
              <button onClick={() => setImportRows(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="mb-2 text-[11px] text-[var(--color-text-sub)]">チェックした行を経費として取り込みます。AIが「私的支出っぽい」と判定した行はチェックを外してあります。科目は変更できます。</div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--color-border)]">
              {importRows.map((row, i) => (
                <div key={row.import_hash} className={`flex items-center gap-2 border-b border-gray-50 px-2 py-1.5 text-xs last:border-b-0 ${row.duplicate ? 'opacity-40' : ''}`}>
                  <input type="checkbox" checked={!!row.checked && !row.duplicate} disabled={row.duplicate}
                    onChange={(e) => setImportRows((prev) => prev!.map((r, idx) => (idx === i ? { ...r, checked: e.target.checked } : r)))} />
                  <span className="w-20 shrink-0 tabular-nums text-[var(--color-text-sub)]">{row.date}</span>
                  <span className="min-w-0 flex-1 truncate" title={row.description}>{row.description}{row.duplicate && <span className="ml-1 rounded bg-gray-200 px-1 text-[9px]">取込済</span>}{!row.business && !row.duplicate && <span className="ml-1 rounded bg-gray-100 px-1 text-[9px] text-gray-500">私的?</span>}</span>
                  <select value={row.account_category ?? ''} disabled={row.duplicate}
                    onChange={(e) => setImportRows((prev) => prev!.map((r, idx) => (idx === i ? { ...r, account_category: e.target.value || null } : r)))}
                    className="w-28 shrink-0 rounded border border-[var(--color-border)] bg-white px-1 py-0.5 text-[11px]">
                    <option value="">未分類</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{yen(row.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-sub)]">選択 {importRows.filter((r) => r.checked && !r.duplicate).length} / {importRows.length} 件</span>
              <button onClick={commitImport} disabled={importing} className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50">
                {importing ? '取込中…' : '✓ 選択した行を取り込む'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 経費の確認・編集モーダル */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-bold">🧾 経費の確認{editing.status === 'needs_review' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">AI読取・要確認{editing.ai_confidence != null ? ` (確信度${editing.ai_confidence}%)` : ''}</span>}</div>
              <button onClick={() => setEditing(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            {receiptUrl && <img src={receiptUrl} alt="レシート" className="mb-3 max-h-56 w-full rounded-lg border border-[var(--color-border)] bg-gray-50 object-contain" />}
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-[11px] font-semibold">日付</span>
                  <input type="date" value={editing.expense_date ?? ''} onChange={(e) => setEditing({ ...editing, expense_date: e.target.value })} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5" /></label>
                <label className="block"><span className="text-[11px] font-semibold">金額（税込）</span>
                  <input type="number" inputMode="numeric" value={editing.amount ?? ''} onChange={(e) => setEditing({ ...editing, amount: e.target.value === '' ? null : Number(e.target.value) })} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-right font-mono" /></label>
              </div>
              <label className="block"><span className="text-[11px] font-semibold">店名・支払先</span>
                <input value={editing.store_name ?? ''} onChange={(e) => setEditing({ ...editing, store_name: e.target.value })} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-[11px] font-semibold">勘定科目</span>
                  <select value={editing.account_category ?? ''} onChange={(e) => setEditing({ ...editing, account_category: e.target.value || null })} className="w-full rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5">
                    <option value="">未分類</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}
                  </select></label>
                <label className="block"><span className="text-[11px] font-semibold">税率</span>
                  <select value={editing.tax_rate} onChange={(e) => setEditing({ ...editing, tax_rate: Number(e.target.value) })} className="w-full rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5">
                    <option value={10}>10%</option><option value={8}>8%（軽減）</option><option value={0}>非課税</option>
                  </select></label>
              </div>
              <label className="block"><span className="text-[11px] font-semibold">メモ</span>
                <input value={editing.memo ?? ''} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} placeholder="例) 打合せコーヒー2名" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5" /></label>
              <label className="block"><span className="text-[11px] font-semibold">事業使用割合（家事按分）: {editing.business_ratio}%</span>
                <input type="range" min={10} max={100} step={5} value={editing.business_ratio} onChange={(e) => setEditing({ ...editing, business_ratio: Number(e.target.value) })} className="w-full accent-fuchsia-500" /></label>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button onClick={removeEditing} className="rounded-md border border-red-200 px-3 py-2 text-xs text-red-500 hover:bg-red-50">🗑 削除</button>
              <button onClick={saveEditing} className="flex-1 rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow">✓ 確認して保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
