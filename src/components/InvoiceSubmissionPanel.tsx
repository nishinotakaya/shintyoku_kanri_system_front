import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fetchExportBlob } from './FolderSaveButtons'
import LabopMailModal from './LabopMailModal'

type SubmissionKind = 'invoice' | 'expense' | 'work_report'

type ItemRow = {
  label: string
  qty: number
  unit: string
  unit_price: number
  amount: number
}

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  year_month: string
  category: string
  kind: SubmissionKind
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  reviewer_id: number | null
  reviewer_display_name: string | null
  note: string | null
  total_override: number | null
  item_label_override: string | null
  subject_override: string | null
  application_date_override: string | null
  items_override: ItemRow[] | null
  default_total: number | null
  default_item_label: string | null
  default_subject: string | null
  default_items: ItemRow[] | null
  default_application_date: string | null
}

type Props = {
  isAdmin: boolean
  isOsumi: boolean
  year: number
  month: number
  category: string
  kind: SubmissionKind
  pdfDownloaded?: boolean
  // applicant 統合用: kind="invoice" インスタンスに両方の PDF DL 状態を渡す
  invoicePdfDownloaded?: boolean
  expensePdfDownloaded?: boolean
}

const KIND_LABEL: Record<SubmissionKind, string> = {
  invoice: '請求書',
  expense: '立替金',
  work_report: '業務報告書',
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings',
  living: 'リビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

const pdfPathFor = (kind: SubmissionKind) => kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type LabopForm = {
  total: string
  itemLabel: string
  subject: string
  applicationDate: string
  items: ItemRow[]
}

const emptyItem = (): ItemRow => ({ label: '', qty: 1, unit: '式', unit_price: 0, amount: 0 })

export default function InvoiceSubmissionPanel({ isAdmin, isOsumi, year, month, category, kind, pdfDownloaded = false, invoicePdfDownloaded, expensePdfDownloaded }: Props) {
  const invoiceDl = invoicePdfDownloaded ?? (kind === 'invoice' ? pdfDownloaded : false)
  const expenseDl = expensePdfDownloaded ?? (kind === 'expense' ? pdfDownloaded : false)
  const [mine, setMine] = useState<Submission[]>([])
  const [pending, setPending] = useState<Submission[]>([])
  const [approved, setApproved] = useState<Submission[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 確認モーダル（PDF プレビュー + 承認/却下）
  const [previewFor, setPreviewFor] = useState<Submission | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewMode, setPreviewMode] = useState<'pdf' | 'xlsx'>('pdf')
  const [xlsxHtml, setXlsxHtml] = useState<string | null>(null)
  const [xlsxLoading, setXlsxLoading] = useState(false)

  // ラボップ宛 一括メール送付モーダル (admin が全承認済みを一挙に送付)
  const [mailModalOpen, setMailModalOpen] = useState(false)
  const [allApprovedAcrossKinds, setAllApprovedAcrossKinds] = useState<Submission[]>([])

  // 一括送付を開く時に invoice + expense 両方の承認済みを取得
  const openBulkMail = async () => {
    try {
      const [inv, exp] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved', kind: 'invoice' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved', kind: 'expense' } }),
      ])
      setAllApprovedAcrossKinds([...inv.data, ...exp.data])
      setMailModalOpen(true)
    } catch (e: any) {
      setMsg(`一覧取得失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  // ラボップ宛モーダル (invoice 限定)
  const [labopModalFor, setLabopModalFor] = useState<Submission | null>(null)
  const [labopForm, setLabopForm] = useState<LabopForm>({ total: '', itemLabel: '', subject: '', applicationDate: '', items: [] })
  const [labopSaving, setLabopSaving] = useState(false)
  const [labopMsg, setLabopMsg] = useState<string | null>(null)

  const loadAll = async () => {
    if (isAdmin) {
      const [pInv, aInv, pExp, aExp] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'pending', kind: 'invoice' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved', kind: 'invoice' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'pending', kind: 'expense' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'approved', kind: 'expense' } }),
      ])
      setPending([...pInv.data, ...pExp.data])
      setApproved([...aInv.data, ...aExp.data])
    } else {
      // 川村等: 自分の申請を 請求書/立替金 両方取得して同じ枠で扱う
      const [inv, exp] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'all', kind: 'invoice' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { status: 'all', kind: 'expense' } }),
      ])
      setMine([...inv.data, ...exp.data])
    }
  }

  useEffect(() => {
    loadAll().catch(() => {})
  }, [isAdmin, year, month, category, kind])

  // 大隅は申請対象外
  if (isOsumi) return null

  // 非 admin / admin いずれも、最上位 (kind=invoice) の単一インスタンスでまとめて表示
  if (kind !== 'invoice') return null

  const myInvoiceCurrent = mine.find((s) => s.year === year && s.month === month && s.category === category && s.kind === 'invoice')
  const myExpenseCurrent = mine.find((s) => s.year === year && s.month === month && s.category === category && s.kind === 'expense')

  const submitKind = async (k: SubmissionKind) => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/invoice_submissions', { year, month, category, kind: k })
      setMsg('申請しました')
      await loadAll()
    } catch (e: any) {
      setMsg(`申請失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const approve = async (id: number) => {
    setBusy(true); setMsg(null)
    try {
      await api.patch(`/invoice_submissions/${id}`, { status: 'approved' })
      setMsg('承認しました')
      await loadAll()
      if (previewFor?.id === id) closePreview()
    } catch (e: any) {
      setMsg(`承認失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const reject = async (id: number) => {
    if (!confirm('却下しますか？')) return
    setBusy(true); setMsg(null)
    try {
      await api.patch(`/invoice_submissions/${id}`, { status: 'rejected' })
      setMsg('却下しました')
      await loadAll()
      if (previewFor?.id === id) closePreview()
    } catch (e: any) {
      setMsg(`却下失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // 確認モーダル: 申請者の PDF をそのまま blob 取得して iframe 表示
  const openPreview = async (s: Submission) => {
    setPreviewFor(s); setPreviewUrl(null); setPreviewLoading(true)
    setPreviewMode('pdf'); setXlsxHtml(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const { blob } = await fetchExportBlob(pdfPathFor(s.kind), {
        month: monthParam,
        category: s.category,
        as_user_id: s.user_id,
      }, 'preview.pdf')
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      setMsg(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setPreviewLoading(false)
    }
  }
  const loadXlsxPreview = async (s: Submission) => {
    if (xlsxHtml || xlsxLoading) return
    setXlsxLoading(true)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const { blob } = await fetchExportBlob('/exports/expense.xlsx', {
        month: monthParam,
        category: s.category,
        as_user_id: s.user_id,
      }, 'preview.xlsx')
      const ab = await blob.arrayBuffer()
      const XLSX = await import('xlsx')
      const wb = XLSX.read(ab, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const html = XLSX.utils.sheet_to_html(ws, { editable: false })
      setXlsxHtml(html)
    } catch (e: any) {
      setMsg(`Excel プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setXlsxLoading(false)
    }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewFor(null); setPreviewLoading(false)
    setPreviewMode('pdf'); setXlsxHtml(null); setXlsxLoading(false)
  }

  // 申請者本人の PDF DL (admin 視点で as_user_id 使う)
  const downloadAsApplicant = async (s: Submission) => {
    setBusy(true); setMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const surname = s.user_display_name.split(/[\s　]/)[0] ?? ''
      const labelForFile = KIND_LABEL[s.kind]
      const filename = `${surname}_${labelForFile}_${s.year}年_${s.month}月分.pdf`
      const { blob, filename: fn } = await fetchExportBlob(pdfPathFor(s.kind), {
        month: monthParam,
        category: s.category,
        as_user_id: s.user_id,
      }, filename)
      downloadBlob(blob, fn)
      setMsg('ダウンロードしました')
    } catch (e: any) {
      setMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // ラボップ宛 DL (admin 限定。submission に保存された override が PDF に反映)
  const downloadAsLabop = async (s: Submission) => {
    setLabopSaving(true); setLabopMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const filename = `${s.user_display_name.split(/[\s　]/)[0] ?? ''}_請求書_${s.year}年_${s.month}月分_株式会社ラボップ.pdf`
      const { blob, filename: fn } = await fetchExportBlob('/exports/invoice.pdf', {
        month: monthParam,
        category: s.category,
        invoice_submission_id: s.id,
      }, filename)
      downloadBlob(blob, fn)
      setLabopMsg('ダウンロードしました')
    } catch (e: any) {
      setLabopMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setLabopSaving(false)
    }
  }

  // ラボップ宛 立替金 DL (PDF or Excel)。承認済の expense submission ID を渡す
  const downloadExpenseAsLabop = async (s: Submission, ext: 'pdf' | 'xlsx') => {
    setBusy(true); setMsg(null)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const surname = s.user_display_name.split(/[\s　]/)[0] ?? ''
      const fallback = `${surname}_立替金_${s.year}年_${s.month}月分_株式会社ラボップ.${ext}`
      const path = ext === 'xlsx' ? '/exports/expense.xlsx' : '/exports/expense.pdf'
      const { blob, filename: fn } = await fetchExportBlob(path, {
        month: monthParam,
        category: s.category,
        invoice_submission_id: s.id,
      }, fallback)
      downloadBlob(blob, fn)
      setMsg('ダウンロードしました')
    } catch (e: any) {
      setMsg(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  // ラボップモーダルを開く: override 値があれば優先、なければ default にプリセット
  const openLabopModal = (s: Submission) => {
    setLabopMsg(null)
    const baseItems: ItemRow[] = (s.items_override && s.items_override.length > 0)
      ? s.items_override
      : (s.default_items ?? [])
    setLabopForm({
      total: String(s.total_override ?? s.default_total ?? ''),
      itemLabel: s.item_label_override ?? s.default_item_label ?? '',
      subject: s.subject_override ?? s.default_subject ?? '',
      applicationDate: s.application_date_override ?? s.default_application_date ?? '',
      items: baseItems.length > 0 ? baseItems : [emptyItem()],
    })
    setLabopModalFor(s)
  }
  const closeLabopModal = () => setLabopModalFor(null)

  const saveLabop = async (s: Submission): Promise<Submission | null> => {
    setLabopSaving(true); setLabopMsg(null)
    try {
      const totalRaw = labopForm.total.replace(/[^\d]/g, '')
      const items = labopForm.items
        .filter((it) => it.label.trim() !== '' || it.amount > 0)
        .map((it) => ({
          label: it.label,
          qty: Number(it.qty) || 0,
          unit: it.unit || '式',
          unit_price: Number(it.unit_price) || 0,
          amount: Number(it.amount) || 0,
        }))
      const r = await api.patch<Submission>(`/invoice_submissions/${s.id}`, {
        total_override: totalRaw === '' ? '' : totalRaw,
        item_label_override: labopForm.itemLabel,
        subject_override: labopForm.subject,
        application_date_override: labopForm.applicationDate || '',
        items_override: items,
      })
      setLabopMsg('保存しました')
      await loadAll()
      return r.data
    } catch (e: any) {
      setLabopMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      return null
    } finally {
      setLabopSaving(false)
    }
  }

  // 明細行操作
  const updateItem = (i: number, patch: Partial<ItemRow>) => {
    setLabopForm((prev) => {
      const items = prev.items.map((it, idx) => idx === i ? { ...it, ...patch } : it)
      return { ...prev, items }
    })
  }
  const addItemRow = () => setLabopForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }))
  const removeItemRow = (i: number) => setLabopForm((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }))
  const itemsTotalAmount = labopForm.items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  // === 非 admin (川村など): 請求書 + 立替金 を一枠で申請 ===
  if (!isAdmin) {
    type Row = { k: SubmissionKind; label: string; sub?: Submission; dlOk: boolean }
    const rows: Row[] = [
      { k: 'invoice', label: '請求書', sub: myInvoiceCurrent, dlOk: invoiceDl },
      { k: 'expense', label: '立替金', sub: myExpenseCurrent, dlOk: expenseDl },
    ]
    const anySubmitted = rows.some(({ sub }) => sub?.status === 'pending' || sub?.status === 'approved')
    return (
      <div className="glass rounded-xl px-3 py-2 shadow-md">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-2">
            {year}年{month}月分（{CATEGORY_LABELS[category] ?? category}）申請
            {anySubmitted && (
              <span className="rounded bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">申請済</span>
            )}
          </div>
          {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map(({ k, label, sub, dlOk }) => {
            const alreadySubmitted = sub?.status === 'pending' || sub?.status === 'approved'
            const blockedByPdf = !dlOk && !alreadySubmitted
            return (
              <li key={k} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${k === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>{label}</span>
                  {sub ? (
                    <span>
                      {sub.status === 'pending' && <span className="text-amber-600 font-semibold">申請中</span>}
                      {sub.status === 'approved' && <span className="text-emerald-600 font-semibold">✅ 承認済</span>}
                      {sub.status === 'rejected' && <span className="text-red-500 font-semibold">却下</span>}
                      {sub.reviewed_at && <span className="ml-1 text-[10px] text-[var(--color-text-sub)]">（{new Date(sub.reviewed_at).toLocaleString('ja-JP')}）</span>}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-sub)]">未申請</span>
                  )}
                  {blockedByPdf && (
                    <span className="text-amber-600">先に{label} PDF をダウンロードしてください</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {alreadySubmitted ? (
                    <button
                      onClick={() => submitKind(k)}
                      disabled={busy}
                      title="同月分を上書きして再申請します"
                      className="rounded-md whitespace-nowrap bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                    >
                      {busy ? '送信中…' : '🔁 再申請'}
                    </button>
                  ) : (
                    <button
                      onClick={() => submitKind(k)}
                      disabled={busy || blockedByPdf}
                      title={blockedByPdf ? `先に${label} PDF をダウンロードしてください` : undefined}
                      className="rounded-md whitespace-nowrap bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? '送信中…' : '📤 申請する'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  // === admin (西野): 申請一覧 ===
  // 現在のダッシュボード年月（+ category）に該当する申請のみ表示する
  const matchesCurrentMonth = (s: Submission) => s.year === year && s.month === month && s.category === category
  const pendingThisMonth = pending.filter(matchesCurrentMonth)
  const approvedThisMonth = approved.filter(matchesCurrentMonth)
  if (pendingThisMonth.length === 0 && approvedThisMonth.length === 0) return null

  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const allMonthKeys = [monthKey]
  const pendingByMonth: Record<string, Submission[]> = { [monthKey]: pendingThisMonth }
  const approvedByMonth: Record<string, Submission[]> = { [monthKey]: approvedThisMonth }
  return (
    <div className="glass rounded-xl px-3 py-2 shadow-md space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-[var(--color-text)]">
          申請（申請中 {pending.length} / 承認済み {approved.length}）
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
          {approved.length > 0 && (
            <button
              onClick={openBulkMail}
              disabled={busy}
              className="rounded-md whitespace-nowrap bg-gradient-to-r from-rose-500 to-pink-500 px-3 py-1 text-[11px] font-semibold text-white shadow disabled:opacity-50"
              title="承認済み (請求書 + 立替金) をまとめてラボップへメール送付"
            >
              📧 ラボップへ一括送付
            </button>
          )}
        </div>
      </div>

      {allMonthKeys.map((mk) => {
        const [yStr, mStr] = mk.split('-')
        const y = Number(yStr); const m = Number(mStr)
        const monthPending = pendingByMonth[mk] ?? []
        const monthApproved = approvedByMonth[mk] ?? []
        const mInvP = monthPending.filter((s) => s.kind === 'invoice')
        const mExpP = monthPending.filter((s) => s.kind === 'expense')
        const mInvA = monthApproved.filter((s) => s.kind === 'invoice')
        const mExpA = monthApproved.filter((s) => s.kind === 'expense')
        return (
          <div key={mk} className="space-y-1.5">
            <div className="text-[12px] font-bold text-[var(--color-text)] mt-1">{y}年{m}月分</div>
            {monthPending.length > 0 && (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50/40 px-2 py-1.5">
                <div className="text-[11px] font-semibold text-amber-700 mb-1">
                  📨 申請中（請求書 {mInvP.length} / 立替金 {mExpP.length}）
                </div>
                <ul className="divide-y divide-amber-200">
                  {monthPending.map((s) => {
                    const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
                    const kindLbl = KIND_LABEL[s.kind]
                    return (
                      <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-baseline gap-2">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${s.kind === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>{kindLbl}</span>
                          <span className="text-fuchsia-600 font-semibold">{surname}さん</span>
                          <span className="text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                          {s.submitted_at && <span className="text-[10px] text-[var(--color-text-sub)]">{new Date(s.submitted_at).toLocaleString('ja-JP')}</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openPreview(s)} disabled={busy}
                            className="rounded-md whitespace-nowrap border border-sky-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50">🔍 確認</button>
                          <button onClick={() => approve(s.id)} disabled={busy}
                            className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow disabled:opacity-50">✅ 承認</button>
                          <button onClick={() => reject(s.id)} disabled={busy}
                            className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">却下</button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {monthApproved.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-2 py-1.5">
                <div className="text-[11px] font-semibold text-emerald-700 mb-1">
                  ✅ 承認済み（請求書 {mInvA.length} / 立替金 {mExpA.length}）
                </div>
                <div className="space-y-1">
                  {mInvA.length > 0 && (
                    <ul className="divide-y divide-emerald-100">
                      {mInvA.map((s) => {
                        const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
                        return (
                          <li key={s.id} className="py-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-sky-100 text-sky-700">請求書</span>
                              <span className="font-semibold text-[var(--color-text)]">{s.user_display_name}</span>
                              <span className="text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                              {s.total_override != null && <span className="text-[10px] text-sky-600">¥{s.total_override.toLocaleString()} 設定済</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => openPreview(s)} disabled={busy}
                                className="rounded-md whitespace-nowrap border border-sky-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50">🔍</button>
                              <button onClick={() => downloadAsApplicant(s)} disabled={busy}
                                className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                                title={`${surname}さん本人の請求書（オリジナル）`}>📥 PDF</button>
                              <button onClick={() => openLabopModal(s)} disabled={busy}
                                className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow disabled:opacity-50">📥 ラボップ宛</button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {mExpA.length > 0 && (
                    <ul className="divide-y divide-emerald-100">
                      {mExpA.map((s) => {
                        const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
                        return (
                          <li key={s.id} className="py-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700">立替金</span>
                              <span className="font-semibold text-[var(--color-text)]">{s.user_display_name}</span>
                              <span className="text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => openPreview(s)} disabled={busy}
                                className="rounded-md whitespace-nowrap border border-sky-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50">🔍</button>
                              <button onClick={() => downloadAsApplicant(s)} disabled={busy}
                                className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                                title={`${surname}さん本人の立替金（オリジナル）`}>📥 PDF</button>
                              <button onClick={() => downloadExpenseAsLabop(s, 'xlsx')} disabled={busy}
                                className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                                title="立替金 Excel を株式会社ラボップ宛 / 西野発行で出力">📥 Excel</button>
                              <button onClick={() => downloadExpenseAsLabop(s, 'pdf')} disabled={busy}
                                className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow disabled:opacity-50"
                                title="立替金 PDF を株式会社ラボップ宛 / 西野発行で出力">📥 ラボップ宛 PDF</button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* === 確認モーダル (PDF / Excel プレビュー + 承認/却下) === */}
      {previewFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closePreview}>
          <div className="w-full max-w-4xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">🔍 申請確認: {KIND_LABEL[previewFor.kind]}</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {previewFor.user_display_name} ／ {previewFor.year}年{previewFor.month}月（{CATEGORY_LABELS[previewFor.category] ?? previewFor.category}）
                </div>
              </div>
              <button onClick={closePreview} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
            </div>
            {previewFor.kind === 'expense' && (
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => setPreviewMode('pdf')}
                  className={`rounded-t-md px-3 py-1 text-[11px] font-semibold border-b-2 transition ${
                    previewMode === 'pdf'
                      ? 'border-sky-500 text-sky-700 bg-sky-50'
                      : 'border-transparent text-[var(--color-text-sub)] hover:text-[var(--color-text)]'
                  }`}
                >📄 PDF</button>
                <button
                  type="button"
                  onClick={() => { setPreviewMode('xlsx'); if (previewFor) void loadXlsxPreview(previewFor) }}
                  className={`rounded-t-md px-3 py-1 text-[11px] font-semibold border-b-2 transition ${
                    previewMode === 'xlsx'
                      ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
                      : 'border-transparent text-[var(--color-text-sub)] hover:text-[var(--color-text)]'
                  }`}
                >📊 Excel</button>
              </div>
            )}
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {previewMode === 'pdf' && (
                <>
                  {previewLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">PDF を読み込み中…</div>}
                  {!previewLoading && previewUrl && (
                    <iframe src={previewUrl} className="w-full h-full" title="PDF preview" />
                  )}
                  {!previewLoading && !previewUrl && (
                    <div className="h-full flex items-center justify-center text-sm text-red-500">PDF を取得できませんでした</div>
                  )}
                </>
              )}
              {previewMode === 'xlsx' && (
                <div className="h-full overflow-auto bg-white p-3">
                  {xlsxLoading && <div className="text-sm text-[var(--color-text-sub)]">Excel を読み込み中…</div>}
                  {!xlsxLoading && xlsxHtml && (
                    <div
                      className="xlsx-preview text-[12px] [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-300 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-100"
                      dangerouslySetInnerHTML={{ __html: xlsxHtml }}
                    />
                  )}
                  {!xlsxLoading && !xlsxHtml && (
                    <div className="text-sm text-red-500">Excel を取得できませんでした</div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--color-text-sub)]">{previewFor.status === 'pending' ? '未承認' : `ステータス: ${previewFor.status}`}</span>
              <div className="flex items-center gap-2">
                <button onClick={closePreview} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">閉じる</button>
                {previewFor.status === 'pending' && (
                  <>
                    <button onClick={() => reject(previewFor.id)} disabled={busy} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">却下</button>
                    <button onClick={() => approve(previewFor.id)} disabled={busy} className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">✅ 承認</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === ラボップ宛モーダル (請求書のみ): 明細・金額・件名・申請日 編集 === */}
      {mailModalOpen && (
        <LabopMailModal
          invoices={allApprovedAcrossKinds.filter((s) => s.kind === 'invoice') as any}
          expenses={allApprovedAcrossKinds.filter((s) => s.kind === 'expense') as any}
          onClose={() => setMailModalOpen(false)}
        />
      )}

      {labopModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeLabopModal}>
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">📥 ラボップ宛 請求書</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {labopModalFor.user_display_name} ／ {labopModalFor.year}年{labopModalFor.month}月（{CATEGORY_LABELS[labopModalFor.category] ?? labopModalFor.category}）
                </div>
              </div>
              <button onClick={closeLabopModal} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">税込合計（¥）</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={labopForm.total}
                  onChange={(e) => setLabopForm((p) => ({ ...p, total: e.target.value.replace(/[^\d]/g, '') }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-300"
                  placeholder={labopModalFor.default_total != null ? String(labopModalFor.default_total) : ''}
                />
                <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">
                  空欄なら明細合計をそのまま使用 (¥{itemsTotalAmount.toLocaleString()})
                </div>
              </label>

              <label className="block">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">申請日</div>
                <input
                  type="date"
                  value={labopForm.applicationDate}
                  onChange={(e) => setLabopForm((p) => ({ ...p, applicationDate: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </label>

              <label className="block col-span-2">
                <div className="text-[11px] font-semibold text-[var(--color-text)] mb-0.5">件名（任意）</div>
                <input
                  type="text"
                  value={labopForm.subject}
                  onChange={(e) => setLabopForm((p) => ({ ...p, subject: e.target.value }))}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  placeholder={labopModalFor.default_subject ?? ''}
                />
              </label>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold text-[var(--color-text)]">明細</div>
                <button
                  onClick={addItemRow}
                  className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50"
                >+ 行追加</button>
              </div>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="text-left text-[var(--color-text-sub)]">
                    <th className="py-1 pr-1 font-semibold">品番・品名</th>
                    <th className="py-1 px-1 font-semibold w-14">数量</th>
                    <th className="py-1 px-1 font-semibold w-12">単位</th>
                    <th className="py-1 px-1 font-semibold w-24">単価</th>
                    <th className="py-1 px-1 font-semibold w-24">金額</th>
                    <th className="py-1 pl-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {labopForm.items.map((it, i) => (
                    <tr key={i} className="border-t border-[var(--color-border)]">
                      <td className="py-1 pr-1">
                        <input
                          type="text"
                          value={it.label}
                          onChange={(e) => updateItem(i, { label: e.target.value })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          step="0.5"
                          value={it.qty}
                          onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="text"
                          value={it.unit}
                          onChange={(e) => updateItem(i, { unit: e.target.value })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          value={it.unit_price}
                          onChange={(e) => {
                            const up = Number(e.target.value)
                            updateItem(i, { unit_price: up, amount: Math.round(up * (Number(it.qty) || 0)) })
                          }}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          value={it.amount}
                          onChange={(e) => updateItem(i, { amount: Number(e.target.value) })}
                          className="w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-right font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-300"
                        />
                      </td>
                      <td className="py-1 pl-1 text-center">
                        <button onClick={() => removeItemRow(i)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--color-border)]">
                    <td colSpan={4} className="py-1 pr-1 text-right text-[var(--color-text-sub)]">明細合計</td>
                    <td className="py-1 px-1 text-right font-mono tabular-nums font-semibold">¥{itemsTotalAmount.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-1 text-[10px] text-[var(--color-text-sub)]">
                税込合計が空欄の時は「明細合計」を税込として 10% 内税で逆算。指定があれば「税込合計」を優先、明細はそのまま PDF に表示されます。
              </div>
            </div>

            <div className="mt-3 rounded-md bg-gray-50 px-2 py-1.5 text-[10px] text-[var(--color-text-sub)]">
              宛先: 株式会社ラボップ ／ 発行者・印鑑・振込先: 西野（自動）
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={`text-[11px] ${labopMsg?.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{labopMsg ?? ''}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const updated = await saveLabop(labopModalFor)
                    if (updated) setLabopModalFor(updated)
                  }}
                  disabled={labopSaving}
                  className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                >
                  💾 保存
                </button>
                <button
                  onClick={async () => {
                    const updated = await saveLabop(labopModalFor)
                    if (updated) await downloadAsLabop(updated)
                  }}
                  disabled={labopSaving}
                  className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
                >
                  📥 ダウンロード
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
