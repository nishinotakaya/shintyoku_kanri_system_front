import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ExpenseResponse, WorkReportResponse, Me } from '../lib/api'
import { DEFAULT_WORK_CATEGORIES, WORK_CATEGORY_LABELS, visibleWorkCategories } from '../lib/workCategories'
import type { WorkCategory } from '../lib/workCategories'
import ClockCard from '../components/ClockCard'
import WorkReportTable from '../components/WorkReportTable'
import TransportWorkReportTable from '../components/TransportWorkReportTable'
import ExpenseTable from '../components/ExpenseTable'
import SettingsModal from '../components/SettingsModal'
import PurchaseOrderList from '../components/PurchaseOrderList'
import FolderSaveButtons, { fetchExportBlob } from '../components/FolderSaveButtons'
import InvoiceSubmissionPanel from '../components/InvoiceSubmissionPanel'
import SelfInvoiceMailModal from '../components/SelfInvoiceMailModal'
import { billingMonthForToday } from '../lib/billingMonth'
// CalendarView moved to /calendar page

const todayIso = () => new Date().toISOString().slice(0, 10)

// work_categories が未設定なら、従来どおり admin=全4カテゴリ／非admin=Wings・リビングのみ という見え方を維持する。
// work_categories が設定されているユーザー(例: 運送の雄太郎)は admin/非admin に関わらずその設定に従う。
const visibleCategoriesFor = (me: Me | null): WorkCategory[] => {
  const legacyCategories = me?.admin
    ? DEFAULT_WORK_CATEGORIES
    : DEFAULT_WORK_CATEGORIES.filter((key) => key === 'wings' || key === 'living')
  return me?.work_categories?.length ? visibleWorkCategories(me) : legacyCategories
}

// 今期サマリに請求書行を出すカテゴリ(見えるものだけ出す)
const SUMMARY_CATEGORIES: WorkCategory[] = ['wings', 'living', 'transport']

