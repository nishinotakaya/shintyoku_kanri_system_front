import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import { fetchExportBlob } from '../components/FolderSaveButtons'
import LabopMailModal from '../components/LabopMailModal'
import ExpenseEditList from '../components/ExpenseEditList'
import IssuedPdfEditModal from '../components/IssuedPdfEditModal'
import MergedRowEditModal from '../components/MergedRowEditModal'

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  category: string
  kind: 'invoice' | 'expense' | 'work_report'
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  note: string | null
  total_override: number | null
  default_total: number | null
  received_purchase_order_no: string | null
  received_purchase_order_subject: string | null
  purchase_order_no_override?: string | null
  effective_purchase_order_no?: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Tama',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}
const KIND_LABELS: Record<string, string> = {
  invoice: '請求書',
  expense: '立替金',
  work_report: '業務報告書',
}
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}

type IssuedPdf = {
  id: number
  user_id: number
  user_display_name: string | null
  kind: 'invoice' | 'expense'
  file_format: 'pdf' | 'xlsx'
  year: number | null
  month: number | null
  category: string | null
  purchase_order_no: string | null
  source_submission_ids: number[]
  merged: boolean
  total_amount: number | null
  filename: string
  generated_at: string | null
}

export default function InvoicesPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [issuedPdfs, setIssuedPdfs] = useState<IssuedPdf[]>([])
  const [loading, setLoading] = useState(true)
  const [filterKind, setFilterKind] = useState<'all' | 'invoice' | 'expense'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [filterMonth, setFilterMonth] = useState<string>('') // YYYY-MM
  const [filterUserId, setFilterUserId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const load = async () => {
    setLoading(true)
    try {
      const [inv, exp, issued] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'invoice', status: 'all' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'expense', status: 'all' } }),
        api.get<IssuedPdf[]>('/issued_invoice_pdfs').catch(() => ({ data: [] as IssuedPdf[] })),
      ])
      setItems([...inv.data, ...exp.data])
      setIssuedPdfs(issued.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
    load().catch(() => {})
  }, [])

  const [busyId, setBusyId] = useState<string | null>(null)
  const [mergeBusy, setMergeBusy] = useState<string | null>(null) // 統合系処理中のキー
  // チェック済み (admin の一括メール送信用) — key="invoice-{id}" or "expense-{id}"
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [checkedIssuedIds, setCheckedIssuedIds] = useState<Set<number>>(new Set())
  const [checkedMergedKeys, setCheckedMergedKeys] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const toggleCheck = (s: Submission) => {
    const k = `${s.kind}-${s.id}`
    setCheckedIds((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  const toggleIssuedCheck = (id: number) => {
    setCheckedIssuedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const removeIssuedPdf = async (id: number, filename: string) => {
    if (!confirm(`保存済 ${filename} を削除しますか？`)) return
    try { await api.delete(`/issued_invoice_pdfs/${id}`); await load() }
    catch (e: any) { alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
  }
  const downloadIssuedPdf = async (p: IssuedPdf) => {
    try {
      const res = await api.get(`/issued_invoice_pdfs/${p.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url; a.download = p.filename; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  const previewIssuedPdf = async (p: IssuedPdf) => {
    setPreviewLoading(true)
    setPreviewSub({
      id: 0, user_id: p.user_id, user_display_name: p.user_display_name ?? '保存済 統合 PDF',
      year: p.year ?? 0, month: p.month ?? 0, category: p.category ?? '',
      kind: p.kind, status: 'approved', submitted_at: null, reviewed_at: null,
      note: p.filename, total_override: p.total_amount, default_total: null,
      received_purchase_order_no: p.purchase_order_no, received_purchase_order_subject: null,
    } as Submission)
    setPreviewMergeContext(null)
    try {
      const res = await api.get(`/issued_invoice_pdfs/${p.id}/download`, { params: { disposition: 'inline' }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      setPreviewUrl(url)
    } catch (e: any) {
      alert(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewSub(null)
    } finally { setPreviewLoading(false) }
  }
  const bulkDeleteIssued = async () => {
    if (checkedIssuedIds.size === 0) return
    if (!confirm(`選択した保存済 ${checkedIssuedIds.size} 件を削除しますか？`)) return
    try {
      await Promise.all(Array.from(checkedIssuedIds).map((id) => api.delete(`/issued_invoice_pdfs/${id}`)))
      setCheckedIssuedIds(new Set())
      await load()
    } catch (e: any) { alert(`一括削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`) }
  }
  // 新規申請モーダル (admin が自分の申請を作る)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<{ year: number; month: number; category: string; kind: 'invoice' | 'expense'; received_purchase_order_id: number | ''; note: string }>(
    () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, category: 'wings', kind: 'invoice', received_purchase_order_id: '', note: '' }
    }
  )
  type ReceivedPO = { id: number; order_no: string; subject: string | null; user_id: number; category: string | null }
  const [pos, setPos] = useState<ReceivedPO[]>([])
  useEffect(() => {
    if (!creating) return
    api.get<ReceivedPO[]>('/received_purchase_orders', { params: { year: createForm.year, month: createForm.month } })
      .then((r) => setPos(r.data.filter((po) => !po.category || po.category === createForm.category)))
      .catch(() => setPos([]))
  }, [creating, createForm.year, createForm.month, createForm.category])
  const submitCreate = async () => {
    try {
      await api.post('/invoice_submissions', {
        year: createForm.year,
        month: createForm.month,
        category: createForm.category,
        kind: createForm.kind,
        note: createForm.note || null,
        received_purchase_order_id: createForm.received_purchase_order_id || null,
      })
      setCreating(false)
      await load()
    } catch (e: any) {
      alert(`作成失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }
  // プレビューモーダル
  const [previewSub, setPreviewSub] = useState<Submission | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewMergeContext, setPreviewMergeContext] = useState<any>(null) // 集約プレビュー時の元データ
  const [previewSaveBusy, setPreviewSaveBusy] = useState(false)
  // 編集モーダル
  type ItemRow = { label: string; qty: number; unit: string; unit_price: number; amount: number }
  const [editingIssued, setEditingIssued] = useState<IssuedPdf | null>(null)
  const [editingMergedRow, setEditingMergedRow] = useState<{ ids: number[]; po: string | null; kind: 'merged_expense' | 'merged_invoice' } | null>(null)
  const [editingSub, setEditingSub] = useState<Submission | null>(null)
  const [editForm, setEditForm] = useState<{ note: string; purchase_order_no_override: string; total_override: string; subject_override: string; items: ItemRow[] }>({ note: '', purchase_order_no_override: '', total_override: '', subject_override: '', items: [] })
  const [editBusy, setEditBusy] = useState(false)
  const updateEditItem = (i: number, patch: Partial<ItemRow>) => {
    setEditForm((p) => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }))
  }
  const addEditItem = () => setEditForm((p) => ({ ...p, items: [...p.items, { label: '', qty: 1, unit: '式', unit_price: 0, amount: 0 }] }))
  const removeEditItem = (i: number) => setEditForm((p) => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))

  const openPreview = async (s: Submission) => {
    setPreviewSub(s); setPreviewUrl(null); setPreviewLoading(true)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
      const params: Record<string, unknown> = { month: monthParam, category: s.category, as_user_id: s.user_id }
      if (s.status === 'approved') params.invoice_submission_id = s.id
      const { blob } = await fetchExportBlob(path, params, 'preview.pdf')
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      alert(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewSub(null)
    } finally { setPreviewLoading(false) }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewSub(null); setPreviewLoading(false)
    setPreviewMergeContext(null)
  }

  const openEdit = async (s: Submission) => {
    setEditingSub(s)
    // 詳細フェッチして default_items 等を取得
    try {
      const r = await api.get<Submission & { items_override: ItemRow[] | null; default_items: ItemRow[] | null; default_subject: string | null }>('/invoice_submissions', { params: { kind: s.kind, status: 'all' } })
      const detail = (r.data as any[]).find((x) => x.id === s.id) || s
      const items: ItemRow[] = (detail.items_override && detail.items_override.length > 0 ? detail.items_override : (detail.default_items ?? [])) as ItemRow[]
      setEditForm({
        note: detail.note ?? '',
        purchase_order_no_override: (detail as any).purchase_order_no_override ?? (detail.received_purchase_order_no ?? ''),
        total_override: detail.total_override != null ? String(detail.total_override) : '',
        subject_override: detail.subject_override ?? detail.default_subject ?? '',
        items: items.length > 0 ? items : [],
      })
    } catch {
      setEditForm({
        note: s.note ?? '',
        purchase_order_no_override: s.received_purchase_order_no ?? '',
        total_override: s.total_override != null ? String(s.total_override) : '',
        subject_override: '',
        items: [],
      })
    }
  }
  const closeEdit = () => { setEditingSub(null) }
  const saveEdit = async () => {
    if (!editingSub) return
    setEditBusy(true)
    try {
      const payload: Record<string, unknown> = {
        note: editForm.note,
        purchase_order_no_override: editForm.purchase_order_no_override,
        total_override: editForm.total_override.replace(/[^\d-]/g, ''),
        subject_override: editForm.subject_override,
      }
      // 明細変更があれば items_override として保存
      const itemsClean = editForm.items.filter((it) => it.label.trim() !== '' || it.amount > 0)
      if (itemsClean.length > 0) {
        payload.items_override = itemsClean.map((it) => ({
          label: it.label, qty: Number(it.qty) || 0, unit: it.unit || '式',
          unit_price: Number(it.unit_price) || 0, amount: Number(it.amount) || 0,
        }))
      }
      await api.patch(`/invoice_submissions/${editingSub.id}`, payload)
      await load()
      closeEdit()
    } catch (e: any) {
      alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setEditBusy(false) }
  }

  // 統合 + DB 保存 + 同時にローカル DL（save=1 を立てて呼ぶ）
  const saveMergedToDb = async (m: any, format: 'pdf' | 'xlsx' = 'pdf') => {
    const busyKey = format === 'xlsx' ? `${m.key}-save-xlsx` : `${m.key}-save`
    setMergeBusy(busyKey)
    try {
      const path = m.kind === 'merged_expense'
        ? (format === 'xlsx' ? '/exports/merged_expense.xlsx' : '/exports/merged_expense.pdf')
        : '/exports/merged_invoice.pdf'
      const fd = new FormData()
      const idKey = m.kind === 'merged_expense' ? 'expense_submission_ids[]' : 'invoice_submission_ids[]'
      m.ids.forEach((id: number) => fd.append(idKey, String(id)))
      fd.append('save', '1')
      const res = await api.post(path, fd, { responseType: 'blob' })
      // ついでにローカル DL
      const ym = `${m.year}年_${m.month}月分`
      const surnames = m.users.map((u: string) => u.split(/[\s　]/)[0]).join('_')
      const cat = CATEGORY_LABELS[m.category] ?? m.category
      const filename = m.kind === 'merged_expense'
        ? `立替金_${surnames}_${cat}_${ym}.${format}`
        : `${surnames}_請求書_${cat}_${ym}.${format}`
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      await load()
    } catch (e: any) {
      alert(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setMergeBusy(null) }
  }

  // 統合行をラボップ宛メール送付モーダルで開く
  const sendMergedToLabop = (m: any) => {
    const linkedSubs = items.filter((s) => m.ids.includes(s.id) && s.kind === (m.kind === 'merged_expense' ? 'expense' : 'invoice'))
    setCheckedIds(new Set(linkedSubs.map((s) => `${s.kind}-${s.id}`)))
    setBulkOpen(true)
  }

  // チェック済み複数件を統合 PDF 生成（同種・同 year/month/category であれば）
  const mergeChecked = async () => {
    const selected = items.filter((s) => checkedIds.has(`${s.kind}-${s.id}`) && s.status === 'approved')
    if (selected.length < 2) { alert('2 件以上選択してください'); return }
    const kinds = new Set(selected.map((s) => s.kind))
    if (kinds.size > 1) { alert('種別が混在しています（請求書 と 立替金 の同時統合は不可）'); return }
    const groups = new Set(selected.map((s) => `${s.year}-${s.month}-${s.category}`))
    if (groups.size > 1) { alert('年月・カテゴリが揃った申請のみ統合できます'); return }
    const m = {
      kind: selected[0].kind === 'expense' ? 'merged_expense' as const : 'merged_invoice' as const,
      ids: selected.map((s) => s.id),
      year: selected[0].year, month: selected[0].month, category: selected[0].category,
      users: Array.from(new Set(selected.map((s) => s.user_display_name))),
      po: selected[0].received_purchase_order_no,
      total: selected.reduce((acc, s) => acc + (s.total_override ?? s.default_total ?? 0), 0),
      key: `merged-${selected[0].kind}-${selected[0].year}-${selected[0].month}-${selected[0].category}`,
    }
    await previewMerged(m)
    // 立替金の統合は Excel もセットでダウンロード（ラボップ宛 PDF＋社内 Excel）
    if (m.kind === 'merged_expense') {
      try { await downloadMerged(m, 'xlsx') } catch {}
    }
  }
  // 集約 PDF/Excel 関連
  const fetchMergedBlob = async (m: { kind: 'merged_expense' | 'merged_invoice'; ids: number[]; po: string | null; users: string[]; year: number; month: number; category: string }, format: 'pdf' | 'xlsx', preview = false) => {
    const path = m.kind === 'merged_expense'
      ? (format === 'xlsx' ? '/exports/merged_expense.xlsx' : '/exports/merged_expense.pdf')
      : '/exports/merged_invoice.pdf'
    const fd = new FormData()
    if (m.kind === 'merged_expense') {
      m.ids.forEach((id) => fd.append('expense_submission_ids[]', String(id)))
    } else {
      m.ids.forEach((id) => fd.append('invoice_submission_ids[]', String(id)))
    }
    if (preview) fd.append('disposition', 'inline')
    const res = await api.post(path, fd, { responseType: 'blob' })
    return res.data as Blob
  }
  const downloadMerged = async (m: any, format: 'pdf' | 'xlsx') => {
    const busyKey = `${(m as any).key ?? m.ids.join(',')}-${format}`
    setMergeBusy(busyKey)
    try {
      const blob = await fetchMergedBlob(m, format)
      const ym = `${m.year}年_${m.month}月分`
      const surnames = m.users.map((u: string) => u.split(/[\s　]/)[0]).join('_')
      const cat = CATEGORY_LABELS[m.category] ?? m.category
      const ext = format
      const filename = m.kind === 'merged_expense' ? `立替金_${surnames}_${cat}_${ym}.${ext}` : `${surnames}_請求書_${cat}_${ym}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setMergeBusy(null) }
  }
  const previewMerged = async (m: any) => {
    const busyKey = `${(m as any).key ?? m.ids.join(',')}-preview`
    setMergeBusy(busyKey)
    setPreviewLoading(true)
    setPreviewMergeContext(m)
    setPreviewSub({ id: 0, user_id: 0, user_display_name: m.users.join(' + '), year: m.year, month: m.month, category: m.category, kind: m.kind === 'merged_expense' ? 'expense' : 'invoice', status: 'approved', submitted_at: null, reviewed_at: null, note: m.po ?? null, total_override: m.total, default_total: null, received_purchase_order_no: m.po, received_purchase_order_subject: null } as Submission)
    try {
      const blob = await fetchMergedBlob(m, 'pdf', true)
      const url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    } catch (e: any) {
      alert(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewSub(null)
    } finally {
      setMergeBusy(null)
      setPreviewLoading(false)
    }
  }

  const Spinner = () => (
    <svg className="inline-block animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )

  const removeSubmission = async (s: Submission) => {
    if (!confirm(`${s.year}/${s.month} ${s.kind === 'invoice' ? '請求書' : '立替金'}（${s.user_display_name}）を削除しますか？`)) return
    try {
      await api.delete(`/invoice_submissions/${s.id}`)
      await load()
    } catch (e: any) {
      alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const downloadInvoice = async (s: Submission, target: 'self' | 'labop') => {
    setBusyId(`${s.kind}-${s.id}`)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
      const params: Record<string, unknown> = { month: monthParam, category: s.category }
      if (target === 'labop') params.invoice_submission_id = s.id
      else params.as_user_id = s.user_id
      const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? ''
      const kindLabel = s.kind === 'expense' ? '立替金' : '請求書'
      const targetSuffix = target === 'labop' ? '_株式会社ラボップ' : ''
      const filename = `${surname}_${kindLabel}_${s.year}年_${s.month}月分${targetSuffix}.pdf`
      const { blob, filename: fn } = await fetchExportBlob(path, params, filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusyId(null)
    }
  }

  const downloadExpenseXlsx = async (s: Submission, target: 'self' | 'labop') => {
    setBusyId(`${s.kind}-${s.id}-xlsx`)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const params: Record<string, unknown> = { month: monthParam, category: s.category }
      if (target === 'labop') params.invoice_submission_id = s.id
      else params.as_user_id = s.user_id
      const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? ''
      const targetSuffix = target === 'labop' ? '_株式会社ラボップ' : ''
      const filename = `${surname}_立替金_${s.year}年_${s.month}月分${targetSuffix}.xlsx`
      const { blob, filename: fn } = await fetchExportBlob('/exports/expense.xlsx', params, filename)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`DL失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setBusyId(null)
    }
  }

  // 同じ (year, month, category, kind=expense, status=approved) で複数ユーザーがある場合の集約 row（virtual）
  // 同じ PO に複数の invoice 申請があれば「PO マージ」row も追加
  type MergedRow = { kind: 'merged_expense' | 'merged_invoice'; key: string; year: number; month: number; category: string; users: string[]; ids: number[]; po: string | null; total: number }
  const mergedRows: MergedRow[] = useMemo(() => {
    const rows: MergedRow[] = []
    // 立替金 集約: 承認済 expense を (year, month, category) でグループ化、複数ユーザー
    const expGroups = new Map<string, Submission[]>()
    items.filter((s) => s.kind === 'expense' && s.status === 'approved').forEach((s) => {
      const key = `${s.year}-${s.month}-${s.category}`
      const arr = expGroups.get(key) ?? []; arr.push(s); expGroups.set(key, arr)
    })
    expGroups.forEach((subs, key) => {
      const userSet = new Set(subs.map((s) => s.user_display_name))
      if (userSet.size < 2) return
      const totalSum = subs.reduce((acc, s) => acc + (s.total_override ?? s.default_total ?? 0), 0)
      rows.push({ kind: 'merged_expense', key: `me-${key}`, year: subs[0].year, month: subs[0].month, category: subs[0].category, users: Array.from(userSet), ids: subs.map((s) => s.id), po: null, total: totalSum })
    })
    // 請求書 PO マージ: 承認済 invoice を received_purchase_order_no でグループ化、2件以上
    const invGroups = new Map<string, Submission[]>()
    items.filter((s) => s.kind === 'invoice' && s.status === 'approved' && s.received_purchase_order_no).forEach((s) => {
      const key = `${s.received_purchase_order_no}`
      const arr = invGroups.get(key) ?? []; arr.push(s); invGroups.set(key, arr)
    })
    invGroups.forEach((subs, po) => {
      if (subs.length < 2) return
      const userSet = new Set(subs.map((s) => s.user_display_name))
      const totalSum = subs.reduce((acc, s) => acc + (s.total_override ?? s.default_total ?? 0), 0)
      rows.push({ kind: 'merged_invoice', key: `mi-${po}`, year: subs[0].year, month: subs[0].month, category: subs[0].category, users: Array.from(userSet), ids: subs.map((s) => s.id), po, total: totalSum })
    })
    return rows
  }, [items])

  // 集約行 (merged_invoice / merged_expense) のチェックを構成する個別 submission の id 集合に展開
  const mergedSubmissionIds = useMemo(() => {
    const ids = new Set<number>()
    mergedRows.forEach((m) => {
      if (checkedMergedKeys.has(m.key)) m.ids.forEach((id) => ids.add(id))
    })
    return ids
  }, [mergedRows, checkedMergedKeys])

  const filtered = useMemo(() => {
    return items
      .filter((s) => filterKind === 'all' || s.kind === filterKind)
      .filter((s) => filterStatus === 'all' || s.status === filterStatus)
      .filter((s) => {
        if (!filterMonth) return true
        const ym = `${s.year}-${String(s.month).padStart(2, '0')}`
        return ym === filterMonth
      })
      .filter((s) => {
        if (!filterUserId) return true
        return s.user_id === filterUserId
      })
      .sort((a, b) => {
        const ka = `${a.year}-${String(a.month).padStart(2, '0')}-${a.kind}-${a.id}`
        const kb = `${b.year}-${String(b.month).padStart(2, '0')}-${b.kind}-${b.id}`
        return kb.localeCompare(ka)
      })
  }, [items, filterKind, filterStatus, filterMonth, filterUserId])

  // 申請者一覧（重複除去）
  const userOptions = useMemo(() => {
    const map = new Map<number, string>()
    items.forEach((s) => { if (!map.has(s.user_id)) map.set(s.user_id, s.user_display_name) })
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [items])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">📄 請求書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {me?.admin ? '全ユーザーの請求書/立替金 申請' : '自分の請求書/立替金 申請'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me?.admin && (
            <button onClick={() => setCreating(true)}
              className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
              ＋ 自分の申請を新規作成
            </button>
          )}
          {me?.admin && checkedIds.size >= 2 && (
            <button onClick={() => mergeChecked()}
              className="rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
              title="選択した請求書/立替金を 1 PDF に統合（同種・同月のみ）">
              🔗 選択 {checkedIds.size} 件を統合 PDF
            </button>
          )}
          {me?.admin && (checkedIds.size + checkedIssuedIds.size + mergedSubmissionIds.size) > 0 && (
            <button onClick={() => setBulkOpen(true)}
              className="rounded-md bg-gradient-to-r from-rose-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
              📧 選択 {(() => { const u = new Set<number>(); checkedIds.forEach((k) => u.add(Number(k.split('-')[1]))); mergedSubmissionIds.forEach((id) => u.add(id)); return u.size + checkedIssuedIds.size })()} 件をラボップ送付
            </button>
          )}
          {me?.admin && checkedIssuedIds.size > 0 && (
            <button onClick={bulkDeleteIssued}
              className="rounded-md bg-gradient-to-r from-red-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
              🗑 保存済 {checkedIssuedIds.size} 件を一括削除
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(['all', 'invoice', 'expense'] as const).map((k) => (
            <button key={k} onClick={() => setFilterKind(k)}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${filterKind === k ? 'bg-fuchsia-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
              {k === 'all' ? '全種別' : KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${filterStatus === s ? 'bg-sky-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
              {s === 'all' ? '全ステータス' : s === 'pending' ? '申請中' : s === 'approved' ? '承認済' : '却下'}
            </button>
          ))}
        </div>
        <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs" />
        {filterMonth && <button onClick={() => setFilterMonth('')} className="text-[11px] text-[var(--color-text-sub)]">×</button>}
        {me?.admin && (
          <select value={filterUserId ?? ''} onChange={(e) => setFilterUserId(e.target.value === '' ? null : Number(e.target.value))}
            className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs">
            <option value="">全申請者</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {filterUserId != null && <button onClick={() => setFilterUserId(null)} className="text-[11px] text-[var(--color-text-sub)]">×</button>}
        <span className="ml-auto text-[11px] text-[var(--color-text-sub)]">
          {filtered.length} / {items.length} 件
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">該当する申請がありません</div>
      ) : (
        <>
        <div className="glass rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                {me?.admin && <th className="px-1 py-2 text-center w-6"></th>}
                <th className="px-2 py-2 text-left">年月</th>
                <th className="px-2 py-2 text-left">種別</th>
                <th className="px-2 py-2 text-left">カテゴリ</th>
                <th className="px-2 py-2 text-left">申請者</th>
                <th className="px-2 py-2 text-left">注文番号</th>
                <th className="px-2 py-2 text-right">金額</th>
                <th className="px-2 py-2 text-center">ステータス</th>
                <th className="px-2 py-2 text-left">申請日時</th>
                <th className="px-2 py-2 text-center">DL</th>
              </tr>
            </thead>
            <tbody>
              {/* 保存済 統合 PDF (issued_invoice_pdfs) を最上部に表示 */}
              {issuedPdfs.map((p) => {
                const surnames = p.source_submission_ids.map((id) => items.find((s) => s.id === id)?.user_display_name).filter(Boolean) as string[]
                const usersStr = Array.from(new Set(surnames)).join(' + ') || (p.user_display_name ?? '—')
                return (
                  <tr key={`issued-${p.id}`} className="border-t border-amber-200 bg-amber-50/40">
                    {me?.admin && (
                      <td className="px-1 py-2 text-center">
                        <input type="checkbox" checked={checkedIssuedIds.has(p.id)} onChange={() => toggleIssuedCheck(p.id)} />
                      </td>
                    )}
                    <td className="px-2 py-2 font-mono">{p.year}/{String(p.month).padStart(2, '0')}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.kind === 'expense' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                        💾 {p.kind === 'expense' ? '立替金 統合(保存済)' : '請求書 統合(保存済)'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[var(--color-text-sub)]">{p.category ? (CATEGORY_LABELS[p.category] ?? p.category) : '—'}</td>
                    <td className="px-2 py-2 font-semibold text-amber-700">{usersStr}</td>
                    <td className="px-2 py-2 font-mono text-xs">{p.purchase_order_no ?? '—'}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{p.total_amount != null ? `¥${p.total_amount.toLocaleString()}` : '—'}</td>
                    <td className="px-2 py-2 text-center"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">統合</span></td>
                    <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">{p.generated_at ? new Date(p.generated_at).toLocaleString('ja-JP') : '—'}</td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        <button onClick={() => previewIssuedPdf(p)}
                          className="rounded border border-sky-400 bg-white px-1.5 py-0.5 text-[10px] text-sky-600 hover:bg-sky-50">🔍</button>
                        {me?.admin && (
                          <button onClick={() => setEditingIssued(p)}
                            className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="編集 → 再生成">✏️</button>
                        )}
                        <button onClick={() => downloadIssuedPdf(p)}
                          className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">📥 {p.file_format.toUpperCase()}</button>
                        {me?.admin && (
                          <button onClick={() => removeIssuedPdf(p.id, p.filename)}
                            className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50">🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* 集約（複数ユーザー / PO マージ）行: テーブル先頭に表示 */}
              {mergedRows.map((m) => {
                const previewBusy = mergeBusy === `${m.key}-preview`
                const pdfBusy = mergeBusy === `${m.key}-pdf`
                const xlsxBusy = mergeBusy === `${m.key}-xlsx`
                // チェックボックス: 集約専用 state でトラッキング（個別 submission には伝播しない）
                const allChecked = checkedMergedKeys.has(m.key)
                const toggleMergedCheck = () => {
                  setCheckedMergedKeys((prev) => { const n = new Set(prev); n.has(m.key) ? n.delete(m.key) : n.add(m.key); return n })
                }
                return (
                <tr key={m.key} className="border-t border-fuchsia-200 bg-fuchsia-50/40">
                  {me?.admin && (
                    <td className="px-1 py-2 text-center">
                      <input type="checkbox" checked={allChecked} onChange={toggleMergedCheck} title="この統合に含まれる申請を全選択" />
                    </td>
                  )}
                  <td className="px-2 py-2 font-mono">{m.year}/{String(m.month).padStart(2, '0')}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${m.kind === 'merged_expense' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                      🔗 {m.kind === 'merged_expense' ? '立替金 集約' : '請求書 PO マージ'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-text-sub)]">{CATEGORY_LABELS[m.category] ?? m.category}</td>
                  <td className="px-2 py-2 font-semibold text-fuchsia-700">{m.users.join(' + ')}</td>
                  <td className="px-2 py-2 font-mono text-xs">{m.po ?? '—'}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">¥{m.total.toLocaleString()}</td>
                  <td className="px-2 py-2 text-center"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-fuchsia-100 text-fuchsia-700">統合</span></td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">—</td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1 justify-center flex-wrap">
                      <button onClick={() => previewMerged(m)} disabled={previewBusy}
                        className="rounded border border-sky-400 bg-white px-1.5 py-0.5 text-[10px] text-sky-600 hover:bg-sky-50 disabled:opacity-50" title="統合 PDF を確認">
                        {previewBusy ? <Spinner /> : '🔍'}
                      </button>
                      {me?.admin && (
                        <button onClick={() => setEditingMergedRow({ ids: m.ids, po: m.po, kind: m.kind })}
                          className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="注文番号を編集">
                          ✏️
                        </button>
                      )}
                      <button onClick={() => saveMergedToDb(m, 'pdf')} disabled={mergeBusy === `${m.key}-save`}
                        className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="統合 PDF を DB 保存 + DL">
                        {mergeBusy === `${m.key}-save` ? <><Spinner /> 生成中</> : '📥 PDF'}
                      </button>
                      {m.kind === 'merged_expense' && (
                        <button onClick={() => saveMergedToDb(m, 'xlsx')} disabled={mergeBusy === `${m.key}-save-xlsx`}
                          className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="統合 Excel を DB 保存 + DL">
                          {mergeBusy === `${m.key}-save-xlsx` ? <><Spinner /> 生成中</> : '📊 Excel'}
                        </button>
                      )}
                      <button onClick={() => sendMergedToLabop(m)}
                        className="rounded bg-gradient-to-r from-rose-500 to-pink-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" title="ラボップにメール送信">
                        📧 送信
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => {
                const rowKey = `${s.kind}-${s.id}`
                const busyPdf = busyId === rowKey
                const busyXlsx = busyId === `${rowKey}-xlsx`
                const isApproved = s.status === 'approved'
                return (
                <tr key={rowKey} className="border-t border-[var(--color-border)]">
                  {me?.admin && (
                    <td className="px-1 py-2 text-center">
                      {s.status === 'approved' && (
                        <input type="checkbox" checked={checkedIds.has(rowKey)} onChange={() => toggleCheck(s)} />
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2 font-mono">{s.year}/{String(s.month).padStart(2, '0')}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.kind === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {KIND_LABELS[s.kind]}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</td>
                  <td className="px-2 py-2 font-semibold">{s.user_display_name}</td>
                  <td className="px-2 py-2 font-mono text-xs">
                    {(() => {
                      const effective = s.effective_purchase_order_no || s.purchase_order_no_override || s.received_purchase_order_no
                      if (!effective) return <span className="text-gray-400">—</span>
                      return <span title={s.received_purchase_order_subject ?? ''}>{effective}</span>
                    })()}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {s.total_override != null && s.total_override !== 0 ? `¥${s.total_override.toLocaleString()}` :
                     s.default_total != null && s.default_total !== 0 ? `¥${s.default_total.toLocaleString()}` :
                     <span className="text-amber-600 text-[10px]">未設定</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s.status]}`}>
                      {s.status === 'pending' ? '申請中' : s.status === 'approved' ? '承認済' : '却下'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleString('ja-JP') : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1 justify-center flex-wrap">
                      <button onClick={() => openPreview(s)}
                        className="rounded border border-sky-400 bg-white px-1.5 py-0.5 text-[10px] text-sky-600 hover:bg-sky-50" title="PDF を確認">
                        🔍
                      </button>
                      {me?.admin && (
                        <button onClick={() => openEdit(s)}
                          className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="編集">
                          ✏️
                        </button>
                      )}
                      {(me?.admin || me?.id === s.user_id) && (
                        <button onClick={() => removeSubmission(s)}
                          className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50" title="削除">
                          🗑
                        </button>
                      )}
                      <button onClick={() => downloadInvoice(s, 'self')} disabled={busyPdf}
                        className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] hover:bg-gray-50 disabled:opacity-50" title="申請者ベースの PDF">
                        {busyPdf ? '…' : '📥 PDF'}
                      </button>
                      {s.kind === 'expense' && (
                        <button onClick={() => downloadExpenseXlsx(s, 'self')} disabled={busyXlsx}
                          className="rounded border border-[var(--color-border)] bg-white px-1.5 py-0.5 text-[10px] hover:bg-gray-50 disabled:opacity-50" title="申請者ベースの Excel">
                          {busyXlsx ? '…' : '📊 xlsx'}
                        </button>
                      )}
                      {isApproved && me?.admin && (
                        <button onClick={() => downloadInvoice(s, 'labop')} disabled={busyPdf}
                          className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="ラボップ宛 PDF">
                          🏢 ラボップ
                        </button>
                      )}
                      {isApproved && me?.admin && s.kind === 'expense' && (
                        <button onClick={() => downloadExpenseXlsx(s, 'labop')} disabled={busyXlsx}
                          className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50" title="ラボップ宛 Excel">
                          🏢 xlsx
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-2 text-[11px]">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded border border-[var(--color-border)] bg-white px-2 py-1 disabled:opacity-40">← 前</button>
            <span className="text-[var(--color-text-sub)]">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length} 件
            </span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * PAGE_SIZE >= filtered.length}
              className="rounded border border-[var(--color-border)] bg-white px-2 py-1 disabled:opacity-40">次 →</button>
          </div>
        )}
        </>
      )}

      {/* プレビューモーダル */}
      {previewSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePreview}>
          <div className="w-full max-w-4xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">🔍 {KIND_LABELS[previewSub.kind]} プレビュー</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">
                  {previewSub.user_display_name} ／ {previewSub.year}年{previewSub.month}月（{CATEGORY_LABELS[previewSub.category]}）
                  {previewSub.received_purchase_order_no && <span className="ml-2 font-mono text-fuchsia-600">{previewSub.received_purchase_order_no}</span>}
                </div>
              </div>
              <button onClick={closePreview} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {previewLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">読込中…</div>}
              {!previewLoading && previewUrl && <iframe src={previewUrl} className="w-full h-full" title="preview" />}
              {!previewLoading && !previewUrl && <div className="h-full flex items-center justify-center text-sm text-red-500">取得できませんでした</div>}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              {previewUrl && (
                <button
                  onClick={async () => {
                    if (previewMergeContext) {
                      // 集約: DB に保存 + ローカル DL
                      setPreviewSaveBusy(true)
                      try {
                        await saveMergedToDb(previewMergeContext, 'pdf')
                        await downloadMerged(previewMergeContext, 'pdf')
                      } finally { setPreviewSaveBusy(false) }
                    } else {
                      // 単一: ローカル DL のみ（個別 submission は元々 DB にある）
                      const a = document.createElement('a')
                      a.href = previewUrl
                      a.download = `${previewSub!.user_display_name}_${previewSub!.kind === 'expense' ? '立替金' : '請求書'}_${previewSub!.year}年_${previewSub!.month}月分.pdf`
                      document.body.appendChild(a); a.click(); a.remove()
                    }
                  }}
                  disabled={previewSaveBusy}
                  className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                  {previewSaveBusy ? <><Spinner /> 保存中</> : (previewMergeContext ? '💾 DB保存 + DL' : '💾 保存')}
                </button>
              )}
              {previewSub.id !== 0 && (
                <button onClick={() => downloadInvoice(previewSub, 'self')}
                  className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">📥 申請者ベースで DL</button>
              )}
              {me?.admin && previewSub.id !== 0 && previewSub.status === 'approved' && (
                <button onClick={() => downloadInvoice(previewSub, 'labop')}
                  className="rounded-md whitespace-nowrap bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">📥 ラボップ宛で DL</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 新規申請モーダル */}
      {creating && me?.admin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">＋ 自分の請求書/立替金 申請を新規作成</div>
              <button onClick={() => setCreating(false)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label><div className="text-[11px] font-semibold mb-0.5">年</div>
                <input type="number" value={createForm.year} onChange={(e) => setCreateForm({ ...createForm, year: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1 text-sm" /></label>
              <label><div className="text-[11px] font-semibold mb-0.5">月</div>
                <input type="number" min={1} max={12} value={createForm.month} onChange={(e) => setCreateForm({ ...createForm, month: Number(e.target.value) })} className="w-full rounded-md border px-2 py-1 text-sm" /></label>
              <label><div className="text-[11px] font-semibold mb-0.5">カテゴリ</div>
                <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} className="w-full rounded-md border px-2 py-1 text-sm">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label><div className="text-[11px] font-semibold mb-0.5">種別</div>
                <select value={createForm.kind} onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value as 'invoice' | 'expense' })} className="w-full rounded-md border px-2 py-1 text-sm">
                  <option value="invoice">請求書</option>
                  <option value="expense">立替金</option>
                </select></label>
              <label className="col-span-2"><div className="text-[11px] font-semibold mb-0.5">対応する注文書（請求書のみ）</div>
                <select value={createForm.received_purchase_order_id} onChange={(e) => setCreateForm({ ...createForm, received_purchase_order_id: e.target.value === '' ? '' : Number(e.target.value) })} className="w-full rounded-md border px-2 py-1 text-sm">
                  <option value="">— 紐付けなし —</option>
                  {pos.map((po) => <option key={po.id} value={po.id}>{po.order_no}{po.subject ? ` / ${po.subject.slice(0, 30)}` : ''}</option>)}
                </select></label>
              <label className="col-span-2"><div className="text-[11px] font-semibold mb-0.5">備考（注文番号等）</div>
                <textarea value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} rows={2} className="w-full rounded-md border px-2 py-1 text-sm" /></label>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={() => setCreating(false)} className="rounded-md border bg-white px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={submitCreate}
                className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
                💾 作成（admin は自動承認）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一括メール送信モーダル */}
      {bulkOpen && (() => {
        const selected = items.filter((s) =>
          s.status === 'approved' && (
            checkedIds.has(`${s.kind}-${s.id}`) || mergedSubmissionIds.has(s.id)
          )
        )
        const invs = selected.filter((s) => s.kind === 'invoice').map((s) => ({
          id: s.id, user_display_name: s.user_display_name, year: s.year, month: s.month, category: s.category,
          kind: 'invoice' as const, total_override: s.total_override, default_total: s.default_total
        }))
        const exps = selected.filter((s) => s.kind === 'expense').map((s) => ({
          id: s.id, user_display_name: s.user_display_name, year: s.year, month: s.month, category: s.category,
          kind: 'expense' as const, total_override: s.total_override, default_total: s.default_total
        }))
        const issued = issuedPdfs.filter((p) => checkedIssuedIds.has(p.id)).map((p) => ({
          id: p.id, filename: p.filename, kind: p.kind, file_format: p.file_format,
          total_amount: p.total_amount, year: p.year, month: p.month, category: p.category,
        }))
        return (
          <LabopMailModal invoices={invs} expenses={exps} issuedPdfs={issued} onClose={() => setBulkOpen(false)} />
        )
      })()}

      {/* 保存済み統合 PDF 編集モーダル */}
      {editingIssued && (
        <IssuedPdfEditModal
          issued={editingIssued}
          onClose={() => setEditingIssued(null)}
          onSaved={async () => { await load(); setEditingIssued(null) }}
        />
      )}

      {/* 統合（未保存）行の注文番号編集モーダル */}
      {editingMergedRow && (
        <MergedRowEditModal
          ids={editingMergedRow.ids}
          currentPo={editingMergedRow.po}
          kind={editingMergedRow.kind}
          onClose={() => setEditingMergedRow(null)}
          onSaved={async () => { await load(); setEditingMergedRow(null) }}
        />
      )}

      {/* 編集モーダル */}
      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeEdit}>
          <div className="w-full max-w-xl rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">✏️ {KIND_LABELS[editingSub.kind]} を編集</div>
              <button onClick={closeEdit} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              {editingSub.user_display_name} ／ {editingSub.year}年{editingSub.month}月（{CATEGORY_LABELS[editingSub.category]}）
              {editingSub.received_purchase_order_no && <span className="ml-2 font-mono text-fuchsia-600">{editingSub.received_purchase_order_no}</span>}
            </div>
            <div className="text-[10px] text-[var(--color-text-sub)] bg-amber-50 px-2 py-1.5 rounded border border-amber-200">
              💡 PDF には別途 <strong>お振込先（口座番号）</strong> が自動表示されます — ⚙ 設定 → 請求書設定 → 銀行情報 で編集
            </div>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">注文番号（PDF 備考の先頭に「注文番号: XXX」として出力）</div>
              <input value={editForm.purchase_order_no_override}
                onChange={(e) => setEditForm({ ...editForm, purchase_order_no_override: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono"
                placeholder="ORD-010014" />
              {editingSub.received_purchase_order_no && (
                <div className="text-[10px] text-[var(--color-text-sub)] mt-0.5">
                  PO 連携: <span className="font-mono">{editingSub.received_purchase_order_no}</span>（空欄ならこちらが使われます）
                </div>
              )}
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">備考（補足メモのみ。注文番号は上の欄）</div>
              <textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                rows={3} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
                placeholder="例: タマリビング案件 西野・川村" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">税込合計（ラボップ宛上書き）</div>
              <input type="text" inputMode="numeric" value={editForm.total_override}
                onChange={(e) => setEditForm({ ...editForm, total_override: e.target.value })}
                placeholder="例: 330000 / マイナス値も可（相殺）"
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono" />
            </label>
            {editingSub.kind === 'invoice' && (
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">件名 上書き（任意）</div>
              <input value={editForm.subject_override} onChange={(e) => setEditForm({ ...editForm, subject_override: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            )}
            {editingSub.kind === 'expense' && (
              <ExpenseEditList submissionUserId={editingSub.user_id} year={editingSub.year} month={editingSub.month} category={editingSub.category} />
            )}
            {editingSub.kind === 'invoice' && (
            <div className="block">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold">品番・品名 / 明細</div>
                <button onClick={addEditItem} className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px]">＋ 行追加</button>
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-[var(--color-text-sub)]">
                  <tr>
                    <th className="text-left">品番・品名</th>
                    <th className="w-12">数量</th>
                    <th className="w-12">単位</th>
                    <th className="w-20">単価</th>
                    <th className="w-20">金額</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {editForm.items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td><input value={it.label} onChange={(e) => updateEditItem(i, { label: e.target.value })} className="w-full px-1 py-0.5 text-[11px] border rounded" /></td>
                      <td><input type="number" step="0.5" value={it.qty} onChange={(e) => updateEditItem(i, { qty: Number(e.target.value) })} className="w-full px-1 py-0.5 text-[11px] text-right border rounded" /></td>
                      <td><input value={it.unit} onChange={(e) => updateEditItem(i, { unit: e.target.value })} className="w-full px-1 py-0.5 text-[11px] border rounded" /></td>
                      <td><input type="number" value={it.unit_price} onChange={(e) => {
                        const up = Number(e.target.value)
                        updateEditItem(i, { unit_price: up, amount: Math.round(up * (Number(it.qty) || 0)) })
                      }} className="w-full px-1 py-0.5 text-[11px] text-right border rounded" /></td>
                      <td><input type="number" value={it.amount} onChange={(e) => updateEditItem(i, { amount: Number(e.target.value) })} className="w-full px-1 py-0.5 text-[11px] text-right border rounded" /></td>
                      <td className="text-center"><button onClick={() => removeEditItem(i)} className="text-gray-400 hover:text-red-500">🗑</button></td>
                    </tr>
                  ))}
                  {editForm.items.length === 0 && <tr><td colSpan={6} className="text-center text-[10px] text-[var(--color-text-sub)] py-1">明細未入力（PDF生成時は default_items から自動）</td></tr>}
                </tbody>
              </table>
            </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={closeEdit} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={saveEdit} disabled={editBusy}
                className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                {editBusy ? '保存中…' : '💾 保存'}
              </button>
            </div>
            <div className="text-[10px] text-[var(--color-text-sub)] pt-1">
              ※ 保存後は新しい PDF が再生成されます。「PDF 上で直接編集」は次フェーズ実装予定。
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
