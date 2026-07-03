import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'

// 確定申告用の事業経費（freee風）。レシート撮影→AI読取→勘定科目分類→登録。
// 下部タブ(ホーム/経費/レポート) + 中央の📷撮影ボタン。西野(admin)専用。

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

export default function BusinessExpensesPage() {
  const [tab, setTab] = useState<'home' | 'list' | 'report'>('home')
  const [month, setMonth] = useState(thisMonth())
  const [items, setItems] = useState<BusinessExpense[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [catFilter, setCatFilter] = useState('')
  const [editing, setEditing] = useState<BusinessExpense | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = async () => {
    const r = await api.get<{ expenses: BusinessExpense[]; summary: Summary }>('/business_expenses', { params: { month } })
    setItems(r.data.expenses)
    setSummary(r.data.summary)
  }
  useEffect(() => { void load().catch(() => setMsg('読み込みに失敗しました')) }, [month])

  // 📷 撮影→アップロード→AI読取→確認モーダル
  const onShot = async (file: File | null) => {
    if (!file) return
    setUploading(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post<BusinessExpense>('/business_expenses', fd)
      await load()
      setEditing(r.data) // AI読取結果を確認カードで開く
    } catch (e: any) {
      setMsg(`読取失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // 編集モーダルを開いたらレシート画像を取得（JWT付きのため blob 経由）
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
        expense_date: editing.expense_date,
        store_name: editing.store_name ?? '',
        amount: editing.amount,
        tax_rate: editing.tax_rate,
        account_category: editing.account_category,
        memo: editing.memo ?? '',
        business_ratio: editing.business_ratio,
        status: 'confirmed',
      })
      setEditing(null)
      await load()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  const removeEditing = async () => {
    if (!editing || !confirm('この経費を削除しますか？（レシート画像も消えます）')) return
    await api.delete(`/business_expenses/${editing.id}`)
    setEditing(null)
    await load()
  }

  const filtered = useMemo(() => (catFilter ? items.filter((it) => it.account_category === catFilter) : items), [items, catFilter])
  const maxCatTotal = Math.max(1, ...(summary?.by_category.map((c) => c.total) ?? [1]))
  const shiftMonth = (diff: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + diff, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const Row = ({ it }: { it: BusinessExpense }) => (
    <button onClick={() => setEditing(it)} className="flex w-full items-center gap-3 border-b border-[var(--color-border)] bg-white px-3 py-2.5 text-left hover:bg-fuchsia-50/40">
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
    <div className="mx-auto max-w-xl pb-24">
      {/* 月ナビ */}
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-[var(--color-text)]">🧾 経費（確定申告）</h1>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-1 py-0.5">
          <button onClick={() => shiftMonth(-1)} className="px-2 text-[var(--color-text-sub)]">‹</button>
          <span className="text-sm font-semibold tabular-nums">{month.replace('-', '年')}月</span>
          <button onClick={() => shiftMonth(1)} className="px-2 text-[var(--color-text-sub)]">›</button>
        </div>
      </div>
      {msg && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{msg}</div>}

      {/* ホーム: 今月サマリ */}
      {tab === 'home' && summary && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-md">
            <div className="text-xs opacity-90">今月の経費（計上額・家事按分後）</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{yen(summary.deductible_total)}</div>
            <div className="mt-1 text-[11px] opacity-90">{summary.count}件 ／ 税込支払額 {yen(summary.total)}</div>
          </div>
          {summary.needs_review_count > 0 && (
            <button onClick={() => setTab('list')} className="flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <span>⚠️ AI読取の確認待ちが {summary.needs_review_count} 件あります</span><span>›</span>
            </button>
          )}
          <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
            <div className="mb-2 text-xs font-semibold text-[var(--color-text-sub)]">科目トップ</div>
            {summary.by_category.slice(0, 5).map((c) => (
              <div key={c.category} className="flex items-center justify-between py-1 text-sm">
                <span>{CAT_ICON[c.category] ?? '🧾'} {c.category}</span>
                <span className="tabular-nums font-medium">{yen(c.total)}</span>
              </div>
            ))}
            {summary.by_category.length === 0 && <div className="py-2 text-xs text-[var(--color-text-sub)]">まだ経費がありません。📷 でレシートを撮影してみてください。</div>}
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
            <div className="px-3 pt-3 pb-1 text-xs font-semibold text-[var(--color-text-sub)]">最近の経費</div>
            {items.slice(0, 5).map((it) => <Row key={it.id} it={it} />)}
          </div>
        </div>
      )}

      {/* 経費一覧 */}
      {tab === 'list' && (
        <div className="space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button onClick={() => setCatFilter('')} className={`shrink-0 rounded-full px-3 py-1 text-xs ${catFilter === '' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)]'}`}>すべて</button>
            {CATEGORIES.filter((c) => items.some((it) => it.account_category === c)).map((c) => (
              <button key={c} onClick={() => setCatFilter(c)} className={`shrink-0 rounded-full px-3 py-1 text-xs ${catFilter === c ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] bg-white text-[var(--color-text-sub)]'}`}>{CAT_ICON[c]} {c}</button>
            ))}
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
            {filtered.map((it) => <Row key={it.id} it={it} />)}
            {filtered.length === 0 && <div className="p-4 text-center text-xs text-[var(--color-text-sub)]">この月の経費はありません</div>}
          </div>
          {summary && <div className="text-right text-sm font-semibold tabular-nums">合計 {yen(filtered.reduce((a, it) => a + (it.amount ?? 0), 0))}</div>}
        </div>
      )}

      {/* レポート: 科目別 */}
      {tab === 'report' && summary && (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-3 space-y-2">
          <div className="text-xs font-semibold text-[var(--color-text-sub)]">科目別（計上額）</div>
          {summary.by_category.map((c) => (
            <div key={c.category}>
              <div className="flex justify-between text-xs"><span>{CAT_ICON[c.category] ?? '🧾'} {c.category}（{c.count}件）</span><span className="tabular-nums font-medium">{yen(c.total)}</span></div>
              <div className="mt-0.5 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-pink-400" style={{ width: `${Math.round((c.total / maxCatTotal) * 100)}%` }} /></div>
            </div>
          ))}
          {summary.by_category.length === 0 && <div className="py-2 text-xs text-[var(--color-text-sub)]">データがありません</div>}
        </div>
      )}

      {/* 下部タブバー + 中央📷 (freee風) */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onShot(e.target.files?.[0] ?? null)} />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-1.5">
          {([['home', '🏠', 'ホーム'], ['list', '📄', '経費']] as const).map(([key, icon, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`flex flex-col items-center px-3 py-1 text-[10px] ${tab === key ? 'text-fuchsia-600 font-semibold' : 'text-[var(--color-text-sub)]'}`}>
              <span className="text-lg leading-none">{icon}</span>{label}
            </button>
          ))}
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="-mt-6 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-2xl text-white shadow-lg active:scale-95 disabled:opacity-60"
            title="レシートを撮影">
            {uploading ? <span className="animate-pulse text-sm">解析中</span> : '📷'}
          </button>
          <button onClick={() => setTab('report')} className={`flex flex-col items-center px-3 py-1 text-[10px] ${tab === 'report' ? 'text-fuchsia-600 font-semibold' : 'text-[var(--color-text-sub)]'}`}>
            <span className="text-lg leading-none">📊</span>レポート
          </button>
          <span className="w-10" />
        </div>
      </nav>

      {/* 確認・編集モーダル (AI読取結果の修正 → 確認して保存) */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-bold">🧾 経費の確認{editing.status === 'needs_review' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">AI読取・要確認{editing.ai_confidence != null ? ` (確信度${editing.ai_confidence}%)` : ''}</span>}</div>
              <button onClick={() => setEditing(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            {receiptUrl && <img src={receiptUrl} alt="レシート" className="mb-3 max-h-56 w-full rounded-lg border border-[var(--color-border)] object-contain bg-gray-50" />}
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
                  <select value={editing.account_category ?? ''} onChange={(e) => setEditing({ ...editing, account_category: e.target.value || null })} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 bg-white">
                    <option value="">未分類</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}
                  </select></label>
                <label className="block"><span className="text-[11px] font-semibold">税率</span>
                  <select value={editing.tax_rate} onChange={(e) => setEditing({ ...editing, tax_rate: Number(e.target.value) })} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 bg-white">
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