export default function Dashboard() {
  // 締日基準で今日が含まれる請求月を初期表示（closing_day=25 既定）
  const initial = billingMonthForToday(25)
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [didAlignToBilling, setDidAlignToBilling] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'account' | 'invoice'>('account')
  const [defaultTransit, setDefaultTransit] = useState<{ section: string; fee: number } | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  // 選択中カテゴリ。/me が返るまで wings を仮置きしない(運送専用ユーザーに一瞬 Tama の画面・請求プレビューが出て
  // 「シェアラウンジ利用料」等の Tama 既定が混入していた)。見えないカテゴリを選んだままにもしない。
  const [pickedCategory, setPickedCategory] = useState<WorkCategory | null>(null)
  const visibleCategories = useMemo(() => visibleCategoriesFor(me), [me])
  const category: WorkCategory = pickedCategory && visibleCategories.includes(pickedCategory) ? pickedCategory : visibleCategories[0]
  const categoryReady = me !== null

  // 管理者のみ: 「他ユーザーとして閲覧」セレクトボックスで切替
  const [asUserId, setAsUserId] = useState<number | null>(null)
  const [searchParams] = useSearchParams()
  // URL query ?as_user_id=N で UsersPage からのなりすまし起動を受ける
  useEffect(() => {
    const q = searchParams.get('as_user_id')
    if (q) {
      const id = Number(q)
      if (id && id !== asUserId) setAsUserId(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [pickableUsers, setPickableUsers] = useState<{ id: number; display_name: string; email: string; admin: boolean }[]>([])
  useEffect(() => {
    if (!me?.admin) return
    api.get('/users/pickable').then((r) => setPickableUsers(r.data)).catch(() => {})
  }, [me?.admin])
  const isAdmin = !!me?.admin
  const isOsumi = (me?.display_name ?? '').includes('大隅')
  const asUserParam = isAdmin && asUserId && asUserId !== me?.id ? { as_user_id: asUserId } : {}

  const monthParam = `${year}-${String(month).padStart(2, '0')}`

  const reportsQ = useQuery({
    queryKey: ['work_reports', monthParam, asUserId],
    queryFn: async () => (await api.get<WorkReportResponse>('/work_reports', { params: { month: monthParam, ...asUserParam } })).data,
  })
  const expensesQ = useQuery({
    queryKey: ['expenses', monthParam, asUserId],
    queryFn: async () => (await api.get<ExpenseResponse>('/expenses', { params: { month: monthParam, ...asUserParam } })).data,
  })

  const reports = reportsQ.data?.reports ?? []
  const expenses = expensesQ.data?.expenses ?? []
  const period = reportsQ.data?.period ?? null
  const today = useMemo(() => reports.find((r) => r.work_date === todayIso()) ?? null, [reports])

  // 表示中の期間に「今日」が含まれているときだけ打刻可能
  const clockEnabled = useMemo(() => {
    if (!period) return false
    const t = todayIso()
    return period.from <= t && t <= period.to
  }, [period])

  const invoiceQ = useQuery({
    queryKey: ['invoice_preview', monthParam, category, asUserId],
    queryFn: async () => (await api.get('/invoice_preview', { params: { month: monthParam, category, ...asUserParam } })).data,
    enabled: categoryReady,
  })
  // 今期サマリに請求書行を出すカテゴリ。従来どおり wings/living に、運送専用ユーザーの transport を加える
  // (techleaders/resystems は従来どおり出さない)。/me が返るまでは空配列にして、wings/living を仮置きした
  // 請求プレビューを投げない(運送ユーザーの初回描画で wings/living のプレビューが飛んでいた)。
  const summaryCategories = useMemo(
    () => (me ? visibleCategories.filter((workCategory) => SUMMARY_CATEGORIES.includes(workCategory)) : []),
    [me, visibleCategories],
  )
  // 川村パネルの一括申請ボタンは wings/living だけ。運送専用ユーザーは空配列になりボタンを出さない
  const wingsLivingCategories = useMemo(
    () => summaryCategories.filter((workCategory) => workCategory === 'wings' || workCategory === 'living'),
    [summaryCategories],
  )
  const summaryInvoiceQueries = useQueries({
    queries: summaryCategories.map((summaryCategory) => ({
      queryKey: ['invoice_preview', monthParam, summaryCategory, asUserId],
      queryFn: async () => (await api.get('/invoice_preview', { params: { month: monthParam, category: summaryCategory, ...asUserParam } })).data,
    })),
  })

  // 紐付け候補: この月/カテゴリの 受領 PO (自分(=admin)以外のユーザーに紐付くもの)
  type LinkPO = { id: number; order_no: string; subject: string | null; user_id: number; user_display_name?: string | null; customer_name?: string | null; category: string | null; period_start: string | null; period_end: string | null; total_amount: number | null; has_pdf?: boolean }
  const linkPosQ = useQuery({
    queryKey: ['link_received_pos', monthParam, category, asUserId],
    queryFn: async () => (await api.get<LinkPO[]>('/received_purchase_orders', { params: { year, month, ...asUserParam } })).data,
    enabled: categoryReady,
  })
  // 紐付け候補: 発注者がラボップ × 受注者が自分(=viewing user) × カテゴリ判定 (案件名 or category)
  const targetUserId = asUserId ?? me?.id
  const linkCandidates = useMemo(() => {
    const all = linkPosQ.data ?? []
    return all
      .filter((p) => (p.customer_name ?? '').includes('ラボップ'))
      .filter((p) => p.user_id === targetUserId)
      .filter((p) => {
        const subj = p.subject ?? ''
        // 案件名 > 保存 category の優先順で判定
        if (subj.includes('タマリビング')) return category === 'living'
        if (subj.includes('タマホーム')) return category === 'wings'
        return p.category === category
      })
  }, [linkPosQ.data, category, targetUserId])
  const [linkPoId, setLinkPoId] = useState<number | ''>('')
  // カテゴリ/月切替時に未選択なら、当月にかかる PO を自動選択
  useEffect(() => {
    if (linkPoId !== '') return
    if (linkCandidates.length === 0) return
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`
    const inRange = linkCandidates.find((p) => {
      if (!p.period_start || !p.period_end) return false
      return p.period_start <= monthEnd && p.period_end >= monthStart
    }) ?? linkCandidates[0]
    if (inRange) setLinkPoId(inRange.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCandidates, year, month])
  // カテゴリ切替で選択リセット
  useEffect(() => { setLinkPoId('') }, [category])
  const [linkPreviewOpen, setLinkPreviewOpen] = useState(false)
  const [linkPreviewUrl, setLinkPreviewUrl] = useState<string | null>(null)
  const [linkPreviewBusy, setLinkPreviewBusy] = useState(false)
  const openLinkedPoPreview = async () => {
    if (!linkPoId) return
    setLinkPreviewOpen(true); setLinkPreviewUrl(null); setLinkPreviewBusy(true)
    try {
      const res = await api.get(`/received_purchase_orders/${linkPoId}/download`, { params: { disposition: 'inline' }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      setLinkPreviewUrl(url)
    } catch (e: any) {
      alert(`PDF プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setLinkPreviewOpen(false)
    } finally {
      setLinkPreviewBusy(false)
    }
  }
  const closeLinkedPoPreview = () => {
    if (linkPreviewUrl) URL.revokeObjectURL(linkPreviewUrl)
    setLinkPreviewUrl(null); setLinkPreviewOpen(false); setLinkPreviewBusy(false)
  }

  const totals = useMemo(() => {
    const hours = reports.reduce((s, r) => s + (Number(r.hours) || 0), 0)
    const transit = reports.reduce((s, r) => s + (Number(r.transit_fee) || 0), 0)
    const expense = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    return { hours, transit, expense }
  }, [reports, expenses])

  useEffect(() => {
    document.title = `勤怠 ${year}年${month}月 — 進捗管理システム`
    api.get('/me').then((r) => {
      setMe(r.data as Me)
      if (r.data.default_transit_from && r.data.default_transit_fee) {
        setDefaultTransit({ section: `${r.data.default_transit_from} ~ ${r.data.default_transit_to}`, fee: r.data.default_transit_fee })
      }
      // 初回ロード時のみ、ユーザーの締日で「今日が属する請求月」を再算出（既定 25 と違う場合）
      if (!didAlignToBilling && r.data.closing_day && r.data.closing_day !== 25) {
        const billing = billingMonthForToday(r.data.closing_day)
        setYear(billing.year); setMonth(billing.month)
      }
      setDidAlignToBilling(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, didAlignToBilling])

  const refetchAll = () => {
    reportsQ.refetch()
    expensesQ.refetch()
    invoiceQ.refetch()
  }

  // 表示中ユーザー (admin が他ユーザーをフィルタしている場合はそのユーザー)
  const viewingUser = useMemo(() => {
    if (asUserId) {
      return pickableUsers.find((u) => u.id === asUserId) ?? me
    }
    return me
  }, [asUserId, pickableUsers, me])
  const surname = (viewingUser?.display_name ?? '').split(/[\s　]/)[0] ?? ''
  const invoiceFilename = (surname ? `${surname}_` : '') + `請求書_${year}年_${month}月分.pdf`
  const monthFolderName = `${month}月`

  const invoiceFetchSpec = async () => {
    const { blob, filename } = await fetchExportBlob('/exports/invoice.pdf', { month: monthParam, category, ...asUserParam }, invoiceFilename)
    return { blob, filename, monthFolderName }
  }

  // 請求書 / 立替金 の PDF を一度でも DL/保存したら、その (年月×カテゴリ) で申請ボタンを解放
  const invoiceDlKey = `invoice_dl_${year}_${month}_${category}`
  const expenseDlKey = `expense_dl_${year}_${month}_${category}`
  const [invoicePdfDownloaded, setInvoicePdfDownloaded] = useState(false)
  const [expensePdfDownloaded, setExpensePdfDownloaded] = useState(false)
  useEffect(() => {
    setInvoicePdfDownloaded(localStorage.getItem(invoiceDlKey) === '1')
    setExpensePdfDownloaded(localStorage.getItem(expenseDlKey) === '1')
  }, [invoiceDlKey, expenseDlKey])
  const markInvoiceDownloaded = () => {
    localStorage.setItem(invoiceDlKey, '1')
    setInvoicePdfDownloaded(true)
  }
  const markExpenseDownloaded = () => {
    localStorage.setItem(expenseDlKey, '1')
    setExpensePdfDownloaded(true)
  }

  // 請求書PDFをフォルダ保存したら、同時に請求書一覧(InvoiceSubmission)へ登録する。
  // create は (user×年月×カテゴリ×kind×発注書) で upsert＝重複なし。admin(西野)は自己承認される。
  const [invoiceRegMsg, setInvoiceRegMsg] = useState<string | null>(null)
  const onInvoicePdfSaved = async () => {
    markInvoiceDownloaded()
    setInvoiceRegMsg(null)
    try {
      await api.post('/invoice_submissions', {
        year, month, category, kind: 'invoice',
        received_purchase_order_id: linkPoId || null,
        target_user_id: asUserId && asUserId !== me?.id ? asUserId : null,
      })
      setInvoiceRegMsg('✅ 請求書一覧にも登録しました')
    } catch (e: any) {
      setInvoiceRegMsg(`一覧登録に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  // 立替金 Excel/PDF をフォルダ保存したら、同時に請求書一覧へ kind=expense で登録する（発注書は不要）。
  const [expenseRegMsg, setExpenseRegMsg] = useState<string | null>(null)
  const onExpenseFileSaved = async () => {
    markExpenseDownloaded()
    setExpenseRegMsg(null)
    try {
      await api.post('/invoice_submissions', {
        year, month, category, kind: 'expense',
        target_user_id: asUserId && asUserId !== me?.id ? asUserId : null,
      })
      setExpenseRegMsg('✅ 立替金を請求書一覧にも登録しました')
    } catch (e: any) {
      setExpenseRegMsg(`一覧登録に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  const [selfMailOpen, setSelfMailOpen] = useState(false)

  const fmtYen = (n: number | null | undefined) =>
    n == null ? '—' : '¥' + Math.round(n).toLocaleString()

  const monthShift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  // /me が返るまではカテゴリ依存の表(勤怠・立替金・請求プレビュー)を描かない
  if (!categoryReady) {
    return <div className="py-10 text-center text-xs text-[var(--color-text-sub)]">読み込み中…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-2">
          <button onClick={() => monthShift(-1)} className="shrink-0 rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">
            ←
          </button>
          <div>
            <div className="text-lg font-semibold tracking-tight text-[var(--color-text)] whitespace-nowrap">{year}年 {month}月分</div>
            {period && (
              <div className="text-[11px] text-[var(--color-text-sub)] whitespace-nowrap">
                期間: {period.from} 〜 {period.to}
              </div>
            )}
          </div>
          <button onClick={() => monthShift(1)} className="shrink-0 rounded-md bg-[var(--color-bg)] px-2 py-0.5 text-[var(--color-text-sub)] hover:bg-gray-50 border border-[var(--color-border)]">
            →
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && pickableUsers.length > 0 && (
            <select
              value={asUserId ?? me?.id ?? 0}
              onChange={(e) => setAsUserId(Number(e.target.value))}
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]"
              title="閲覧対象ユーザー"
            >
              {pickableUsers.map((u) => (
                <option key={u.id} value={u.id}>👤 {u.display_name}{u.id === me?.id ? '（自分）' : ''}</option>
              ))}
            </select>
          )}
          <div className="flex gap-1">
            {visibleCategories.map((key) => (
              <button key={key} onClick={() => setPickedCategory(key)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  category === key ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-sub)] border border-[var(--color-border)]'
                }`}>{WORK_CATEGORY_LABELS[key]}</button>
            ))}
          </div>
          <button
            onClick={() => { setSettingsTab('account'); setSettingsOpen(true) }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50"
          >
            ⚙ 設定
          </button>
        </div>
      </div>

      {/* 川村からの申請: 現在の年月でフィルタして期間ヘッダ直下に表示 */}
      <InvoiceSubmissionPanel
        isAdmin={isAdmin}
        isOsumi={isOsumi}
        year={year}
        month={month}
        category={category}
        kind="invoice"
        invoicePdfDownloaded={invoicePdfDownloaded}
        expensePdfDownloaded={expensePdfDownloaded}
        bulkCategories={wingsLivingCategories}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <ClockCard today={today} enabled={clockEnabled} onChanged={refetchAll} />
        <div className="glass rounded-2xl p-4 shadow-md">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)]">今期サマリ</div>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-[var(--color-text-sub)]">稼働</dt>
              <dd className="font-mono tabular-nums text-lg text-[var(--color-text)]">
                {totals.hours.toFixed(1)}
                <span className="text-xs text-[var(--color-text-sub)]">h</span>
              </dd>
            </div>
            {summaryCategories.map((summaryCategory, summaryIndex) => (
              <div key={summaryCategory} className="flex items-baseline justify-between">
                <dt className="text-xs text-[var(--color-text-sub)]">請求書 {WORK_CATEGORY_LABELS[summaryCategory]}</dt>
                <dd className="font-mono tabular-nums text-[var(--color-text)]">{fmtYen(summaryInvoiceQueries[summaryIndex].data?.total)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between">
              <dt className="text-xs text-[var(--color-text-sub)]">立替金</dt>
              <dd className="font-mono tabular-nums text-[var(--color-text)]">¥{totals.expense.toLocaleString()}</dd>
            </div>
            <div className="border-t border-[var(--color-border)] pt-1.5 flex items-baseline justify-between">
              <dt className="text-xs text-amber-600 font-semibold">合計</dt>
              <dd className="font-mono tabular-nums text-lg text-amber-600">
                ¥{(summaryInvoiceQueries.reduce((sum, query) => sum + (query.data?.total ?? 0), 0) + totals.expense).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 shadow-md">
        {/* 狭い画面では見出し側と操作ボタン側を上下に積む。
            min-w-0 が無いと flex アイテムが縮まず、中の長い文字列の幅まで
            カードが広がってページ全体が横に溢れる */}
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)]">請求書プレビュー — {WORK_CATEGORY_LABELS[category]}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-sub)]">
              {invoiceQ.data?.invoice_no && <>請求番号: {invoiceQ.data.invoice_no} ／ </>}
              発行日 {invoiceQ.data?.issue_date ?? '—'} ／ 支払期限 {invoiceQ.data?.due_date ?? '—'}
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-sub)]">紐付け注文書:</span>
              <select
                value={linkPoId}
                onChange={(e) => setLinkPoId(e.target.value === '' ? '' : Number(e.target.value))}
                /* option の文字列("ORD-… ／ 件名 ／ 氏名 ／ 金額")が長く、
                   放っておくと select が中身の幅まで伸びてページごと横に溢れる */
                className="min-w-0 max-w-full flex-1 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs"
              >
                <option value="">選択してください ({linkCandidates.length} 件)</option>
                {linkCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.order_no} ／ {p.subject ?? '(件名なし)'}{p.user_display_name ? ` ／ ${p.user_display_name}` : ''}{p.total_amount ? ` ／ ¥${p.total_amount.toLocaleString()}` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={openLinkedPoPreview}
                disabled={!linkPoId}
                className="rounded border border-sky-400 bg-white px-2 py-1 text-xs text-sky-600 hover:bg-sky-50 disabled:opacity-40"
              >🔍 確認</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end gap-1">
              <FolderSaveButtons label="請求書PDF" monthFolderName={monthFolderName} fetchSpec={invoiceFetchSpec} onDownloaded={onInvoicePdfSaved}
                hint="※PDFをPCのフォルダに保存し、同時に請求書一覧にも登録します。" />
              {invoiceRegMsg && (
                <div className={`text-[10px] ${invoiceRegMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>{invoiceRegMsg}</div>
              )}
            </div>
            <button
              onClick={() => setSelfMailOpen(true)}
              className="rounded-lg whitespace-nowrap bg-gradient-to-r from-rose-500 to-pink-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow"
              title="自分の請求書をメール送付"
            >
              📧 メール送付
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">稼働時間</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">
              {invoiceQ.data?.hours?.toFixed(1) ?? '—'}
              <span className="ml-1 text-xs text-[var(--color-text-sub)]">h</span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">小計</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">{fmtYen(invoiceQ.data?.subtotal)}</div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-sub)]">消費税 ({invoiceQ.data?.tax_rate ?? 10}%)</div>
            <div className="font-mono tabular-nums text-lg text-[var(--color-text)]">{fmtYen(invoiceQ.data?.tax)}</div>
          </div>
          <div className="rounded-xl border border-amber-400/40 bg-amber-50 px-3 py-2">
            <div className="text-[10px] text-amber-600">合計</div>
            <div className="font-mono tabular-nums text-lg text-amber-600">{fmtYen(invoiceQ.data?.total)}</div>
          </div>
        </div>
        {invoiceQ.data?.items && (
          <div className="mt-4 space-y-1 text-xs text-[var(--color-text-sub)]">
            {invoiceQ.data.items.map((it: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span>{it.label}</span>
                <span className="font-mono tabular-nums">
                  {it.qty} × {fmtYen(it.unit_price)} = {fmtYen(it.amount)}
                </span>
              </div>
            ))}
            <button
              onClick={() => {
                setSettingsTab('invoice')
                setSettingsOpen(true)
              }}
              className="mt-2 text-fuchsia-500 hover:text-fuchsia-400"
            >
              ✏️ 単価・控除品目を修正
            </button>
          </div>
        )}
      </div>

      {/* 運送(transport)は紙の「稼働報告書」と同じ列(開始/終了時間・走行距離・検印など)で出す。
          カレンダーから入れた内容がそのままこの勤怠表に出る(同じ work_reports を見ている) */}
      {category === 'transport' ? (
        <TransportWorkReportTable year={year} month={month} period={period} reports={reports} onChanged={refetchAll} asUserId={asUserId} />
      ) : (
        <WorkReportTable year={year} month={month} period={period} reports={reports} onChanged={refetchAll} defaultTransit={defaultTransit} category={category} asUserId={asUserId} />
      )}
      <ExpenseTable year={year} month={month} expenses={expenses} reports={reports} category={category} onPdfDownloaded={onExpenseFileSaved} onChanged={refetchAll} asUserId={asUserId} surname={surname} />
      {expenseRegMsg && (
        <div className={`text-right text-[10px] ${expenseRegMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>{expenseRegMsg}</div>
      )}

      {/* 注文書(PurchaseOrderList)は wings/living/techleaders/resystems 専用。運送(transport)には対象の注文書が無い */}
      {me?.can_issue_orders && category !== 'transport' && <PurchaseOrderList me={me} category={category} />}

      {selfMailOpen && (
        <SelfInvoiceMailModal year={year} month={month} category={category} onClose={() => setSelfMailOpen(false)} />
      )}

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        year={year}
        month={month}
        onClose={() => setSettingsOpen(false)}
        onSaved={refetchAll}
      />

      {linkPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeLinkedPoPreview}>
          <div className="w-full max-w-5xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div className="text-sm font-semibold">🔍 紐付け候補の注文書 プレビュー</div>
              <button onClick={closeLinkedPoPreview} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {linkPreviewBusy && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">読込中…</div>}
              {!linkPreviewBusy && linkPreviewUrl && <iframe src={linkPreviewUrl} className="w-full h-full" title="po-preview" />}
              {!linkPreviewBusy && !linkPreviewUrl && <div className="h-full flex items-center justify-center text-sm text-red-500">取得できませんでした</div>}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
