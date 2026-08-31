import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me, PickableUser, IssuedPurchaseOrderSetting } from '../lib/api'
import { buildDeliveryDeadline } from '../lib/purchaseOrderPeriod'
import { openPdfWindow, showPdf } from '../lib/openPdf'
import Modal from '../components/Modal'
import RowActions from '../components/RowActions'
import PurchaseOrderBulkMailModal from '../components/PurchaseOrderBulkMailModal'

// 注文書の期間が「締日(25) ベース」の月次サイクルでいくつ含まれるかを返す。
// 例: 2026-02-26 〜 2026-05-25 (closing=25) → 2026-03 / 2026-04 / 2026-05 の 3 サイクル
const CLOSING_DAY = 25
const cycleMonthFor = (iso: string): { year: number; month: number } => {
  const d = new Date(iso)
  // 26日以降は翌月分の請求月扱い、25日以前は当月扱い
  if (d.getDate() <= CLOSING_DAY) {
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
}
const cyclesInPeriod = (start: string | null, end: string | null): { year: number; month: number }[] => {
  if (!start || !end) return []
  const s = cycleMonthFor(start)
  const e = cycleMonthFor(end)
  const out: { year: number; month: number }[] = []
  let y = s.year, m = s.month
  let safety = 60
  while (safety-- > 0 && (y < e.year || (y === e.year && m <= e.month))) {
    out.push({ year: y, month: m })
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

type PO = {
  id: number
  user_id: number
  user_display_name: string | null
  order_no: string
  customer_name: string | null
  category: string | null
  subject: string | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  note: string | null
  file_url: string | null
  filename?: string | null
  has_pdf?: boolean
  ai_extracted_at?: string | null
  invoice_submission_count: number
  // 注文書の種別。
  // 'received' = ラボップから受け取った PDF
  // 'issued'   = 西野→川村等の発注書 (purchase_order_settings = /attendance で編集中のものと同一)
  kind?: 'received' | 'issued'
  recipient_name?: string | null              // issued: 受注者氏名 (PDF 表示用)
  recipient_user_id?: number | null           // issued: 受注者ユーザー (川村など)
  recipient_user_display_name?: string | null // issued: 受注者ユーザーの display_name
  issuer_user_display_name?: string | null    // issued: 発注者ユーザー (西野)
  issued_at?: string | null                   // 発行日時
  issuer_company?: string | null              // issued の発注者 (自社名)
  template_position?: number | null
  template_base_monthly?: number | null
  template_hours_per_cycle?: number | null
  template_rate_per_hour?: number | null
  template_remarks?: string | null
  freee_deal_id?: string | null
  freee_reported_at?: string | null
}


type ExtractResult = {
  order_no?: string | null
  customer_name?: string | null
  subject?: string | null
  period_start?: string | null
  period_end?: string | null
  total_amount?: number | null
  contractor_name?: string | null
  raw_text?: string | null
  error?: string | null
}


const CATEGORY_LABELS: Record<string, string> = {
  wings: 'Wings (タマ)',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

export default function PurchaseOrdersPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<PO[]>([])
  const [users, setUsers] = useState<PickableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<PO> | null>(null)
  const [viewing, setViewing] = useState<PO | null>(null)
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)
  const [extractRawText, setExtractRawText] = useState<string>('')
  const [dropping, setDropping] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const isAdmin = !!me?.admin

  // 月フィルター: null=全期間 (デフォルト)、{year, month}=該当の請求月だけ表示し、注文書の総額を該当月分(=total/cycles)に按分
  const [filterYear, setFilterYear] = useState<number | null>(null)
  const [filterMonth, setFilterMonth] = useState<number | null>(null)

  // 一括メール送信用: 選択された行 (key=`${kind}-${id}`)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const [bulkMailOpen, setBulkMailOpen] = useState(false)
  const toggleCheck = (po: PO) => setCheckedKeys((prev) => {
    const k = `${po.kind}-${po.id}`
    const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next
  })

  // カラム別フィルター (空文字 = 絞り込みなし)
  type FilterKey = 'order_no' | 'recipient' | 'issuer' | 'subject' | 'period'
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ order_no: '', recipient: '', issuer: '', subject: '', period: '' })
  const setFilter = (key: FilterKey, v: string) => setFilters((prev) => ({ ...prev, [key]: v }))

  // カラム別ソート
  type SortKey = 'order_no' | 'recipient' | 'issuer' | 'subject' | 'period_start' | 'total_amount'
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      // 同じカラム再クリック: asc → desc → 解除 のサイクル
      if (sortAsc) setSortAsc(false)
      else { setSortKey(null); setSortAsc(true) }
    } else {
      setSortKey(key); setSortAsc(true)
    }
  }
  const sortMark = (key: SortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  const recipientLabel = (p: PO) =>
    p.kind === 'received' ? (p.user_display_name ?? '') : (p.recipient_user_display_name ?? p.recipient_name ?? '')
  const issuerLabel = (p: PO) =>
    p.kind === 'received' ? (p.customer_name ?? '') : (p.issuer_user_display_name ?? p.issuer_company ?? me?.display_name ?? '')

  const reportIssuedPoToFreee = async (po: PO) => {
    if (po.kind !== 'issued') return
    if (!po.total_amount) { alert('金額が未設定のため計上できません'); return }
    if (!confirm(`「${po.subject ?? po.category}」(受注者: ${po.recipient_user_display_name ?? po.recipient_name}) を freee に経費計上しますか？\n金額: ¥${po.total_amount.toLocaleString()}`)) return
    try {
      const { data } = await api.post(`/purchase_order_settings/${po.id}/report_to_freee`)
      alert(`✅ ${data.message ?? 'freee 経費計上完了'} (deal_id=${data.deal_id})`)
      await load()
    } catch (e: any) {
      alert(`❌ ${e?.response?.data?.error ?? '計上失敗'}`)
    }
  }
  const isFilterActive = filterYear != null && filterMonth != null

  // 各 PO の「該当月分の金額」を返す。フィルター非活性なら full total。
  const monthlyAmountFor = (po: PO): number => {
    if (!isFilterActive) return po.total_amount ?? 0
    if (po.total_amount == null) return 0
    const cycles = cyclesInPeriod(po.period_start, po.period_end)
    if (cycles.length === 0) return po.total_amount  // 期間不明: 全額カウント
    const matched = cycles.some((c) => c.year === filterYear && c.month === filterMonth)
    return matched ? Math.round(po.total_amount / cycles.length) : 0
  }

  // フィルター候補: 受注者・発注者・案件名 は items から重複排除して select 用に
  const recipientOptions = useMemo(() => Array.from(new Set(items.map(recipientLabel).filter(Boolean))).sort(), [items])
  const issuerOptions    = useMemo(() => Array.from(new Set(items.map(issuerLabel).filter(Boolean))).sort(), [items])
  const subjectOptions   = useMemo(() => Array.from(new Set(items.map((p) => p.subject).filter((s): s is string => !!s))).sort(), [items])

  // 月フィルター + カラム別フィルター + ソート
  const filteredItems = useMemo(() => {
    let arr = items
    // 月フィルター
    if (isFilterActive) {
      arr = arr.filter((p) => {
        const cycles = cyclesInPeriod(p.period_start, p.period_end)
        if (cycles.length === 0) return true
        return cycles.some((c) => c.year === filterYear && c.month === filterMonth)
      })
    }
    // カラムフィルター
    // - order_no: テキスト部分一致
    // - recipient / issuer / subject: select 完全一致 (空文字 = 全部)
    // - period: 日付ピッカー、その日付を period_start..period_end が含む行のみ
    const textMatch = (haystack: string | null | undefined, needle: string) =>
      !needle || (haystack ?? '').toString().toLowerCase().includes(needle.toLowerCase())
    const exactMatch = (haystack: string, needle: string) => !needle || haystack === needle
    const dateMatch = (start: string | null, end: string | null, needle: string) => {
      if (!needle) return true
      if (!start || !end) return false
      return needle >= start && needle <= end
    }
    arr = arr.filter((p) =>
      textMatch(p.order_no, filters.order_no) &&
      exactMatch(recipientLabel(p), filters.recipient) &&
      exactMatch(issuerLabel(p), filters.issuer) &&
      exactMatch(p.subject ?? '', filters.subject) &&
      dateMatch(p.period_start, p.period_end, filters.period)
    )
    // ソート
    if (sortKey) {
      const dir = sortAsc ? 1 : -1
      const cmp = (a: PO, b: PO): number => {
        const get = (p: PO): string | number => {
          switch (sortKey) {
            case 'order_no':     return p.order_no ?? ''
            case 'recipient':    return recipientLabel(p)
            case 'issuer':       return issuerLabel(p)
            case 'subject':      return p.subject ?? ''
            case 'period_start': return p.period_start ?? ''
            case 'total_amount': return p.total_amount ?? 0
          }
        }
        const va = get(a), vb = get(b)
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
        return String(va).localeCompare(String(vb), 'ja') * dir
      }
      arr = [...arr].sort(cmp)
    }
    return arr
  }, [items, filterYear, filterMonth, isFilterActive, filters, sortKey, sortAsc])

  const totalAmount = useMemo(
    () => filteredItems.reduce((acc, p) => acc + monthlyAmountFor(p), 0),
    [filteredItems, isFilterActive, filterYear, filterMonth]
  )

  // フィルター候補: 全 PO の期間から月リスト生成
  const monthOptions = useMemo(() => {
    const set = new Set<string>()
    items.forEach((p) => cyclesInPeriod(p.period_start, p.period_end).forEach((c) => set.add(`${c.year}-${String(c.month).padStart(2, '0')}`)))
    return Array.from(set).sort().reverse()
  }, [items])

  // PDF を Drop して AI 抽出 → 編集モーダルにプリフィル
  const onDropPdf = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      setMsg('PDF ファイルを落としてください'); return
    }
    setExtracting(true); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await api.post<ExtractResult>('/received_purchase_orders/extract', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const ex = r.data
      if (ex.error) { setMsg(`抽出失敗: ${ex.error}`); return }
      // 受注者推定: contractor_name が display_name の部分一致するユーザーがいれば紐付け
      const matchedUser = ex.contractor_name
        ? users.find((u) => u.display_name.includes(ex.contractor_name!.split(/[\s　]/)[0]))
        : null
      // カテゴリ推定: subject に「リビング」「Wings/Tama」が含まれるか
      const inferredCategory = (() => {
        const s = `${ex.subject ?? ''} ${ex.customer_name ?? ''}`
        if (s.includes('リビング')) return 'living'
        if (s.includes('テックリーダーズ')) return 'techleaders'
        if (s.includes('REシステムズ')) return 'resystems'
        return 'wings'
      })()
      setEditing({
        user_id: matchedUser?.id ?? me?.id,
        order_no: ex.order_no ?? '',
        customer_name: ex.customer_name ?? '',
        category: inferredCategory,
        subject: ex.subject ?? '',
        period_start: ex.period_start ?? '',
        period_end: ex.period_end ?? '',
        total_amount: ex.total_amount ?? null,
        note: '',
        file_url: '',
      })
      setPendingPdf(file)
      setExtractRawText(ex.raw_text ?? '')
      setMsg('🤖 AI 抽出完了。内容を確認して保存してください')
    } catch (e: any) {
      setMsg(`抽出失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setExtracting(false)
    }
  }

  const onDropEvent = (e: React.DragEvent) => {
    e.preventDefault(); setDropping(false)
    const file = e.dataTransfer.files[0]
    if (file) onDropPdf(file)
  }
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onDropPdf(file)
    e.target.value = ''
  }

  const load = async () => {
    setLoading(true)
    try {
      // ラボップから受領した PO (received_purchase_orders)
      // + 西野→川村への発注書 (purchase_order_settings = /attendance の注文書一覧と同じレコード)
      // を統合表示。表示は /attendance と完全連動 (同じ DB レコード)。
      const [recvRes, settingsRes] = await Promise.all([
        api.get<PO[]>('/received_purchase_orders'),
        api.get<IssuedPurchaseOrderSetting[]>('/purchase_order_settings').catch(() => ({ data: [] as IssuedPurchaseOrderSetting[] })),
      ])
      const received: PO[] = recvRes.data.map((r) => ({ ...r, kind: 'received' as const }))
      const issued: PO[] = (settingsRes.data ?? []).filter((s) => s.exists !== false).map((s) => ({
        id: s.id,
        user_id: s.issuer_user_id ?? 0,
        user_display_name: s.issuer_user_display_name,
        order_no: s.order_no ?? '—',
        customer_name: null,
        category: s.category,
        subject: s.subject || '(案件名未設定)',
        period_start: s.period_start,
        period_end: s.period_end,
        total_amount: s.total_amount ?? null,
        note: s.remarks ?? null,
        file_url: null, filename: null, has_pdf: false, ai_extracted_at: null,
        invoice_submission_count: 0,
        kind: 'issued' as const,
        recipient_name: s.recipient_name,
        recipient_user_id: s.recipient_user_id,
        recipient_user_display_name: s.recipient_user_display_name,
        issuer_user_display_name: s.issuer_user_display_name,
        issuer_company: s.issuer_company,
        issued_at: null,
        template_position: s.position ?? 0,
        template_base_monthly: s.base_monthly ?? null,
        template_hours_per_cycle: s.hours_per_cycle ?? null,
        template_rate_per_hour: s.rate_per_hour ?? null,
        template_remarks: s.remarks ?? null,
      }))
      setItems([...received, ...issued])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
    load().catch(() => {})
    api.get<PickableUser[]>('/users/pickable').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  const startNew = () => { setPendingPdf(null); setExtractRawText(''); setEditing({
    user_id: me?.id, order_no: '', customer_name: '', category: 'wings', subject: '',
    period_start: '', period_end: '', total_amount: null, note: '', file_url: '',
  }) }
  const startEdit = (po: PO) => { setPendingPdf(null); setExtractRawText(''); setEditing({ ...po }) }
  const cancel = () => { setEditing(null); setPendingPdf(null); setExtractRawText(''); setMsg(null) }

  const save = async () => {
    if (!editing) return
    setBusy(true); setMsg(null)
    try {
      if (!editing.order_no?.trim()) { setMsg('注文番号を入力してください'); return }
      // 発行PO (purchase_order_setting) は専用エンドポイントへ。
      // 編集モーダルで触れる: order_no / subject / period_start / period_end / 受注者(user_id)
      // recipient_user_id を変えたら recipient_name も連動させたいので users から名前を引く
      if (editing.kind === 'issued' && editing.id) {
        const recipientUser = users.find((u) => u.id === editing.user_id)
        await api.patch('/purchase_order_setting', {
          category: editing.category,
          position: editing.template_position ?? 0,
          recipient_user_id: editing.user_id ?? undefined,
          purchase_order_setting: {
            order_no: editing.order_no,
            subject: editing.subject ?? '',
            period_start: editing.period_start || null,
            period_end: editing.period_end || null,
            recipient_name: recipientUser?.display_name ?? editing.recipient_name ?? '',
            // 備考(remarks)は編集モーダルの「note」フィールドに対応
            remarks: editing.note ?? editing.template_remarks ?? '',
          },
        })
        setMsg('保存しました')
        setEditing(null); setPendingPdf(null); setExtractRawText('')
        await load()
        return
      }
      // 新規作成 + PDF Drop 経由 → /upload で multipart 送信
      if (!editing.id && pendingPdf) {
        const fd = new FormData()
        fd.append('file', pendingPdf)
        fd.append('order_no', editing.order_no ?? '')
        fd.append('customer_name', editing.customer_name ?? '')
        fd.append('category', editing.category ?? 'wings')
        fd.append('subject', editing.subject ?? '')
        if (editing.period_start) fd.append('period_start', editing.period_start)
        if (editing.period_end) fd.append('period_end', editing.period_end)
        if (editing.total_amount != null) fd.append('total_amount', String(editing.total_amount))
        fd.append('note', editing.note ?? '')
        fd.append('file_url', editing.file_url ?? '')
        if (editing.user_id) fd.append('user_id', String(editing.user_id))
        fd.append('ai_extracted', 'true')
        if (extractRawText) fd.append('ai_raw_text', extractRawText)
        await api.post('/received_purchase_orders/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } else {
        const payload = {
          order_no: editing.order_no,
          customer_name: editing.customer_name,
          category: editing.category,
          subject: editing.subject,
          period_start: editing.period_start || null,
          period_end: editing.period_end || null,
          total_amount: editing.total_amount,
          note: editing.note,
          file_url: editing.file_url,
          user_id: editing.user_id,
        }
        if (editing.id) {
          await api.patch(`/received_purchase_orders/${editing.id}`, payload)
        } else {
          await api.post('/received_purchase_orders', payload)
        }
      }
      setMsg('保存しました')
      setEditing(null); setPendingPdf(null); setExtractRawText('')
      await load()
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  const downloadPdf = async (po: PO) => {
    const pdfWindow = openPdfWindow()
    try {
      if (po.kind === 'issued') {
        // PurchaseOrderSetting からその場で payload を組み立てて /exports/purchase_order.pdf へ
        const r = await api.get<IssuedPurchaseOrderSetting>('/purchase_order_setting', { params: { category: po.category, position: po.template_position ?? 0 } })
        const s = r.data
        const total = s.total_amount ?? 0
        const subtotal = total > 0 ? Math.round(total / 1.1) : 0
        const payload = {
          order_no: 'ORD-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0'),
          subject: s.subject ?? '',
          tax_rate: 10,
          category: po.category ?? 'wings',
          period_start: s.period_start, period_end: s.period_end,
          delivery_deadline: buildDeliveryDeadline(s.period_start, s.period_end, s.closing_day ?? 25),
          delivery_location: s.delivery_location ?? '客先指定場所',
          payment_method: s.payment_method ?? '振込',
          remarks: s.remarks ?? '',
          recipient: { name: s.recipient_name ?? '', postal_code: '', address: '' },
          issuer: { company_name: s.issuer_company ?? '', representative: s.issuer_representative ?? '', postal_code: '', address: '' },
          items: s.items ?? [{ description: s.subject ?? '', qty: 1, unit: '式', unit_price: subtotal, amount: subtotal }],
        }
        const res = await api.post('/exports/purchase_order.pdf', payload, { responseType: 'blob' })
        showPdf(pdfWindow, res.data as Blob, `発注書_${po.subject ?? po.category}_${po.period_start ?? ''}.pdf`)
        return
      }
      const res = await api.get(`/received_purchase_orders/${po.id}/download`, { responseType: 'blob' })
      showPdf(pdfWindow, res.data as Blob, po.filename ?? `発注書_${po.order_no}.pdf`)
    } catch (e: any) {
      pdfWindow?.close()
      alert(`PDF DL 失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  const remove = async (po: PO) => {
    const label = po.kind === 'issued' ? `発行発注書「${po.subject ?? po.category}」` : po.order_no
    if (!confirm(`${label} を削除しますか？`)) return
    setBusy(true)
    try {
      if (po.kind === 'issued') {
        await api.delete('/purchase_order_setting', { params: { category: po.category, position: po.template_position ?? 0 } })
      } else {
        await api.delete(`/received_purchase_orders/${po.id}`)
      }
      await load()
    } catch (e: any) {
      alert(`削除失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">📋 注文書一覧</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            ラボップから受領した注文書を管理。請求書は注文書ごとに紐付けて発行
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--color-text-sub)]">
              {isFilterActive ? `${filteredItems.length} / ${items.length}` : items.length} 件
            </span>
            <span className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-sm font-bold text-white shadow-md">
              💰 {isFilterActive ? `${filterYear}年${filterMonth}月分` : '全期間'} 合計 <span className="font-mono tabular-nums">¥{totalAmount.toLocaleString()}</span>
            </span>
            <select
              value={isFilterActive ? `${filterYear}-${String(filterMonth).padStart(2, '0')}` : ''}
              onChange={(e) => {
                const v = e.target.value
                if (!v) { setFilterYear(null); setFilterMonth(null); return }
                const [y, m] = v.split('-').map(Number)
                setFilterYear(y); setFilterMonth(m)
              }}
              className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs"
              title="締日(25日) 基準の請求月で絞り込み。複数月にまたがる発注書は月数で按分した金額を合計に計上。"
            >
              <option value="">全期間</option>
              {monthOptions.map((mk) => {
                const [y, m] = mk.split('-').map(Number)
                return <option key={mk} value={mk}>{y}年{m}月分</option>
              })}
            </select>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {checkedKeys.size > 0 && (
              <button onClick={() => setBulkMailOpen(true)}
                className="rounded-md bg-gradient-to-r from-sky-500 to-cyan-500 px-3 py-1.5 text-xs font-semibold text-white shadow"
                title="選択した注文書を一括でメール送付">
                📧 一括送付 ({checkedKeys.size})
              </button>
            )}
            <button onClick={startNew}
              className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
              ＋ 新規追加
            </button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDropEvent}
          className={`rounded-xl border-2 border-dashed p-4 text-center transition ${
            dropping ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-gray-300 bg-gray-50'
          } ${extracting ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <div className="text-sm font-semibold text-[var(--color-text)]">
            {extracting ? '🤖 AI で読み取り中…' : '📎 ラボップから受領した発注書 PDF をここにドラッグ&ドロップ'}
          </div>
          <div className="text-[11px] text-[var(--color-text-sub)] mt-1">
            注文番号 / 案件名 / 期間 / 金額 / 受注者を AI が自動抽出。確認後に保存できます。
          </div>
          <label className="inline-block mt-2 cursor-pointer rounded-md bg-white border border-fuchsia-400 px-3 py-1.5 text-xs font-semibold text-fuchsia-600 hover:bg-fuchsia-50">
            またはファイルを選択
            <input type="file" accept="application/pdf" className="hidden" onChange={onPickFile} />
          </label>
        </div>
      )}

      {msg && <div className={`text-[11px] ${msg.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</div>}

      {editing && (
        <Modal onClose={cancel} size="md" panelClassName="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              {editing.id ? '📋 注文書を編集' : pendingPdf ? '📋 PDF から AI 抽出 → 内容確認' : '📋 注文書を新規追加'}
            </div>
            <button onClick={cancel} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
          </div>
          {pendingPdf && (
            <div className="rounded-md bg-fuchsia-50 border border-fuchsia-200 px-2 py-1.5 text-[11px] text-fuchsia-700">
              📎 添付予定: <span className="font-mono">{pendingPdf.name}</span>（保存と同時に DB に PDF バイナリが保管されます）
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">注文番号 *</div>
              <input value={editing.order_no ?? ''} onChange={(e) => setEditing({ ...editing, order_no: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="ORD-010014" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">案件名</div>
              <input value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="例) 〇〇案件" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">受注者</div>
              <select value={editing.user_id ?? me?.id ?? ''} onChange={(e) => setEditing({ ...editing, user_id: Number(e.target.value) })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
                {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">カテゴリ</div>
              <select value={editing.category ?? 'wings'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">顧客</div>
              <input value={editing.customer_name ?? ''} onChange={(e) => setEditing({ ...editing, customer_name: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="例) 〇〇株式会社" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">金額（税込）</div>
              <input type="number" value={editing.total_amount ?? ''}
                onChange={(e) => setEditing({ ...editing, total_amount: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">期間 開始</div>
              <input type="date" value={editing.period_start ?? ''} onChange={(e) => setEditing({ ...editing, period_start: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold mb-0.5">期間 終了</div>
              <input type="date" value={editing.period_end ?? ''} onChange={(e) => setEditing({ ...editing, period_end: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
            <label className="block col-span-2">
              <div className="text-[11px] font-semibold mb-0.5">注文書 PDF URL（Google Drive 等）</div>
              <input value={editing.file_url ?? ''} onChange={(e) => setEditing({ ...editing, file_url: e.target.value })}
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="https://drive.google.com/file/..." />
            </label>
            <label className="block col-span-2">
              <div className="text-[11px] font-semibold mb-0.5">備考（注文書の特記事項。例: ※シェアラウンジ回数券（押上5回分）支給）</div>
              <textarea value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                rows={2} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
            <button onClick={cancel} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">キャンセル</button>
            <button onClick={save} disabled={busy}
              className="rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy ? '保存中…' : '💾 保存'}
            </button>
          </div>
        </Modal>
      )}

      {viewing && (
        <Modal onClose={() => setViewing(null)} size="md" panelClassName="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                🔍 詳細
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  viewing.kind === 'issued' ? 'bg-sky-100 text-sky-700' : 'bg-fuchsia-100 text-fuchsia-700'
                }`}>
                  {viewing.kind === 'issued' ? '📤 発行履歴' : '📥 受領'}
                </span>
              </div>
              <button onClick={() => setViewing(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <dl className="grid grid-cols-3 gap-1 text-[12px]">
              <dt className="text-[var(--color-text-sub)]">注文番号</dt>
              <dd className="col-span-2 font-mono font-semibold">{viewing.order_no}</dd>
              <dt className="text-[var(--color-text-sub)]">案件名</dt>
              <dd className="col-span-2">{viewing.subject ?? '—'}</dd>
              <dt className="text-[var(--color-text-sub)]">受注者</dt>
              <dd className="col-span-2">{viewing.kind === 'received'
                ? (viewing.user_display_name ?? '—')
                : (viewing.recipient_user_display_name ?? viewing.recipient_name ?? '—')}</dd>
              {viewing.kind === 'issued' && (<>
                <dt className="text-[var(--color-text-sub)]">発注者</dt>
                <dd className="col-span-2">{viewing.issuer_user_display_name ?? '—'}</dd>
              </>)}
              {viewing.customer_name && (<><dt className="text-[var(--color-text-sub)]">顧客</dt><dd className="col-span-2">{viewing.customer_name}</dd></>)}
              <dt className="text-[var(--color-text-sub)]">カテゴリ</dt>
              <dd className="col-span-2">{viewing.category ? (CATEGORY_LABELS[viewing.category] ?? viewing.category) : '—'}</dd>
              <dt className="text-[var(--color-text-sub)]">期間</dt>
              <dd className="col-span-2">{viewing.period_start ?? '—'} 〜 {viewing.period_end ?? '—'}</dd>
              <dt className="text-[var(--color-text-sub)]">発注金額（税込）</dt>
              <dd className="col-span-2 font-mono tabular-nums font-semibold text-amber-600">
                {viewing.total_amount ? `¥${viewing.total_amount.toLocaleString()}` : '—'}
              </dd>
              {viewing.kind === 'received' && (<><dt className="text-[var(--color-text-sub)]">紐付請求書</dt><dd className="col-span-2">{viewing.invoice_submission_count} 件</dd></>)}
              {viewing.issued_at && (<><dt className="text-[var(--color-text-sub)]">発行日時</dt><dd className="col-span-2">{new Date(viewing.issued_at).toLocaleString('ja-JP')}</dd></>)}
              {viewing.note && (<><dt className="text-[var(--color-text-sub)]">備考</dt><dd className="col-span-2 whitespace-pre-wrap text-[11px]">{viewing.note}</dd></>)}
            </dl>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <button onClick={() => downloadPdf(viewing)} className="rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow">📎 PDF DL</button>
              <button onClick={() => setViewing(null)} className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs">閉じる</button>
            </div>
        </Modal>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">注文書が登録されていません</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">{filterYear}年{filterMonth}月分にかかる注文書はありません</div>
      ) : (
        <div className="glass overflow-x-auto rounded-xl shadow-md">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                {isAdmin && (
                  <th rowSpan={2} className="px-2 py-2 text-center w-8 align-bottom">
                    <input
                      type="checkbox"
                      checked={filteredItems.length > 0 && filteredItems.every((p) => checkedKeys.has(`${p.kind}-${p.id}`))}
                      onChange={(e) => {
                        const all = e.target.checked
                        setCheckedKeys((prev) => {
                          const next = new Set(prev)
                          filteredItems.forEach((p) => {
                            const k = `${p.kind}-${p.id}`
                            if (all) next.add(k); else next.delete(k)
                          })
                          return next
                        })
                      }}
                      title="表示中の全行を選択 / 解除"
                    />
                  </th>
                )}
                <th rowSpan={2} className="px-2 py-2 text-left align-bottom">種別</th>
                <th className="px-2 py-1 text-left whitespace-nowrap cursor-pointer select-none hover:text-fuchsia-500" onClick={() => toggleSort('order_no')}>注文番号{sortMark('order_no')}</th>
                <th className="px-2 py-1 text-left whitespace-nowrap cursor-pointer select-none hover:text-fuchsia-500" onClick={() => toggleSort('recipient')}>受注者{sortMark('recipient')}</th>
                <th className="px-2 py-1 text-left whitespace-nowrap cursor-pointer select-none hover:text-fuchsia-500" onClick={() => toggleSort('issuer')}>発注者{sortMark('issuer')}</th>
                <th className="px-2 py-1 text-left cursor-pointer select-none hover:text-fuchsia-500" onClick={() => toggleSort('subject')}>案件名{sortMark('subject')}</th>
                <th className="px-2 py-1 text-left whitespace-nowrap cursor-pointer select-none hover:text-fuchsia-500" onClick={() => toggleSort('period_start')}>期間{sortMark('period_start')}</th>
                <th rowSpan={2} className="px-2 py-2 text-right whitespace-nowrap cursor-pointer select-none hover:text-fuchsia-500 align-bottom" onClick={() => toggleSort('total_amount')}>金額{sortMark('total_amount')}</th>
                <th rowSpan={2} className="px-2 py-2 text-center align-bottom">紐付請求書</th>
                <th rowSpan={2} className="px-2 py-2 text-center align-bottom">操作</th>
              </tr>
              <tr className="bg-gray-50">
                <th className="px-1 pb-1 font-normal">
                  <input value={filters.order_no} onChange={(e) => setFilter('order_no', e.target.value)} placeholder="ORD-…" className="w-full rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] font-normal" />
                </th>
                <th className="px-1 pb-1 font-normal">
                  <select value={filters.recipient} onChange={(e) => setFilter('recipient', e.target.value)} className="w-full rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] font-normal bg-white">
                    <option value="">全員</option>
                    {recipientOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
                <th className="px-1 pb-1 font-normal">
                  <select value={filters.issuer} onChange={(e) => setFilter('issuer', e.target.value)} className="w-full rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] font-normal bg-white">
                    <option value="">全員</option>
                    {issuerOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
                <th className="px-1 pb-1 font-normal">
                  <select value={filters.subject} onChange={(e) => setFilter('subject', e.target.value)} className="w-full rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] font-normal bg-white">
                    <option value="">全て</option>
                    {subjectOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
                <th className="px-1 pb-1 font-normal">
                  <input type="date" value={filters.period} onChange={(e) => setFilter('period', e.target.value)} className="w-full rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] font-normal" title="指定日が含まれる注文書のみ表示" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((po) => (
                <tr key={`${po.kind}-${po.id}`} className={`border-t border-[var(--color-border)] ${po.kind === 'issued' ? 'bg-sky-50/30' : ''}`}>
                  {isAdmin && (
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={checkedKeys.has(`${po.kind}-${po.id}`)}
                        onChange={() => toggleCheck(po)}
                      />
                    </td>
                  )}
                  <td className="px-2 py-2 text-center whitespace-nowrap">
                    {po.kind === 'issued' ? (
                      <span className="inline-block whitespace-nowrap rounded bg-sky-100 text-sky-700 px-1.5 py-0.5 text-[10px] font-semibold" title="自社で発行した発注書 (履歴)">📤 発行</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 text-[10px] font-semibold" title="ラボップから受領した発注書">📥 受領</span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono font-semibold whitespace-nowrap">{po.order_no}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {po.kind === 'received'
                      ? (po.user_display_name ?? '—')
                      : (po.recipient_user_display_name ?? po.recipient_name ?? '—')}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {po.kind === 'received'
                      ? (po.customer_name ?? '—')
                      : (po.issuer_user_display_name ?? po.issuer_company ?? me?.display_name ?? '—')}
                  </td>
                  <td className="px-2 py-2">{po.subject ?? '—'}</td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)] whitespace-nowrap">
                    {po.period_start ?? '—'} 〜 {po.period_end ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {po.total_amount ? `¥${po.total_amount.toLocaleString()}` : '—'}
                    {isFilterActive && po.total_amount != null && (() => {
                      const monthly = monthlyAmountFor(po)
                      if (monthly === po.total_amount) return null
                      return <div className="text-[10px] text-emerald-600">↳ {filterMonth}月分 ¥{monthly.toLocaleString()}</div>
                    })()}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      {po.kind === 'received' ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${po.invoice_submission_count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {po.invoice_submission_count}件
                        </span>
                      ) : (
                        po.freee_deal_id ? (
                          <span title={`freee deal_id=${po.freee_deal_id}`} className="rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">🟧 freee 経費計上済</span>
                        ) : (
                          <button
                            onClick={() => reportIssuedPoToFreee(po)}
                            className="rounded bg-gradient-to-r from-orange-500 to-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
                            title="freee に経費として計上"
                          >🟧 freee 経費</button>
                        )
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center whitespace-nowrap">
                    <RowActions
                      viewLabel="詳細"
                      onView={() => setViewing(po)}
                      onEdit={isAdmin ? () => startEdit(po) : undefined}
                      onDelete={isAdmin ? () => remove(po) : undefined}
                      dlItems={(() => {
                        const items = []
                        if (po.kind === 'issued' || po.has_pdf) {
                          items.push({ label: '📎 PDF DL', onClick: () => downloadPdf(po), variant: po.kind === 'issued' ? 'sky' as const : 'fuchsia' as const })
                        }
                        if (po.file_url) {
                          items.push({ label: '🔗 URL を開く', onClick: () => window.open(po.file_url!, '_blank', 'noopener,noreferrer'), variant: 'fuchsia' as const })
                        }
                        return items
                      })()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bulkMailOpen && (
        <PurchaseOrderBulkMailModal
          pos={filteredItems
            .filter((p) => checkedKeys.has(`${p.kind}-${p.id}`))
            .map((p) => ({
              id: p.id,
              kind: p.kind ?? 'received',
              order_no: p.order_no,
              subject: p.subject,
              category: p.category,
              period_start: p.period_start,
              period_end: p.period_end,
              total_amount: p.total_amount,
              recipient_user_display_name: p.recipient_user_display_name,
              recipient_name: p.recipient_name,
              user_display_name: p.user_display_name,
              customer_name: p.customer_name,
              template_position: p.template_position,
              template_hours_per_cycle: p.template_hours_per_cycle,
              template_rate_per_hour: p.template_rate_per_hour,
              template_base_monthly: p.template_base_monthly,
              has_pdf: p.has_pdf,
              filename: p.filename,
            }))}
          onClose={() => setBulkMailOpen(false)}
        />
      )}
    </div>
  )
}
