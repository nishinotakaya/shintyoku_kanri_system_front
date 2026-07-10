import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../lib/api'
import type { Me, PickableUser } from '../lib/api'
import { fetchExportBlob } from '../components/FolderSaveButtons'
import LabopMailModal from '../components/LabopMailModal'
import Modal from '../components/Modal'
import { LabeledField, fieldInputCls } from '../components/InvoiceFormFields'
import InvoiceItemsEditor, { applyInvoiceItemPatch, emptyInvoiceItem, type InvoiceItem } from '../components/InvoiceItemsEditor'
import RowActions from '../components/RowActions'
import ExpenseEditList from '../components/ExpenseEditList'
import IssuedPdfEditModal from '../components/IssuedPdfEditModal'
import MergedRowEditModal from '../components/MergedRowEditModal'
import ScannedInvoiceUploader, { type ScannedInvoice } from '../components/ScannedInvoiceUploader'

// 郵便番号(7桁)から住所(都道府県+市区町村+町域)を zipcloud の無料APIで取得する。API キー不要。
async function fetchAddressByPostal(postal: string): Promise<string | null> {
  const zip = postal.replace(/[^0-9]/g, '')
  if (zip.length !== 7) return null
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`)
    const data = await res.json()
    const hit = data?.results?.[0]
    if (!hit) return null
    return `${hit.address1 ?? ''}${hit.address2 ?? ''}${hit.address3 ?? ''}`
  } catch {
    return null
  }
}

type Submission = {
  id: number
  user_id: number
  user_display_name: string
  year: number
  month: number
  category: string
  kind: 'invoice' | 'expense' | 'work_report' | 'scanned'
  // scanned_invoice 専用フィールド (kind === 'scanned' の場合のみセット)
  scanned_source?: ScannedInvoice
  status: 'draft' | 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  note: string | null
  total_override: number | null
  default_total: number | null
  received_purchase_order_no: string | null
  received_purchase_order_subject: string | null
  purchase_order_no_override?: string | null
  effective_purchase_order_no?: string | null
  paid_at?: string | null
  freee_deal_id?: string | null
  freee_reported_at?: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Tama',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
  video: '動画編集',
}
const KIND_LABELS: Record<string, string> = {
  invoice: '請求書',
  expense: '立替金',
  work_report: '業務報告書',
}
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
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
  source_user_names?: string[]
  items?: { label: string; qty: number; unit: string; unit_price: number; amount: number }[]
  merged: boolean
  total_amount: number | null
  filename: string
  application_date?: string | null
  freee_deal_id?: string | null
  freee_reported_at?: string | null
  generated_at: string | null
}

export default function InvoicesPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Submission[]>([])
  const [issuedPdfs, setIssuedPdfs] = useState<IssuedPdf[]>([])
  const [loading, setLoading] = useState(true)
  const [filterKind, setFilterKind] = useState<'all' | 'invoice' | 'expense'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'pending' | 'approved' | 'rejected'>('all')
  const [filterMonth, setFilterMonth] = useState<string>('') // YYYY-MM
  // 申請者フィルタ（複数選択）。空=全申請者 / 'id:<n>'=個別ユーザー / 'combo:<name1> + <name2>'=組み合わせ(統合PDF用)
  // 選択キーのいずれかにマッチすれば表示（OR 条件）。
  const [filterUserKeys, setFilterUserKeys] = useState<string[]>([])
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [filterText, setFilterText] = useState<string>('')
  // デフォルトは「請求月の新しい順」
  const [sortKey, setSortKey] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'submitted_desc' | 'submitted_asc'>('date_desc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  // scanned_invoice (D&D で取り込んだ PDF) を Submission 形式に変換して一覧に混在表示する
  const scannedToSubmission = (s: ScannedInvoice, viewerName: string, viewerId: number): Submission => {
    const d = s.issue_date ? new Date(s.issue_date) : new Date()
    const partnerCategory =
      s.partner_name?.includes('テックリーダーズ') ? 'techleaders' :
      s.partner_name?.includes('REシステム') ? 'resystems' :
      s.partner_name?.includes('リビング') ? 'living' :
      'wings'
    return {
      id: s.id,
      user_id: viewerId,
      user_display_name: viewerName,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      category: partnerCategory,
      kind: 'scanned',
      status: s.freee_deal_id ? 'approved' : (s.status === 'confirmed' ? 'approved' : 'pending'),
      submitted_at: s.issue_date,
      reviewed_at: null,
      note: s.original_filename,
      total_override: s.total_amount,
      default_total: s.total_amount,
      received_purchase_order_no: s.invoice_number,
      received_purchase_order_subject: s.subject,
      paid_at: s.freee_reported_at,
      freee_deal_id: s.freee_deal_id,
      freee_reported_at: s.freee_reported_at,
      scanned_source: s,
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const [inv, exp, issued, scanned] = await Promise.all([
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'invoice', status: 'all' } }),
        api.get<Submission[]>('/invoice_submissions', { params: { kind: 'expense', status: 'all' } }),
        api.get<IssuedPdf[]>('/issued_invoice_pdfs').catch(() => ({ data: [] as IssuedPdf[] })),
        api.get<ScannedInvoice[]>('/scanned_invoices').catch(() => ({ data: [] as ScannedInvoice[] })),
      ])
      const myMe = await api.get<Me>('/me').then((r) => r.data).catch(() => null)
      const scannedAsSub = scanned.data.map((s) => scannedToSubmission(s, myMe?.display_name ?? 'スキャン', myMe?.id ?? 0))
      setItems([...inv.data, ...exp.data, ...scannedAsSub])
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
  // 仮想統合行(申請から束ねた行)の申請日を変更 = 束ねた各申請の application_date_override を更新
  const setMergedApplicationDate = async (m: { ids: number[] }) => {
    const input = window.prompt('この統合請求書の「申請日」を入力してください（YYYY-MM-DD）。\n空欄にすると月設定の既定日に戻ります。', '')
    if (input === null) return
    try {
      await Promise.all(m.ids.map((id) => api.patch(`/invoice_submissions/${id}`, { application_date_override: input.trim() || null })))
      await load()
      alert('申請日を変更しました（プレビュー/PDF生成に反映されます）')
    } catch (e: any) {
      alert(`変更に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  // 統合(発行済み)請求書PDFの申請日を変更して再生成
  const regenerateIssued = async (p: IssuedPdf) => {
    const cur = (p.application_date ?? '').slice(0, 10)
    const input = window.prompt('この統合請求書の「申請日」を入力してください（YYYY-MM-DD）。\n空欄にすると月設定の既定日に戻ります。', cur)
    if (input === null) return
    try {
      await api.post(`/issued_invoice_pdfs/${p.id}/regenerate`, { application_date: input.trim() || null })
      await load()
      alert('申請日を変更してPDFを再生成しました')
    } catch (e: any) {
      alert(`再生成に失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
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
  // 新規申請モーダル (admin が他ユーザー宛も含めて申請を作れる)
  const [creating, setCreating] = useState(false)
  const [pickableUsers, setPickableUsers] = useState<PickableUser[]>([])
  const [createForm, setCreateForm] = useState<{ year: number; month: number; category: string; kind: 'invoice' | 'expense'; received_purchase_order_id: number | ''; note: string; target_user_id: number | '' }>(
    () => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1, category: 'wings', kind: 'invoice', received_purchase_order_id: '', note: '', target_user_id: '' }
    }
  )
  // シンプル作成: 件名＋明細の手入力（業務報告に依存しない請求書）
  type ManualItem = InvoiceItem
  const [createSubject, setCreateSubject] = useState('')
  const [createItems, setCreateItems] = useState<ManualItem[]>([])
  // 振込先(対象ユーザーの口座)。作成モーダルで入力し、対象ユーザーの InvoiceSetting に保存する。
  const [createBank, setCreateBank] = useState('')
  const [createBankInitial, setCreateBankInitial] = useState('')
  // 住所・電話番号。作成モーダルで入力し、対象ユーザーの InvoiceSetting に連動保存（＝請求書設定にも入る）。
  const [createAddress, setCreateAddress] = useState('')
  const [createAddressInitial, setCreateAddressInitial] = useState('')
  const [createTel, setCreateTel] = useState('')
  const [createTelInitial, setCreateTelInitial] = useState('')
  const [createPostal, setCreatePostal] = useState('')
  const [createPostalInitial, setCreatePostalInitial] = useState('')
  // 請求書単体で持てる項目: インボイス番号 / 申請日 / 支払期限
  const [createRegNo, setCreateRegNo] = useState('')
  const [createAppDate, setCreateAppDate] = useState('')
  const [createDueDate, setCreateDueDate] = useState('')
  const addCreateItem = () => setCreateItems((p) => [...p, emptyInvoiceItem()])
  const updateCreateItem = (i: number, patch: Partial<ManualItem>) => setCreateItems((p) => applyInvoiceItemPatch(p, i, patch))
  const removeCreateItem = (i: number) => setCreateItems((p) => p.filter((_, idx) => idx !== i))
  type ReceivedPO = { id: number; order_no: string; subject: string | null; user_id: number; category: string | null }
  const [pos, setPos] = useState<ReceivedPO[]>([])
  // 対象ユーザー×カテゴリの振込先(口座)を読み込んでプレフィル
  useEffect(() => {
    if (!creating) return
    const params: Record<string, unknown> = { category: createForm.category }
    if (me?.admin && createForm.target_user_id) params.as_user_id = createForm.target_user_id
    api.get('/invoice_setting', { params })
      .then((r) => {
        const b = (r.data?.bank_info as string) ?? ''; setCreateBank(b); setCreateBankInitial(b)
        const addr = (r.data?.address as string) ?? ''; setCreateAddress(addr); setCreateAddressInitial(addr)
        const tel = (r.data?.tel as string) ?? ''; setCreateTel(tel); setCreateTelInitial(tel)
        const postal = (r.data?.postal_code as string) ?? ''; setCreatePostal(postal); setCreatePostalInitial(postal)
        setCreateRegNo((r.data?.registration_no as string) ?? '') // インボイス番号の既定(設定値)をプレフィル
      })
      .catch(() => { setCreateBank(''); setCreateBankInitial(''); setCreateAddress(''); setCreateAddressInitial(''); setCreateTel(''); setCreateTelInitial(''); setCreatePostal(''); setCreatePostalInitial(''); setCreateRegNo('') })
  }, [creating, createForm.category, createForm.target_user_id, me?.admin])
  useEffect(() => {
    if (!creating) return
    api.get<ReceivedPO[]>('/received_purchase_orders', { params: { year: createForm.year, month: createForm.month } })
      .then((r) => setPos(r.data.filter((po) => !po.category || po.category === createForm.category)))
      .catch(() => setPos([]))
    if (!pickableUsers.length) {
      api.get<PickableUser[]>('/users/pickable').then((r) => setPickableUsers(r.data)).catch(() => {})
    }
  }, [creating, createForm.year, createForm.month, createForm.category])
  const submitCreate = async () => {
    try {
      // 振込先・住所・電話番号が変更されていれば先に請求書設定へ保存（設定に連動）→ 生成PDFに反映される
      if (createBank !== createBankInitial || createAddress !== createAddressInitial || createTel !== createTelInitial || createPostal !== createPostalInitial) {
        const settingPayload: Record<string, unknown> = { category: createForm.category }
        if (createBank !== createBankInitial) settingPayload.bank_info = createBank
        if (createAddress !== createAddressInitial) settingPayload.address = createAddress
        if (createTel !== createTelInitial) settingPayload.tel = createTel
        if (createPostal !== createPostalInitial) settingPayload.postal_code = createPostal
        const bankParams: Record<string, unknown> = { invoice_setting: settingPayload, category: createForm.category }
        if (me?.admin && createForm.target_user_id) bankParams.as_user_id = createForm.target_user_id
        await api.patch('/invoice_setting', bankParams)
        setCreateBankInitial(createBank); setCreateAddressInitial(createAddress); setCreateTelInitial(createTel); setCreatePostalInitial(createPostal)
      }
      const cleanItems = createItems.filter((it) => it.label.trim() !== '' || it.amount !== 0)
      await api.post('/invoice_submissions', {
        year: createForm.year,
        month: createForm.month,
        category: createForm.category,
        kind: createForm.kind,
        note: createForm.note || null,
        received_purchase_order_id: createForm.received_purchase_order_id || null,
        target_user_id: createForm.target_user_id || null,
        subject_override: createSubject.trim() || null,
        items_override: cleanItems.length > 0 ? cleanItems : null,
        registration_no_override: createRegNo.trim() || null,
        application_date_override: createAppDate || null,
        due_date_override: createDueDate || null,
      })
      setCreating(false)
      setCreateSubject(''); setCreateItems([]); setCreateBank(''); setCreateBankInitial('')
      setCreateAddress(''); setCreateAddressInitial(''); setCreateTel(''); setCreateTelInitial('')
      setCreatePostal(''); setCreatePostalInitial('')
      setCreateRegNo(''); setCreateAppDate(''); setCreateDueDate('')
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
  // Excel プレビュー用
  const [previewMode, setPreviewMode] = useState<'pdf' | 'xlsx'>('pdf')
  const [previewXlsx, setPreviewXlsx] = useState<{ sheets: { name: string; rows: any[][] }[] } | null>(null)
  const [previewXlsxLoading, setPreviewXlsxLoading] = useState(false)
  const [previewXlsxSheetIdx, setPreviewXlsxSheetIdx] = useState(0)
  const [previewSaveBusy, setPreviewSaveBusy] = useState(false)
  // 編集モーダル
  type ItemRow = InvoiceItem
  const [editingIssued, setEditingIssued] = useState<IssuedPdf | null>(null)
  const [editingMergedRow, setEditingMergedRow] = useState<{ ids: number[]; po: string | null; kind: 'merged_expense' | 'merged_invoice' } | null>(null)
  const [editingSub, setEditingSub] = useState<Submission | null>(null)
  const [editForm, setEditForm] = useState<{ note: string; purchase_order_no_override: string; total_override: string; subject_override: string; application_date: string; due_date: string; registration_no: string; bank_info: string; address: string; tel: string; postal: string; paid_at: string; items: ItemRow[] }>({ note: '', purchase_order_no_override: '', total_override: '', subject_override: '', application_date: '', due_date: '', registration_no: '', bank_info: '', address: '', tel: '', postal: '', paid_at: '', items: [] })
  const [editBusy, setEditBusy] = useState(false)
  const updateEditItem = (i: number, patch: Partial<ItemRow>) => setEditForm((p) => ({ ...p, items: applyInvoiceItemPatch(p.items, i, patch) }))
  const addEditItem = () => setEditForm((p) => ({ ...p, items: [...p.items, emptyInvoiceItem()] }))
  const removeEditItem = (i: number) => setEditForm((p) => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))

  const openPreview = async (s: Submission) => {
    setPreviewSub(s); setPreviewUrl(null); setPreviewLoading(true)
    setPreviewMode('pdf'); setPreviewXlsx(null); setPreviewXlsxSheetIdx(0)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
      const params: Record<string, unknown> = { month: monthParam, category: s.category, as_user_id: s.user_id }
      params.invoice_submission_id = s.id
      params._t = Date.now() // キャッシュ無効化: 編集後に必ず最新PDFを取得
      const { blob } = await fetchExportBlob(path, params, 'preview.pdf')
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (e: any) {
      alert(`プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewSub(null)
    } finally { setPreviewLoading(false) }
  }
  const loadPreviewXlsx = async (s: Submission) => {
    if (previewXlsx) return  // キャッシュ済みなら再取得しない
    setPreviewXlsxLoading(true)
    try {
      const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
      const params: Record<string, unknown> = { month: monthParam, category: s.category, as_user_id: s.user_id }
      params.invoice_submission_id = s.id
      const { blob } = await fetchExportBlob('/exports/expense.xlsx', params, 'preview.xlsx')
      const ab = await blob.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array' })
      const sheets = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: '' }) as any[][],
      }))
      setPreviewXlsx({ sheets })
    } catch (e: any) {
      alert(`Excel プレビュー失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
      setPreviewMode('pdf')
    } finally {
      setPreviewXlsxLoading(false)
    }
  }
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); setPreviewSub(null); setPreviewLoading(false)
    setPreviewMergeContext(null)
    setPreviewMode('pdf'); setPreviewXlsx(null); setPreviewXlsxSheetIdx(0)
  }

  const openEdit = async (s: Submission) => {
    setEditingSub(s)
    // 詳細フェッチして default_items 等を取得
    try {
      const r = await api.get<Submission & { items_override: ItemRow[] | null; default_items: ItemRow[] | null; default_subject: string | null; due_date_override: string | null; default_due_date: string | null }>('/invoice_submissions', { params: { kind: s.kind, status: 'all' } })
      const detail = (r.data as unknown as any[]).find((x) => x.id === s.id) || s
      const items: ItemRow[] = (detail.items_override && detail.items_override.length > 0 ? detail.items_override : (detail.default_items ?? [])) as ItemRow[]
      setEditForm({
        note: detail.note ?? '',
        purchase_order_no_override: (detail as any).purchase_order_no_override ?? (detail.received_purchase_order_no ?? ''),
        total_override: detail.total_override != null ? String(detail.total_override) : '',
        subject_override: detail.subject_override ?? detail.default_subject ?? '',
        application_date: String((detail as any).application_date_override ?? detail.submitted_at ?? '').slice(0, 10),
        due_date: String((detail as any).due_date_override ?? (detail as any).default_due_date ?? '').slice(0, 10),
        registration_no: String((detail as any).registration_no_override ?? (detail as any).default_registration_no ?? ''),
        bank_info: String((detail as any).bank_info_override ?? (detail as any).default_bank_info ?? ''),
        address: String((detail as any).default_address ?? ''),
        tel: String((detail as any).default_tel ?? ''),
        postal: String((detail as any).default_postal_code ?? ''),
        paid_at: String((detail as any).paid_at ?? '').slice(0, 10),
        items: items.length > 0 ? items : [],
      })
    } catch {
      setEditForm({
        note: s.note ?? '',
        purchase_order_no_override: s.received_purchase_order_no ?? '',
        total_override: s.total_override != null ? String(s.total_override) : '',
        subject_override: '',
        application_date: String((s as any).application_date_override ?? s.submitted_at ?? '').slice(0, 10),
        due_date: String((s as any).due_date_override ?? '').slice(0, 10),
        registration_no: String((s as any).registration_no_override ?? ''),
        bank_info: String((s as any).bank_info_override ?? ''),
        address: '',
        tel: '',
        postal: '',
        paid_at: String((s as any).paid_at ?? '').slice(0, 10),
        items: [],
      })
    }
  }
  const closeEdit = () => { setEditingSub(null) }
  const saveEdit = async () => {
    if (!editingSub) return
    setEditBusy(true)
    try {
      // 税込合計は明細から自動算出（明細があれば右下表示と同じ値を保存）。明細が無ければ従来の手入力値。
      const itemsClean = editForm.items.filter((it) => it.label.trim() !== '' || it.amount > 0)
      const taxRate = (editingSub.category === 'resystems' || editingSub.category === 'techleaders') ? 0 : 10
      let totalOverride = editForm.total_override.replace(/[^\d-]/g, '')
      if (itemsClean.length > 0) {
        const subtotal = itemsClean.reduce((a, it) => a + (Number(it.amount) || 0), 0)
        totalOverride = String(subtotal + Math.round((subtotal * taxRate) / 100))
      }
      const payload: Record<string, unknown> = {
        note: editForm.note,
        purchase_order_no_override: editForm.purchase_order_no_override,
        total_override: totalOverride,
        subject_override: editForm.subject_override,
        application_date_override: editForm.application_date || null,
        due_date_override: editForm.due_date || null,
        registration_no_override: editForm.registration_no.trim() || null,
        bank_info_override: editForm.bank_info.trim() || null,
      }
      if (itemsClean.length > 0) {
        payload.items_override = itemsClean.map((it) => ({
          label: it.label, qty: Number(it.qty) || 0, unit: it.unit || '式',
          unit_price: Number(it.unit_price) || 0, amount: Number(it.amount) || 0,
        }))
      }
      await api.patch(`/invoice_submissions/${editingSub.id}`, payload)
      // 振込先・住所・電話番号は請求書設定(invoice_setting)にも連動保存 → 以後の既定になる
      const settingPayload: Record<string, unknown> = {
        category: editingSub.category,
        bank_info: editForm.bank_info,
        address: editForm.address,
        tel: editForm.tel,
        postal_code: editForm.postal,
      }
      const settingParams: Record<string, unknown> = { invoice_setting: settingPayload, category: editingSub.category }
      if (me?.admin && editingSub.user_id) settingParams.as_user_id = editingSub.user_id
      await api.patch('/invoice_setting', settingParams).catch(() => {})
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
    const months = new Set(selected.map((s) => `${s.year}-${s.month}`))
    if (months.size > 1) { alert('同じ年月の申請のみ統合できます'); return }
    // カテゴリ混在は許可（統合請求書はラボップ宛で1通にまとまる）。誤操作防止に確認だけ出す。
    const cats = new Set(selected.map((s) => s.category))
    if (cats.size > 1) {
      const catLabel = Array.from(cats).map((c) => CATEGORY_LABELS[c] ?? c).join(' / ')
      if (!confirm(`カテゴリが混在しています（${catLabel}）。\nラボップ宛の統合請求書として1通にまとめます。続行しますか？`)) return
    }
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

  const unsetPaid = async (s: Submission) => {
    if (!confirm(`${s.year}/${s.month} ${s.kind === 'invoice' ? '請求書' : '立替金'}（${s.user_display_name}）の振込済を取り消しますか？`)) return
    try {
      await api.patch(`/invoice_submissions/${s.id}`, { paid_at: null })
      await load()
    } catch (e: any) {
      alert(`取消失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const [scannedDetail, setScannedDetail] = useState<ScannedInvoice | null>(null)
  const [scannedPdfUrl, setScannedPdfUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!scannedDetail || !scannedDetail.has_pdf) { setScannedPdfUrl(null); return }
    let url: string | null = null
    api.get(`/scanned_invoices/${scannedDetail.id}/pdf`, { responseType: 'blob' })
      .then((r) => { url = URL.createObjectURL(r.data); setScannedPdfUrl(url) })
      .catch(() => setScannedPdfUrl(null))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [scannedDetail])

  const reportScannedToFreee = async (id: number) => {
    if (!confirm(`この請求書を freee に売上計上しますか？`)) return
    try {
      const { data } = await api.post(`/scanned_invoices/${id}/report_to_freee`)
      alert(`✅ ${data.message ?? 'freee 計上完了'} (deal_id=${data.deal_id})`)
      await load()
    } catch (e: any) {
      alert(`❌ ${e?.response?.data?.error ?? '計上失敗'}`)
    }
  }

  const removeScanned = async (id: number) => {
    if (!confirm('この読み取り結果を削除しますか？')) return
    try {
      await api.delete(`/scanned_invoices/${id}`)
      await load()
    } catch (e: any) {
      alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const reportIssuedToFreee = async (p: IssuedPdf) => {
    if (!p.total_amount) { alert('金額が未設定のため計上できません'); return }
    if (!confirm(`${p.year}/${p.month} ${CATEGORY_LABELS[p.category ?? ''] ?? p.category} 統合請求書を freee に売上計上しますか？\n金額: ¥${p.total_amount.toLocaleString()}`)) return
    try {
      const { data } = await api.post(`/issued_invoice_pdfs/${p.id}/report_to_freee`)
      alert(`✅ ${data.message ?? 'freee 計上完了'} (deal_id=${data.deal_id})`)
      await load()
    } catch (e: any) {
      alert(`❌ ${e?.response?.data?.error ?? '計上失敗'}`)
    }
  }

  const reportInvoiceToFreee = async (s: Submission) => {
    const amount = s.total_override ?? s.default_total ?? 0
    if (!amount) { alert('金額が未設定のため計上できません'); return }
    if (!confirm(`${s.year}/${s.month} ${CATEGORY_LABELS[s.category] ?? s.category} 請求書を freee に売上計上しますか？\n金額: ¥${amount.toLocaleString()}`)) return
    try {
      const { data } = await api.post(`/invoice_submissions/${s.id}/report_to_freee`)
      alert(`✅ ${data.message ?? 'freee 計上完了'} (deal_id=${data.deal_id})`)
      await load()
    } catch (e: any) {
      alert(`❌ ${e?.response?.data?.error ?? '計上失敗'}`)
    }
  }

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
      const params: Record<string, unknown> = { month: monthParam, category: s.category, _t: Date.now() }
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
  // 一覧から手動で隠した集約行 (ゴミ箱ボタン押下分)。localStorage に永続化
  const [dismissedMergedKeys, setDismissedMergedKeys] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dismissedMergedKeys') || '[]')) } catch { return new Set() }
  })
  const dismissMergedRow = (key: string) => {
    setDismissedMergedKeys((prev) => {
      const next = new Set(prev); next.add(key)
      try { localStorage.setItem('dismissedMergedKeys', JSON.stringify(Array.from(next))) } catch {}
      return next
    })
  }
  const mergedRows: MergedRow[] = useMemo(() => {
    const rows: MergedRow[] = []
    // 既に保存済 統合 PDF (IssuedInvoicePdf) があれば virtual 行は重複なので隠す
    const savedExpenseKeys = new Set(
      issuedPdfs.filter((p) => p.kind === 'expense' && p.merged && p.year && p.month && p.category)
        .map((p) => `${p.year}-${p.month}-${p.category}`)
    )
    const savedInvoicePoKeys = new Set(
      issuedPdfs.filter((p) => p.kind === 'invoice' && p.merged && p.purchase_order_no)
        .map((p) => `${p.purchase_order_no}`)
    )
    // 立替金 集約: 承認済 expense を (year, month, category) でグループ化、複数ユーザー
    const expGroups = new Map<string, Submission[]>()
    items.filter((s) => s.kind === 'expense' && s.status === 'approved').forEach((s) => {
      const key = `${s.year}-${s.month}-${s.category}`
      const arr = expGroups.get(key) ?? []; arr.push(s); expGroups.set(key, arr)
    })
    expGroups.forEach((subs, key) => {
      const userSet = new Set(subs.map((s) => s.user_display_name))
      if (userSet.size < 2) return
      if (savedExpenseKeys.has(key)) return
      if (dismissedMergedKeys.has(`me-${key}`)) return
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
      if (savedInvoicePoKeys.has(po)) return
      if (dismissedMergedKeys.has(`mi-${po}`)) return
      const userSet = new Set(subs.map((s) => s.user_display_name))
      const totalSum = subs.reduce((acc, s) => acc + (s.total_override ?? s.default_total ?? 0), 0)
      rows.push({ kind: 'merged_invoice', key: `mi-${po}`, year: subs[0].year, month: subs[0].month, category: subs[0].category, users: Array.from(userSet), ids: subs.map((s) => s.id), po, total: totalSum })
    })
    return rows
  }, [items, issuedPdfs, dismissedMergedKeys])

  // 発行済み統合PDF(IssuedInvoicePdf)のうち、元申請が一覧に存在しないもの(=孤立。例: 4月分など申請が無い確定PDF)を
  // 独立した行として表示する。これが無いと申請の無い発行済みPDFが一覧から消えて見える。
  const issuedRows = useMemo(() => {
    const itemIds = new Set(items.map((s) => s.id))
    return issuedPdfs
      .filter((p) => !(p.source_submission_ids ?? []).some((id) => itemIds.has(id)))
      .filter((p) => filterKind === 'all' || p.kind === filterKind || (filterKind === 'invoice' && p.kind === 'invoice'))
      .filter(() => filterStatus === 'all' || filterStatus === 'approved')
      .filter((p) => {
        if (!filterMonth) return true
        return `${p.year}-${String(p.month).padStart(2, '0')}` === filterMonth
      })
      .filter((p) => {
        if (filterUserKeys.length === 0) return true
        return filterUserKeys.some((key) => {
          if (key.startsWith('id:')) return p.user_id === Number(key.substring(3))
          if (key.startsWith('combo:')) {
            const names = key.substring(6).split(' + ')
            return (p.source_user_names ?? [p.user_display_name]).some((n) => !!n && names.includes(n))
          }
          return false
        })
      })
  }, [issuedPdfs, items, filterKind, filterStatus, filterMonth, filterUserKeys])

  // 統合行も月/種別/ユーザーのフィルターを適用（従来は無条件表示で、月で絞ると申請0件時にテーブルごと消えていた）
  const visibleMerged = useMemo(() => {
    return mergedRows
      .filter((m) => filterKind === 'all' || (filterKind === 'invoice' && m.kind === 'merged_invoice') || (filterKind === 'expense' && m.kind === 'merged_expense'))
      .filter(() => filterStatus === 'all' || filterStatus === 'approved')
      .filter((m) => {
        if (!filterMonth) return true
        return `${m.year}-${String(m.month).padStart(2, '0')}` === filterMonth
      })
      .filter((m) => {
        if (filterUserKeys.length === 0) return true
        // id: 単独指定は統合行を絞らない（従来挙動）。combo: のいずれかにマッチすれば表示。
        const comboKeys = filterUserKeys.filter((k) => k.startsWith('combo:'))
        if (comboKeys.length === 0) return true
        return comboKeys.some((key) => {
          const names = key.substring(6).split(' + ')
          return m.users.some((n) => names.includes(n))
        })
      })
  }, [mergedRows, filterKind, filterStatus, filterMonth, filterUserKeys])

  // 集約行 (merged_invoice / merged_expense) のチェックを構成する個別 submission の id 集合に展開
  const mergedSubmissionIds = useMemo(() => {
    const ids = new Set<number>()
    mergedRows.forEach((m) => {
      if (checkedMergedKeys.has(m.key)) m.ids.forEach((id) => ids.add(id))
    })
    return ids
  }, [mergedRows, checkedMergedKeys])

  const filtered = useMemo(() => {
    const text = filterText.trim().toLowerCase()
    const amount = (s: Submission) => s.total_override ?? s.default_total ?? 0
    return items
      // 'invoice' フィルター時には scanned (D&D PDF) も含める
      .filter((s) => filterKind === 'all' || s.kind === filterKind || (filterKind === 'invoice' && s.kind === 'scanned'))
      .filter((s) => filterStatus === 'all' || s.status === filterStatus)
      .filter((s) => {
        if (!filterMonth) return true
        const ym = `${s.year}-${String(s.month).padStart(2, '0')}`
        return ym === filterMonth
      })
      .filter((s) => {
        if (filterUserKeys.length === 0) return true
        return filterUserKeys.some((key) => {
          if (key.startsWith('id:')) return s.user_id === Number(key.substring(3))
          if (key.startsWith('combo:')) {
            const names = key.substring(6).split(' + ')
            return names.includes(s.user_display_name)
          }
          return false
        })
      })
      .filter((s) => {
        if (!text) return true
        const fields = [
          s.user_display_name,
          s.note,
          s.received_purchase_order_no,
          s.received_purchase_order_subject,
          s.purchase_order_no_override,
          s.effective_purchase_order_no,
          CATEGORY_LABELS[s.category],
        ]
        return fields.some((f) => f?.toLowerCase().includes(text))
      })
      .sort((a, b) => {
        switch (sortKey) {
          case 'date_asc': {
            const ka = `${a.year}-${String(a.month).padStart(2, '0')}-${a.kind}-${a.id}`
            const kb = `${b.year}-${String(b.month).padStart(2, '0')}-${b.kind}-${b.id}`
            return ka.localeCompare(kb)
          }
          case 'amount_desc':
            return amount(b) - amount(a)
          case 'amount_asc':
            return amount(a) - amount(b)
          case 'submitted_desc':
            return (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')
          case 'submitted_asc':
            return (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '')
          case 'date_desc':
          default: {
            const ka = `${a.year}-${String(a.month).padStart(2, '0')}-${a.kind}-${a.id}`
            const kb = `${b.year}-${String(b.month).padStart(2, '0')}-${b.kind}-${b.id}`
            return kb.localeCompare(ka)
          }
        }
      })
  }, [items, filterKind, filterStatus, filterMonth, filterUserKeys, filterText, sortKey])

  const filteredTotal = useMemo(
    () => filtered.reduce((acc, s) => acc + (s.total_override ?? s.default_total ?? 0), 0),
    [filtered]
  )

  // 合計を「西野(閲覧している管理者)本人の売上」と「外注への支払(パートナー分)」に分ける。
  // ラボップは統合請求書で西野に全額(外注分込み)を振込 → 西野の請求=売上 / 外注の請求=西野が払う経費。
  // PDF取込(scanned)は他社発行の受領請求書で西野の売上ではないため、分割集計からは除外する(総合計には含む)。
  const filteredTotals = useMemo(() => {
    let ownSales = 0
    let subcontractPayment = 0
    for (const s of filtered) {
      if (s.kind === 'scanned') continue
      const amount = s.total_override ?? s.default_total ?? 0
      if (me != null && s.user_id === me.id) ownSales += amount
      else subcontractPayment += amount
    }
    return { ownSales, subcontractPayment }
  }, [filtered, me])

  // 振込通知メール（支払通知書）
  const todayStr = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [paymentNoticeOpen, setPaymentNoticeOpen] = useState(false)
  const [paymentDate, setPaymentDate] = useState<string>(todayStr)
  const [paymentTo, setPaymentTo] = useState('takaya777boxing@gmail.com')
  const [paymentRecipient, setPaymentRecipient] = useState('')
  const [paymentSubject, setPaymentSubject] = useState('')
  const [paymentBody, setPaymentBody] = useState('')
  const [paymentDrafting, setPaymentDrafting] = useState(false)
  const [paymentSending, setPaymentSending] = useState(false)
  const [paymentMsg, setPaymentMsg] = useState<string | null>(null)
  const checkedSubmissionIds = useMemo(
    () => Array.from(checkedIds).map((k) => Number(k.split('-')[1])).filter((n) => Number.isFinite(n)),
    [checkedIds]
  )
  // 申請(submit): 下書きを承認フローへ。チェック済みの下書きを対象にする。
  const checkedDrafts = useMemo(
    () => items.filter((s) => checkedIds.has(`${s.kind}-${s.id}`) && s.status === 'draft'),
    [items, checkedIds]
  )
  const checkedDraftIds = useMemo(() => checkedDrafts.map((s) => s.id), [checkedDrafts])
  // 申請確認モーダル: 対象行を表示してから確定する（confirm アラートの代わり）
  const [submitRows, setSubmitRows] = useState<Submission[] | null>(null)
  const [submitBusy, setSubmitBusy] = useState(false)
  // 申請確認モーダルに「申請書PDF」を表示する（単体申請のとき）
  const [submitPdfUrl, setSubmitPdfUrl] = useState<string | null>(null)
  const [submitPdfLoading, setSubmitPdfLoading] = useState(false)
  useEffect(() => {
    if (!submitRows || submitRows.length !== 1) { setSubmitPdfUrl(null); return }
    const s = submitRows[0]
    if (s.kind !== 'invoice' && s.kind !== 'expense') { setSubmitPdfUrl(null); return }
    let cancelled = false
    let objectUrl: string | null = null
    setSubmitPdfLoading(true); setSubmitPdfUrl(null)
    void (async () => {
      try {
        const monthParam = `${s.year}-${String(s.month).padStart(2, '0')}`
        const path = s.kind === 'expense' ? '/exports/expense.pdf' : '/exports/invoice.pdf'
        const { blob } = await fetchExportBlob(path, { month: monthParam, category: s.category, as_user_id: s.user_id, invoice_submission_id: s.id, _t: Date.now() }, 'preview.pdf')
        if (!cancelled) { objectUrl = URL.createObjectURL(blob); setSubmitPdfUrl(objectUrl) }
      } catch { if (!cancelled) setSubmitPdfUrl(null) } finally { if (!cancelled) setSubmitPdfLoading(false) }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [submitRows])
  const submitOne = (s: Submission) => setSubmitRows([s])
  const submitBulk = () => { if (checkedDrafts.length > 0) setSubmitRows(checkedDrafts) }
  const confirmSubmit = async () => {
    if (!submitRows || submitRows.length === 0) return
    setSubmitBusy(true)
    try {
      if (submitRows.length === 1) {
        await api.post(`/invoice_submissions/${submitRows[0].id}/submit`)
      } else {
        await api.post('/invoice_submissions/submit_bulk', { ids: submitRows.map((r) => r.id) })
      }
      setSubmitRows(null); setCheckedIds(new Set()); await load()
    } catch (e: any) {
      alert(`申請失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setSubmitBusy(false) }
  }
  // 承認 / 却下（admin が申請中の請求書/立替金を一覧から直接処理する）
  const [approveBusyId, setApproveBusyId] = useState<number | null>(null)
  const approveOne = async (s: Submission) => {
    if (!confirm(`${s.user_display_name} の ${s.year}年${s.month}月 ${CATEGORY_LABELS[s.category] ?? s.category}（${KIND_LABELS[s.kind]}）を承認しますか？`)) return
    setApproveBusyId(s.id)
    try {
      await api.patch(`/invoice_submissions/${s.id}`, { status: 'approved' })
      await load()
    } catch (e: any) {
      alert(`承認失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setApproveBusyId(null) }
  }
  const rejectOne = async (s: Submission) => {
    const comment = prompt('却下理由（任意・申請者に共有されます）', '')
    if (comment === null) return
    setApproveBusyId(s.id)
    try {
      await api.patch(`/invoice_submissions/${s.id}`, { status: 'rejected', review_comment: comment.trim() })
      await load()
    } catch (e: any) {
      alert(`却下失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setApproveBusyId(null) }
  }
  const openPaymentNotice = () => {
    setPaymentMsg(null)
    setPaymentSubject('')
    setPaymentBody('')
    setPaymentDate(todayStr()) // 振込日は常に「振込通知を出す当日」を初期値にする（古い日付が残らないように）
    setPaymentNoticeOpen(true)
  }
  const closePaymentNotice = () => {
    setPaymentNoticeOpen(false)
    setPaymentMsg(null)
  }
  const draftPaymentNotice = async () => {
    setPaymentDrafting(true); setPaymentMsg(null)
    try {
      const r = await api.post<{ subject: string; body: string }>('/emails/payment_notice_draft', {
        invoice_submission_ids: checkedSubmissionIds,
        paid_on: paymentDate,
        recipient_name: paymentRecipient || undefined,
      })
      setPaymentSubject(r.data.subject ?? '')
      setPaymentBody(r.data.body ?? '')
    } catch (e: any) {
      setPaymentMsg(`下書き失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setPaymentDrafting(false)
    }
  }
  const sendPaymentNotice = async () => {
    if (!paymentSubject.trim() || !paymentBody.trim()) {
      setPaymentMsg('件名・本文を埋めてください（先に「下書き生成」）')
      return
    }
    if (!paymentTo.trim()) { setPaymentMsg('宛先が空です'); return }
    if (!confirm(`${checkedSubmissionIds.length} 件を振込済としてマークし、${paymentTo} にメール送信します。よろしいですか？`)) return
    setPaymentSending(true); setPaymentMsg(null)
    try {
      const r = await api.post<{ ok: boolean; sent_to: string; count: number }>('/emails/payment_notice_send', {
        invoice_submission_ids: checkedSubmissionIds,
        paid_on: paymentDate,
        to: paymentTo,
        subject: paymentSubject,
        body: paymentBody,
      })
      setPaymentMsg(`✅ 送信完了 → ${r.data.sent_to}（${r.data.count} 件 振込済に更新）`)
      setCheckedIds(new Set())
      await load()
      setTimeout(() => closePaymentNotice(), 1500)
    } catch (e: any) {
      setPaymentMsg(`送信失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setPaymentSending(false)
    }
  }

  // 申請者一覧（個別ユーザー + 統合PDFの組み合わせ）
  const userOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = []
    const idSeen = new Set<number>()
    items.forEach((s) => {
      if (idSeen.has(s.user_id)) return
      idSeen.add(s.user_id)
      opts.push({ key: `id:${s.user_id}`, label: s.user_display_name })
    })
    const comboSeen = new Set<string>()
    issuedPdfs.forEach((p) => {
      const names = Array.from(new Set((p.source_user_names ?? []).filter(Boolean)))
      if (names.length < 2) return
      const combo = names.join(' + ')
      if (comboSeen.has(combo)) return
      comboSeen.add(combo)
      opts.push({ key: `combo:${combo}`, label: combo })
    })
    return opts
  }, [items, issuedPdfs])

  return (
    <div className="space-y-3">
      <ScannedInvoiceUploader onUploaded={() => load()} />

      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">📄 請求書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            {me?.admin ? '全ユーザーの請求書/立替金 申請' : '自分の請求書/立替金 申請'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me && (
            <button onClick={() => {
                // 非admin(須崎さん等)は「動画編集」をデフォルトに。明細はデフォルトで1行出す。
                setCreateForm((f) => ({ ...f, category: me.admin ? f.category : 'video' }))
                setCreateItems((items) => (items.length > 0 ? items : [{ label: '', qty: 1, unit: '式', unit_price: 0, amount: 0 }]))
                setCreating(true)
              }}
              className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
              ＋ 請求書/立替金を作成（下書き）
            </button>
          )}
          {checkedDraftIds.length > 0 && (
            <button onClick={submitBulk}
              className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
              title="選択した下書きを一括で申請（承認フローへ）">
              📤 選択 {checkedDraftIds.length} 件を一括申請
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
          {me?.admin && checkedIds.size > 0 && (
            <button onClick={() => openPaymentNotice()}
              className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
              title="選択した請求書/立替金に対して振込通知メールを送信し、振込済にする">
              💰 選択 {checkedIds.size} 件に振込通知
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
          {(['all', 'draft', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`rounded px-2 py-1 text-[11px] font-semibold ${filterStatus === s ? 'bg-sky-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
              {s === 'all' ? '全ステータス' : s === 'draft' ? '下書き' : s === 'pending' ? '申請中' : s === 'approved' ? '承認済' : '却下'}
            </button>
          ))}
        </div>
        <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs" />
        {filterMonth && <button onClick={() => setFilterMonth('')} className="text-[11px] text-[var(--color-text-sub)]">×</button>}
        {me?.admin && (
          <div className="relative">
            <button type="button" onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs text-[var(--color-text)]">
              <span>{filterUserKeys.length === 0 ? '全申請者' : `申請者 ${filterUserKeys.length}人`}</span>
              <span className="text-[9px] text-[var(--color-text-sub)]">▾</span>
            </button>
            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white p-1 shadow-lg">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-semibold text-[var(--color-text-sub)]">複数選択できます</span>
                    {filterUserKeys.length > 0 && <button onClick={() => setFilterUserKeys([])} className="text-[10px] text-fuchsia-600">全解除</button>}
                  </div>
                  {userOptions.map((u) => {
                    const checked = filterUserKeys.includes(u.key)
                    return (
                      <label key={u.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-fuchsia-50">
                        <input type="checkbox" checked={checked}
                          onChange={() => setFilterUserKeys((prev) => checked ? prev.filter((k) => k !== u.key) : [...prev, u.key])} />
                        <span className="truncate">{u.label}</span>
                      </label>
                    )
                  })}
                  {userOptions.length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--color-text-sub)]">申請者がいません</div>}
                </div>
              </>
            )}
          </div>
        )}
        {filterUserKeys.length > 0 && <button onClick={() => setFilterUserKeys([])} className="text-[11px] text-[var(--color-text-sub)]">×</button>}
        <input
          type="search"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="🔍 取引先・件名・備考"
          className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs w-48"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          title="並び順"
          className="rounded border border-[var(--color-border)] bg-white px-2 py-1 text-xs"
        >
          <option value="date_desc">📅 日付（新しい順）</option>
          <option value="date_asc">📅 日付（古い順）</option>
          <option value="amount_desc">💰 金額（大きい順）</option>
          <option value="amount_asc">💰 金額（小さい順）</option>
          <option value="submitted_desc">📤 送信日（新しい順）</option>
          <option value="submitted_asc">📤 送信日（古い順）</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[var(--color-text-sub)]">
            {filtered.length} / {items.length} 件
          </span>
          {/* 売上/外注支払の分割は管理者(西野)専用の見方。一般ユーザーには総合計だけ出す */}
          {me?.admin && (
            <>
              <span className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-sm font-bold text-white shadow-md">
                📈 西野の売上 <span className="font-mono tabular-nums">¥{filteredTotals.ownSales.toLocaleString()}</span>
              </span>
              <span className="rounded-lg bg-gradient-to-r from-rose-500 to-red-500 px-3 py-1.5 text-sm font-bold text-white shadow-md">
                📤 外注への支払 <span className="font-mono tabular-nums">¥{filteredTotals.subcontractPayment.toLocaleString()}</span>
              </span>
            </>
          )}
          <span className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-sm font-bold text-white shadow-md">
            💰 合計 <span className="font-mono tabular-nums">¥{filteredTotal.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : filtered.length === 0 && visibleMerged.length === 0 && issuedRows.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">該当する申請がありません</div>
      ) : (
        <>
        <div className="glass overflow-x-auto rounded-xl shadow-md">
          <table className="w-full min-w-[900px] text-xs">
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
              {/* 保存済 統合 PDF (issued_invoice_pdfs) を最上部に表示。filterMonth/filterKind/filterUserKeys/filterText も適用 */}
              {issuedPdfs
                .filter((p) => {
                  if (!filterMonth) return true
                  const ym = `${p.year}-${String(p.month).padStart(2, '0')}`
                  return ym === filterMonth
                })
                .filter((p) => filterKind === 'all' || p.kind === filterKind)
                .filter((p) => {
                  if (filterUserKeys.length === 0) return true
                  const names = (p.source_user_names ?? []).filter(Boolean) as string[]
                  return filterUserKeys.some((key) => {
                    if (key.startsWith('id:')) return p.user_id === Number(key.substring(3))
                    if (key.startsWith('combo:')) {
                      const target = key.substring(6).split(' + ')
                      return target.every((n) => names.includes(n))
                    }
                    return false
                  })
                })
                .filter((p) => {
                  if (!filterText) return true
                  const hay = `${p.filename} ${p.purchase_order_no ?? ''} ${(p.source_user_names ?? []).join(' ')}`
                  return hay.toLowerCase().includes(filterText.toLowerCase())
                })
                .map((p) => {
                // source_user_names (バックエンド計算済) を優先、無ければ items から推定、最後は user_display_name
                const fromBackend = (p.source_user_names ?? []).filter(Boolean)
                const fromItems = p.source_submission_ids.map((id) => items.find((s) => s.id === id)?.user_display_name).filter(Boolean) as string[]
                const names = fromBackend.length > 0 ? fromBackend : fromItems
                const usersStr = Array.from(new Set(names)).join(' + ') || (p.user_display_name ?? '—')
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
                    <td className="px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">統合</span>
                        {p.freee_deal_id ? (
                          <span title={`freee deal_id=${p.freee_deal_id}`} className="rounded bg-sky-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">🟦 freee 計上済</span>
                        ) : p.kind === 'invoice' && (
                          <button
                            onClick={() => reportIssuedToFreee(p)}
                            className="rounded bg-gradient-to-r from-sky-500 to-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                            title="freee に売上として計上"
                          >🟦 freee 計上</button>
                        )}
                      </div>
                    </td>
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
              {visibleMerged.map((m) => {
                const previewBusy = mergeBusy === `${m.key}-preview`
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
                      {me?.admin && m.kind === 'merged_invoice' && (
                        <button onClick={() => setMergedApplicationDate(m)}
                          className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="申請日(PDF左上)を変更">
                          📅 申請日
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
                      <button onClick={() => { if (confirm('この集約行を一覧から非表示にしますか？（個別行と保存済PDFは残ります。再表示は localStorage クリア）')) dismissMergedRow(m.key) }}
                        className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-300" title="この集約行を一覧から非表示にする (DB のデータは消えません)">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {issuedRows.map((p) => (
                <tr key={`issued-${p.id}`} className="border-t border-indigo-200 bg-indigo-50/40">
                  {me?.admin && <td className="px-1 py-2 text-center" />}
                  <td className="px-2 py-2 font-mono">{p.year}/{String(p.month ?? 0).padStart(2, '0')}</td>
                  <td className="px-2 py-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-700">
                      📄 発行済 {p.kind === 'expense' ? '立替金' : '請求書'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-text-sub)]">{CATEGORY_LABELS[p.category ?? ''] ?? p.category}</td>
                  <td className="px-2 py-2 font-semibold text-indigo-700">{(p.source_user_names ?? [p.user_display_name]).filter(Boolean).join(' + ')}</td>
                  <td className="px-2 py-2 font-mono text-xs">{p.purchase_order_no ?? '—'}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">¥{(p.total_amount ?? 0).toLocaleString()}</td>
                  <td className="px-2 py-2 text-center"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">発行済</span></td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)] break-all">{p.filename}</td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex gap-1 justify-center flex-wrap">
                      <button onClick={() => previewIssuedPdf(p)} className="rounded border border-sky-400 bg-white px-1.5 py-0.5 text-[10px] text-sky-600 hover:bg-sky-50" title="発行済みPDFを確認">🔍</button>
                      <button onClick={() => downloadIssuedPdf(p)} className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow" title="ダウンロード">📥</button>
                      {me?.admin && p.kind === 'invoice' && (
                        <button onClick={() => regenerateIssued(p)} className="rounded border border-fuchsia-400 bg-white px-1.5 py-0.5 text-[10px] text-fuchsia-600 hover:bg-fuchsia-50" title="申請日を変更してPDFを再生成">📅 申請日</button>
                      )}
                      {me?.admin && (
                        <button onClick={() => removeIssuedPdf(p.id, p.filename)} className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-300" title="発行済みPDFを削除">🗑</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => {
                const rowKey = `${s.kind}-${s.id}`
                const busyPdf = busyId === rowKey
                const busyXlsx = busyId === `${rowKey}-xlsx`
                const isApproved = s.status === 'approved'
                return (
                <tr key={rowKey} className="border-t border-[var(--color-border)]">
                  {me?.admin && (
                    <td className="px-1 py-2 text-center">
                      {(s.status === 'approved' || s.status === 'draft') && (
                        <input type="checkbox" checked={checkedIds.has(rowKey)} onChange={() => toggleCheck(s)} />
                      )}
                    </td>
                  )}
                  <td className="px-2 py-2 font-mono">{s.year}/{String(s.month).padStart(2, '0')}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      s.kind === 'scanned' ? 'bg-fuchsia-100 text-fuchsia-700' :
                      s.kind === 'invoice' ? 'bg-sky-100 text-sky-700' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {s.kind === 'scanned' ? '📥 PDF取込' : KIND_LABELS[s.kind]}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--color-text-sub)]">{CATEGORY_LABELS[s.category] ?? s.category}</td>
                  <td className="px-2 py-2 font-semibold whitespace-nowrap">{s.user_display_name}</td>
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
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[s.status]}`}>
                        {s.status === 'draft' ? '下書き' : s.status === 'pending' ? '申請中' : s.status === 'approved' ? '承認済' : '却下'}
                      </span>
                      {s.paid_at && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" title={`振込日: ${new Date(s.paid_at).toLocaleDateString('ja-JP')}`}>
                          💰 振込済
                          {me?.admin && (
                            <button
                              onClick={() => unsetPaid(s)}
                              className="ml-0.5 rounded-full bg-white/20 hover:bg-white/40 px-1 leading-none"
                              title="振込済を取消"
                            >×</button>
                          )}
                        </span>
                      )}
                      {s.freee_deal_id ? (
                        <span title={`freee deal_id=${s.freee_deal_id}`} className="rounded bg-sky-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          🟦 freee 計上済
                        </span>
                      ) : (
                        s.kind === 'invoice' && s.status === 'approved' && (
                          <button
                            onClick={() => reportInvoiceToFreee(s)}
                            className="rounded bg-gradient-to-r from-sky-500 to-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                            title="freee に売上として計上"
                          >
                            🟦 freee 計上
                          </button>
                        )
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)] whitespace-nowrap">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleString('ja-JP') : '—'}
                  </td>
                  <td className="px-2 py-2 text-center whitespace-nowrap">
                    {s.kind === 'scanned' && s.scanned_source ? (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setScannedDetail(s.scanned_source!)}
                          className="rounded bg-indigo-500 px-2 py-1 text-[10px] font-semibold text-white shadow hover:bg-indigo-600"
                          title="OCR 結果を確認"
                        >
                          🔍 確認
                        </button>
                        {!s.freee_deal_id && (
                          <button
                            onClick={() => reportScannedToFreee(s.id)}
                            disabled={!s.scanned_source.total_amount || !s.scanned_source.due_date}
                            className="rounded bg-gradient-to-r from-sky-500 to-blue-500 px-2 py-1 text-[10px] font-semibold text-white shadow disabled:opacity-50"
                            title="freee に売上として計上"
                          >
                            🟦 freee 計上
                          </button>
                        )}
                        <button onClick={() => removeScanned(s.id)} className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-500 hover:bg-red-50">削除</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                      {s.status === 'draft' && (me?.admin || me?.id === s.user_id) && (
                        <button onClick={() => submitOne(s)}
                          className="rounded bg-gradient-to-r from-sky-500 to-indigo-500 px-2 py-1 text-[10px] font-semibold text-white shadow"
                          title="この下書きを申請（承認フローへ）">📤 申請</button>
                      )}
                      {s.status === 'pending' && me?.admin && (
                        <>
                          <button onClick={() => approveOne(s)} disabled={approveBusyId === s.id}
                            className="rounded bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-1 text-[10px] font-semibold text-white shadow disabled:opacity-50"
                            title="この申請を承認">✅ 承認</button>
                          <button onClick={() => rejectOne(s)} disabled={approveBusyId === s.id}
                            className="rounded border border-red-300 px-2 py-1 text-[10px] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
                            title="この申請を却下">却下</button>
                        </>
                      )}
                      <RowActions
                        onView={() => openPreview(s)}
                        onEdit={(me?.admin || me?.id === s.user_id) ? () => openEdit(s) : undefined}
                        onDelete={(me?.admin || me?.id === s.user_id) ? () => removeSubmission(s) : undefined}
                        dlItems={[
                          { label: '📥 PDF（申請者ベース）', onClick: () => downloadInvoice(s, 'self'), disabled: busyPdf },
                          ...(s.kind === 'expense' ? [{ label: '📊 Excel（申請者ベース）', onClick: () => downloadExpenseXlsx(s, 'self'), disabled: busyXlsx }] : []),
                          ...((isApproved && me?.admin) ? [{ label: '🏢 ラボップ宛 PDF', onClick: () => downloadInvoice(s, 'labop'), disabled: busyPdf, variant: 'sky' as const }] : []),
                          ...((isApproved && me?.admin && s.kind === 'expense') ? [{ label: '🏢 ラボップ宛 Excel', onClick: () => downloadExpenseXlsx(s, 'labop'), disabled: busyXlsx, variant: 'emerald' as const }] : []),
                        ]}
                      />
                      </div>
                    )}
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
          <div className="w-full max-w-5xl h-[85vh] rounded-xl bg-white p-3 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
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
            {previewSub.kind === 'expense' && (
              <div className="mb-2 flex gap-1">
                <button
                  onClick={() => setPreviewMode('pdf')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${previewMode === 'pdf' ? 'bg-sky-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}
                >📄 PDF</button>
                <button
                  onClick={() => { setPreviewMode('xlsx'); loadPreviewXlsx(previewSub) }}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${previewMode === 'xlsx' ? 'bg-emerald-500 text-white' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}
                >📊 Excel</button>
              </div>
            )}
            <div className="flex-1 min-h-0 rounded border border-[var(--color-border)] overflow-hidden">
              {previewMode === 'pdf' && (
                <>
                  {previewLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">読込中…</div>}
                  {!previewLoading && previewUrl && <iframe src={previewUrl} className="w-full h-full" title="preview" />}
                  {!previewLoading && !previewUrl && <div className="h-full flex items-center justify-center text-sm text-red-500">取得できませんでした</div>}
                </>
              )}
              {previewMode === 'xlsx' && (
                <div className="h-full flex flex-col">
                  {previewXlsxLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">Excel 読込中…</div>}
                  {!previewXlsxLoading && previewXlsx && previewXlsx.sheets.length > 0 && (
                    <>
                      {previewXlsx.sheets.length > 1 && (
                        <div className="flex gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-gray-50">
                          {previewXlsx.sheets.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => setPreviewXlsxSheetIdx(i)}
                              className={`rounded px-2 py-0.5 text-[11px] ${i === previewXlsxSheetIdx ? 'bg-emerald-500 text-white font-semibold' : 'bg-white border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}
                            >{s.name}</button>
                          ))}
                        </div>
                      )}
                      <div className="flex-1 min-h-0 overflow-auto">
                        <table className="text-[11px] border-collapse">
                          <tbody>
                            {previewXlsx.sheets[previewXlsxSheetIdx].rows.map((row, ri) => (
                              <tr key={ri}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="border border-gray-300 px-2 py-1 whitespace-nowrap font-mono">
                                    {cell === null || cell === undefined || cell === '' ? '' : String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {!previewXlsxLoading && !previewXlsx && (
                    <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">📊 Excel タブをクリックしてください</div>
                  )}
                </div>
              )}
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

      {/* 申請確認モーダル（confirm アラートの代わり。対象を確認してから申請） */}
      {submitRows && (
        <Modal onClose={() => !submitBusy && setSubmitRows(null)} size="lg" panelClassName="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">📤 申請の確認（{submitRows.length} 件）</div>
            <button onClick={() => !submitBusy && setSubmitRows(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
          </div>
          <div className="text-[11px] text-[var(--color-text-sub)]">下記を申請（承認フローへ提出）します。内容を確認してください。</div>
          <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-[10px] text-[var(--color-text-sub)]">
                <tr><th className="px-2 py-1 text-left">年月</th><th className="px-2 py-1 text-left">種別</th><th className="px-2 py-1 text-left">申請者</th><th className="px-2 py-1 text-right">金額(税込)</th></tr>
              </thead>
              <tbody>
                {submitRows.map((s) => (
                  <tr key={`${s.kind}-${s.id}`} className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1 font-mono">{s.year}/{String(s.month).padStart(2, '0')}</td>
                    <td className="px-2 py-1">{s.kind === 'invoice' ? '請求書' : '立替金'}</td>
                    <td className="px-2 py-1">{s.user_display_name}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{(s.total_override ?? s.default_total) != null ? `¥${(s.total_override ?? s.default_total)!.toLocaleString()}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 申請書PDFプレビュー（単体申請のとき） */}
          {submitRows.length === 1 ? (
            <div className="h-[60vh] rounded-md border border-[var(--color-border)] overflow-hidden bg-gray-50">
              {submitPdfLoading && <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-sub)]">PDF読込中…</div>}
              {!submitPdfLoading && submitPdfUrl && <iframe src={submitPdfUrl} className="w-full h-full" title="申請書PDF" />}
              {!submitPdfLoading && !submitPdfUrl && <div className="h-full flex items-center justify-center text-sm text-red-500">PDFを取得できませんでした</div>}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-sub)]">複数申請のためPDFプレビューは省略します（各行は一覧の「確認」から表示できます）。</div>
          )}
          <div className="flex justify-end gap-2 border-t pt-2">
            <button onClick={() => setSubmitRows(null)} disabled={submitBusy} className="rounded-md border bg-white px-3 py-1.5 text-xs disabled:opacity-50">キャンセル</button>
            <button onClick={confirmSubmit} disabled={submitBusy}
              className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {submitBusy ? '申請中…' : `📤 ${submitRows.length} 件を申請する`}
            </button>
          </div>
        </Modal>
      )}

      {/* 新規申請モーダル */}
      {creating && me && (
        <Modal onClose={() => setCreating(false)} size="md" panelClassName="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">＋ 請求書/立替金 {me.admin ? '申請を新規作成' : 'を申請'}</div>
              <button onClick={() => setCreating(false)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="space-y-2">
              {me.admin ? (
                <LabeledField label="申請者ユーザー（受注者）">
                  <select value={createForm.target_user_id} onChange={(e) => setCreateForm({ ...createForm, target_user_id: e.target.value === '' ? '' : Number(e.target.value) })} className={fieldInputCls}>
                    <option value="">— 自分（{me?.display_name ?? '管理者'}） —</option>
                    {pickableUsers.filter((u) => !u.admin).map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                  </select>
                </LabeledField>
              ) : (
                <div className="text-[11px] text-[var(--color-text-sub)]">申請者: {me.display_name ?? '自分'}（作成後は「下書き」。一覧から「📤 申請」すると承認待ちになります）</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <LabeledField label="年">
                  <input type="number" value={createForm.year} onChange={(e) => setCreateForm({ ...createForm, year: Number(e.target.value) })} className={fieldInputCls} />
                </LabeledField>
                <LabeledField label="月">
                  <input type="number" min={1} max={12} value={createForm.month} onChange={(e) => setCreateForm({ ...createForm, month: Number(e.target.value) })} className={fieldInputCls} />
                </LabeledField>
                <LabeledField label="カテゴリ">
                  <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} className={fieldInputCls}>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </LabeledField>
                <LabeledField label="種別">
                  <select value={createForm.kind} onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value as 'invoice' | 'expense' })} className={fieldInputCls}>
                    <option value="invoice">請求書</option>
                    <option value="expense">立替金</option>
                  </select>
                </LabeledField>
              </div>
              <LabeledField label="対応する注文書（請求書のみ）">
                <select value={createForm.received_purchase_order_id} onChange={(e) => setCreateForm({ ...createForm, received_purchase_order_id: e.target.value === '' ? '' : Number(e.target.value) })} className={fieldInputCls}>
                  <option value="">— 紐付けなし —</option>
                  {pos.map((po) => <option key={po.id} value={po.id}>{po.order_no}{po.subject ? ` / ${po.subject.slice(0, 30)}` : ''}</option>)}
                </select>
              </LabeledField>
              <LabeledField label="備考（注文番号等）">
                <textarea value={createForm.note} onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })} rows={2} className={fieldInputCls} />
              </LabeledField>
              <LabeledField label={`振込先（口座）— ${me.admin && createForm.target_user_id ? 'この申請者' : '自分'}の口座。請求書PDFの「お振込先」に出ます`}>
                <textarea value={createBank} onChange={(e) => setCreateBank(e.target.value)} rows={2}
                  placeholder="例: ○○銀行 △△支店 普通 1234567 ﾀﾅｶ ﾀﾛｳ" className={fieldInputCls} />
              </LabeledField>
              <LabeledField label="郵便番号" hint="7桁を入れて「検索」で住所が途中まで自動入力されます">
                <div className="flex gap-1">
                  <input value={createPostal} onChange={(e) => setCreatePostal(e.target.value)}
                    placeholder="例) 270-2203" className={fieldInputCls} />
                  <button type="button"
                    onClick={async () => { const a = await fetchAddressByPostal(createPostal); if (a) setCreateAddress((prev) => prev.startsWith(a) ? prev : a); else alert('住所が見つかりませんでした（7桁の郵便番号を確認）') }}
                    className="whitespace-nowrap rounded-md border border-[var(--color-border)] bg-white px-3 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">🔍 検索</button>
                </div>
              </LabeledField>
              <div className="grid grid-cols-2 gap-2">
                <LabeledField label="住所" hint="請求書設定にも保存され、以後の既定になります">
                  <input value={createAddress} onChange={(e) => setCreateAddress(e.target.value)}
                    placeholder="例) 〇〇県〇〇市〇〇1-2-3" className={fieldInputCls} />
                </LabeledField>
                <LabeledField label="電話番号" hint="請求書設定にも保存されます">
                  <input value={createTel} onChange={(e) => setCreateTel(e.target.value)}
                    placeholder="例) 090-0000-0000" className={fieldInputCls} />
                </LabeledField>
              </div>
              <LabeledField label="インボイス番号（適格請求書発行事業者登録番号）">
                <input value={createRegNo} onChange={(e) => setCreateRegNo(e.target.value)} placeholder="例: T1234567890123" className={fieldInputCls} />
              </LabeledField>
              <div className="grid grid-cols-2 gap-2">
                <LabeledField label="申請日（請求書の発行日。空欄なら申請時の日付）">
                  <input type="date" value={createAppDate} onChange={(e) => setCreateAppDate(e.target.value)} className={fieldInputCls} />
                </LabeledField>
                <LabeledField label="支払期限（空欄なら設定の支払条件で自動計算）">
                  <input type="date" value={createDueDate} onChange={(e) => setCreateDueDate(e.target.value)} className={fieldInputCls} />
                </LabeledField>
              </div>

              {createForm.kind === 'invoice' && (
                <div className="rounded-md border border-[var(--color-border)] bg-sky-50/40 p-2 space-y-1.5">
                  <div className="text-[11px] font-semibold text-sky-700">明細を手入力（任意）— 入れた場合はこの内容で請求書を作成（業務報告に依存しない）</div>
                  <LabeledField label="件名（任意）">
                    <input value={createSubject} onChange={(e) => setCreateSubject(e.target.value)} placeholder="例: システム開発支援業務" className={fieldInputCls} />
                  </LabeledField>
                  <InvoiceItemsEditor items={createItems} category={createForm.category}
                    onUpdate={updateCreateItem} onAdd={addCreateItem} onRemove={removeCreateItem} />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button onClick={() => setCreating(false)} className="rounded-md border bg-white px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={submitCreate}
                className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
                💾 作成のみ（下書き保存）
              </button>
            </div>
        </Modal>
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

      {paymentNoticeOpen && (
        <Modal onClose={closePaymentNotice} size="md" panelClassName="space-y-3">
          <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">💰 振込通知メール送信（支払通知）</div>
                <div className="text-[11px] text-[var(--color-text-sub)]">選択した {checkedSubmissionIds.length} 件を振込済としてマークし、宛先に通知メールを送信します</div>
              </div>
              <button onClick={closePaymentNotice} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="text-[11px] font-semibold mb-0.5">振込日</div>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
              </label>
              <label className="block">
                <div className="text-[11px] font-semibold mb-0.5">宛先 (To)</div>
                <input type="email" value={paymentTo} onChange={(e) => setPaymentTo(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
              </label>
              <label className="block col-span-2">
                <div className="text-[11px] font-semibold mb-0.5">宛名 (任意)</div>
                <input type="text" value={paymentRecipient} onChange={(e) => setPaymentRecipient(e.target.value)}
                  placeholder="例: 川村 卓也"
                  className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
              </label>
            </div>
            <div className="flex justify-end">
              <button onClick={draftPaymentNotice} disabled={paymentDrafting || checkedSubmissionIds.length === 0}
                className="rounded-md bg-gradient-to-r from-sky-500 to-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                {paymentDrafting ? '生成中…' : '✏️ 件名・本文を下書き生成'}
              </button>
            </div>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">件名</div>
              <input type="text" value={paymentSubject} onChange={(e) => setPaymentSubject(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">本文</div>
              <textarea value={paymentBody} onChange={(e) => setPaymentBody(e.target.value)} rows={14}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-mono" />
            </label>
            {paymentMsg && <div className={`text-[11px] ${paymentMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>{paymentMsg}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <button onClick={closePaymentNotice} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={sendPaymentNotice} disabled={paymentSending}
                className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
                {paymentSending ? '送信中…' : '📧 振込済にする + メール送信'}
              </button>
            </div>
        </Modal>
      )}

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
        <Modal onClose={closeEdit} size="md" panelClassName="space-y-2">
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
            <LabeledField label="申請日" hint="請求書PDF・一覧に表示される申請日を変更します">
              <input type="date" value={editForm.application_date}
                onChange={(e) => setEditForm({ ...editForm, application_date: e.target.value })}
                className={fieldInputCls} />
            </LabeledField>
            <LabeledField label="支払期限" hint="請求書PDFの支払期限。空欄なら請求設定（支払条件）から自動計算されます">
              <input type="date" value={editForm.due_date}
                onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                className={fieldInputCls} />
            </LabeledField>
            <LabeledField label="インボイス番号（登録番号）" hint="空欄なら請求設定の登録番号を使用">
              <input value={editForm.registration_no}
                onChange={(e) => setEditForm({ ...editForm, registration_no: e.target.value })}
                placeholder="例: T1234567890123" className={fieldInputCls} />
            </LabeledField>
            <LabeledField label="振込先（お振込先）" hint="この請求書に反映し、請求書設定にも連動保存されます">
              <textarea value={editForm.bank_info} rows={2}
                onChange={(e) => setEditForm({ ...editForm, bank_info: e.target.value })}
                placeholder="例: 〇〇銀行 〇〇支店 普通 0000000 口座名義" className={fieldInputCls} />
            </LabeledField>
            <LabeledField label="郵便番号" hint="7桁を入れて「検索」で住所が途中まで自動入力されます">
              <div className="flex gap-1">
                <input value={editForm.postal} onChange={(e) => setEditForm({ ...editForm, postal: e.target.value })}
                  placeholder="例) 270-2203" className={fieldInputCls} />
                <button type="button"
                  onClick={async () => { const a = await fetchAddressByPostal(editForm.postal); if (a) setEditForm((prev) => ({ ...prev, address: prev.address.startsWith(a) ? prev.address : a })); else alert('住所が見つかりませんでした（7桁の郵便番号を確認）') }}
                  className="whitespace-nowrap rounded-md border border-[var(--color-border)] bg-white px-3 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">🔍 検索</button>
              </div>
            </LabeledField>
            <div className="grid grid-cols-2 gap-2">
              <LabeledField label="住所" hint="請求書設定に連動保存されます">
                <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  placeholder="例) 〇〇県〇〇市〇〇1-2-3" className={fieldInputCls} />
              </LabeledField>
              <LabeledField label="電話番号" hint="請求書設定に連動保存されます">
                <input value={editForm.tel} onChange={(e) => setEditForm({ ...editForm, tel: e.target.value })}
                  placeholder="例) 090-0000-0000" className={fieldInputCls} />
              </LabeledField>
            </div>
            <LabeledField label="注文番号（PDF 備考の先頭に「注文番号: XXX」として出力）">
              <input value={editForm.purchase_order_no_override}
                onChange={(e) => setEditForm({ ...editForm, purchase_order_no_override: e.target.value })}
                className={`${fieldInputCls} font-mono`}
                placeholder="ORD-010014" />
              {editingSub.received_purchase_order_no && (
                <div className="text-[10px] text-[var(--color-text-sub)] mt-0.5">
                  PO 連携: <span className="font-mono">{editingSub.received_purchase_order_no}</span>（空欄ならこちらが使われます）
                </div>
              )}
            </LabeledField>
            <LabeledField label="備考（補足メモのみ。注文番号は上の欄）">
              <textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                rows={3} className={fieldInputCls}
                placeholder="例) 〇〇案件" />
            </LabeledField>
            {editingSub.kind === 'invoice' && (
            <LabeledField label="件名">
              <input value={editForm.subject_override} onChange={(e) => setEditForm({ ...editForm, subject_override: e.target.value })}
                className={fieldInputCls} />
            </LabeledField>
            )}
            {editingSub.kind === 'expense' && (
              <ExpenseEditList submissionUserId={editingSub.user_id} year={editingSub.year} month={editingSub.month} category={editingSub.category} />
            )}
            {editingSub.kind === 'invoice' && (
              <div className="block">
                <div className="text-[11px] font-semibold mb-1">品番・品名 / 明細</div>
                <InvoiceItemsEditor items={editForm.items} category={editingSub.category}
                  onUpdate={updateEditItem} onAdd={addEditItem} onRemove={removeEditItem} />
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
        </Modal>
      )}

      {scannedDetail && (
        <Modal onClose={() => setScannedDetail(null)} size="lg" panelClassName="space-y-3">
          <div className="text-sm font-semibold text-[var(--color-text)]">📥 取込請求書 確認 — {scannedDetail.original_filename ?? `id=${scannedDetail.id}`}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="md:col-span-1">
              {scannedDetail.has_pdf ? (
                scannedPdfUrl ? (
                  <iframe src={scannedPdfUrl} className="w-full h-[600px] rounded border border-[var(--color-border)]" title="PDF preview" />
                ) : (
                  <div className="flex h-[600px] items-center justify-center rounded border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-sub)]">PDF を読み込んでいます…</div>
                )
              ) : (
                <div className="flex h-[600px] flex-col items-center justify-center rounded border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-sub)]">
                  <div>この請求書は PDF プレビュー未対応</div>
                  <div className="mt-1 text-[10px]">（PDF 保存機能リリース前に取り込まれた）</div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">取引先</div>
                <div className="font-semibold">{scannedDetail.partner_name ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">請求書番号</div>
                <div className="font-mono">{scannedDetail.invoice_number ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">発行日</div>
                <div>{scannedDetail.issue_date ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">支払期限</div>
                <div>{scannedDetail.due_date ?? '—'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] text-[var(--color-text-sub)]">件名</div>
                <div>{scannedDetail.subject ?? '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">小計 (税抜)</div>
                <div className="font-mono tabular-nums">¥{(scannedDetail.subtotal_amount ?? 0).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--color-text-sub)]">消費税</div>
                <div className="font-mono tabular-nums">¥{(scannedDetail.tax_amount ?? 0).toLocaleString()}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] text-[var(--color-text-sub)]">合計 (税込)</div>
                <div className="font-mono tabular-nums text-lg font-bold">¥{(scannedDetail.total_amount ?? 0).toLocaleString()}</div>
              </div>
              {scannedDetail.freee_deal_id && (
                <div className="col-span-2 rounded bg-sky-50 px-3 py-2 text-xs">
                  🟦 freee 計上済 — deal_id: <span className="font-mono">{scannedDetail.freee_deal_id}</span>
                  {scannedDetail.freee_reported_at && <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">{new Date(scannedDetail.freee_reported_at).toLocaleString('ja-JP')}</span>}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
