import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'

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
  // 自社が発行した発注書 (purchase_order_histories) を統合表示するための種別。
  // 'received' = ラボップから受け取った PDF / 'issued' = 自社で作成して川村等に送った発注書
  // 'issued_template' = 勤怠 page で保存中の発注書テンプレ (purchase_order_settings)
  kind?: 'received' | 'issued' | 'issued_template'
  recipient_name?: string | null  // issued のみ: 受領者 (例: 川村 卓也)
  issued_at?: string | null       // issued のみ: 発行日時
}

type IssuedHistory = {
  id: number
  category: string
  position: number
  order_no: string
  subject: string
  recipient_name: string
  period_start: string | null
  period_end: string | null
  total_amount: number
  issued_at: string | null
}

// 勤怠 page の注文書一覧で使われる「設定済み発注書テンプレ」(purchase_order_settings)
// (PurchaseOrderHistory ではなく、こちらが勤怠側でフォーム保存されているデータ)
type IssuedSetting = {
  id: number
  category: string
  position: number
  exists?: boolean
  subject: string | null
  recipient_name: string | null
  period_start: string | null
  period_end: string | null
  base_monthly: number | null
  rate_per_hour: number | null
  hours_per_cycle: number | null
  total_amount: number | null   // バックエンドが items 合計 × 1.1 で計算済 (税込)
  remarks?: string | null
  delivery_location?: string | null
  payment_method?: string | null
  issuer_company?: string | null
  issuer_representative?: string | null
  items?: Array<{ description: string; qty: number; unit: string; unit_price: number; amount: number }>
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

type PickableUser = { id: number; display_name: string; email: string; admin: boolean }

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
      // + 勤怠で発行した PO 履歴 (purchase_order_histories)
      // + 勤怠 page の注文書一覧 = カテゴリ別の発注テンプレ (purchase_order_settings)
      // を全部取って統合表示
      const cats = ['wings', 'living', 'techleaders', 'resystems'] as const
      const [recvRes, issuedRes, ...settingResults] = await Promise.all([
        api.get<PO[]>('/received_purchase_orders'),
        api.get<IssuedHistory[]>('/purchase_order_histories').catch(() => ({ data: [] as IssuedHistory[] })),
        ...cats.map((c) =>
          api.get<IssuedSetting[]>('/purchase_order_settings', { params: { category: c } })
            .catch(() => ({ data: [] as IssuedSetting[] }))
        ),
      ])
      const received: PO[] = recvRes.data.map((r) => ({ ...r, kind: 'received' as const }))
      const issuedHistory: PO[] = issuedRes.data.map((h) => ({
        id: h.id,
        user_id: 0,
        user_display_name: null,
        order_no: h.order_no,
        customer_name: null,
        category: h.category,
        subject: h.subject,
        period_start: h.period_start,
        period_end: h.period_end,
        total_amount: h.total_amount,
        note: null, file_url: null, filename: null, has_pdf: false, ai_extracted_at: null,
        invoice_submission_count: 0,
        kind: 'issued' as const,
        recipient_name: h.recipient_name,
        issued_at: h.issued_at,
      }))
      const issuedSettings: PO[] = settingResults.flatMap((res, idx) => {
        const cat = cats[idx]
        return (res.data ?? []).filter((s) => s.exists !== false).map((s) => ({
          // 実 setting の id をそのまま入れる (PO[] の id は number だが kind で区別するので衝突しない)
          id: s.id,
          user_id: 0,
          user_display_name: null,
          order_no: '—',
          customer_name: null,
          category: cat,
          subject: s.subject || '(案件名未設定)',
          period_start: s.period_start,
          period_end: s.period_end,
          // 発注金額（税込）= バックエンドが items 合計に 10% 加算済
          total_amount: s.total_amount ?? null,
          note: s.remarks ?? null,
          file_url: null, filename: null, has_pdf: false, ai_extracted_at: null,
          invoice_submission_count: 0,
          kind: 'issued_template' as const,
          recipient_name: s.recipient_name,
          issued_at: null,
        }))
      })
      setItems([...received, ...issuedHistory, ...issuedSettings])
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
    if (!editing.order_no?.trim()) { setMsg('注文番号を入力してください'); return }
    setBusy(true); setMsg(null)
    try {
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
    try {
      // テンプレ (purchase_order_settings) → 勤怠 page と同じ payload を組み立てて
      // /exports/purchase_order.pdf を叩く
      if (po.kind === 'issued_template') {
        const r = await api.get<IssuedSetting>('/purchase_order_setting', { params: { category: po.category, position: 0 } })
        const s = r.data
        const total = s.total_amount ?? 0
        const subtotal = total > 0 ? Math.round(total / 1.1) : 0
        const payload = {
          order_no: 'ORD-' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0'),
          subject: s.subject ?? '',
          tax_rate: 10,
          category: po.category ?? 'wings',
          period_start: s.period_start, period_end: s.period_end,
          delivery_location: s.delivery_location ?? '客先指定場所',
          payment_method: s.payment_method ?? '振込',
          remarks: s.remarks ?? '',
          recipient: { name: s.recipient_name ?? '', postal_code: '', address: '' },
          issuer: { company_name: s.issuer_company ?? '', representative: s.issuer_representative ?? '', postal_code: '', address: '' },
          items: s.items ?? [{ description: s.subject ?? '', qty: 1, unit: '式', unit_price: subtotal, amount: subtotal }],
        }
        const res = await api.post('/exports/purchase_order.pdf', payload, { responseType: 'blob' })
        const url = URL.createObjectURL(res.data as Blob)
        const a = document.createElement('a')
        a.href = url; a.download = `発注書_${po.subject ?? po.category}_${po.period_start ?? ''}.pdf`
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
        return
      }
      const path = po.kind === 'issued'
        ? `/purchase_order_histories/${po.id}/regenerate.pdf`
        : `/received_purchase_orders/${po.id}/download`
      const res = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url; a.target = '_blank'; a.rel = 'noreferrer'
      a.download = po.filename ?? `発注書_${po.order_no}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert(`PDF DL 失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    }
  }

  // テンプレ編集: 勤怠 page を開く（カテゴリ指定）
  const editTemplate = (po: PO) => {
    if (!po.category) return
    window.open(`/attendance?category=${po.category}#purchase-orders`, '_blank')
  }

  const remove = async (po: PO) => {
    if (!confirm(`${po.order_no} を削除しますか？`)) return
    setBusy(true)
    try {
      await api.delete(`/received_purchase_orders/${po.id}`)
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
        </div>
        {isAdmin && (
          <button onClick={startNew}
            className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow">
            ＋ 新規追加
          </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={cancel}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
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
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="タマリビング様新ISN基幹システム開発" />
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
                className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder="タマホーム" />
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
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewing(null)}>
          <div className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-xl bg-white p-4 shadow-xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                🔍 詳細
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  viewing.kind === 'issued' ? 'bg-sky-100 text-sky-700' :
                  viewing.kind === 'issued_template' ? 'bg-amber-100 text-amber-700' :
                  'bg-fuchsia-100 text-fuchsia-700'
                }`}>
                  {viewing.kind === 'issued' ? '📤 発行履歴' : viewing.kind === 'issued_template' ? '📝 テンプレ' : '📥 受領'}
                </span>
              </div>
              <button onClick={() => setViewing(null)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
            </div>
            <dl className="grid grid-cols-3 gap-1 text-[12px]">
              <dt className="text-[var(--color-text-sub)]">注文番号</dt>
              <dd className="col-span-2 font-mono font-semibold">{viewing.order_no}</dd>
              <dt className="text-[var(--color-text-sub)]">案件名</dt>
              <dd className="col-span-2">{viewing.subject ?? '—'}</dd>
              <dt className="text-[var(--color-text-sub)]">{viewing.kind === 'received' ? '受注者' : '受領者'}</dt>
              <dd className="col-span-2">{viewing.kind === 'received' ? (viewing.user_display_name ?? '—') : (viewing.recipient_name ?? '—')}</dd>
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
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-sub)]">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--color-text-sub)]">注文書が登録されていません</div>
      ) : (
        <div className="glass rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[var(--color-text-sub)]">
              <tr>
                <th className="px-2 py-2 text-left">種別</th>
                <th className="px-2 py-2 text-left">注文番号</th>
                <th className="px-2 py-2 text-left">受注者 / 受領者</th>
                <th className="px-2 py-2 text-left">案件名</th>
                <th className="px-2 py-2 text-left">期間</th>
                <th className="px-2 py-2 text-right">金額</th>
                <th className="px-2 py-2 text-center">紐付請求書</th>
                <th className="px-2 py-2 text-center">PDF</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((po) => (
                <tr key={`${po.kind}-${po.id}`} className={`border-t border-[var(--color-border)] ${po.kind === 'issued' ? 'bg-sky-50/30' : ''}`}>
                  <td className="px-2 py-2 text-center">
                    {po.kind === 'issued' ? (
                      <span className="rounded bg-sky-100 text-sky-700 px-1.5 py-0.5 text-[10px] font-semibold" title="自社で発行した発注書 (履歴)">📤 発行</span>
                    ) : po.kind === 'issued_template' ? (
                      <span className="rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold" title="勤怠ページで保存中の発注書テンプレ">📝 テンプレ</span>
                    ) : (
                      <span className="rounded bg-fuchsia-100 text-fuchsia-700 px-1.5 py-0.5 text-[10px] font-semibold" title="ラボップから受領した発注書">📥 受領</span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono font-semibold">{po.order_no}</td>
                  <td className="px-2 py-2">{(po.kind === 'issued' || po.kind === 'issued_template') ? (po.recipient_name ?? '—') : (po.user_display_name ?? '—')}</td>
                  <td className="px-2 py-2">{po.subject ?? '—'}</td>
                  <td className="px-2 py-2 text-[10px] text-[var(--color-text-sub)]">
                    {po.period_start ?? '—'} 〜 {po.period_end ?? '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">
                    {po.total_amount ? `¥${po.total_amount.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {po.kind === 'received' ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${po.invoice_submission_count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {po.invoice_submission_count}件
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {po.kind === 'issued' ? (
                      <button onClick={() => downloadPdf(po)} className="text-sky-500 hover:underline">📎 PDF</button>
                    ) : po.kind === 'issued_template' ? (
                      <button onClick={() => downloadPdf(po)} className="text-amber-600 hover:underline">📎 PDF</button>
                    ) : po.has_pdf ? (
                      <button onClick={() => downloadPdf(po)} className="text-fuchsia-500 hover:underline">📎 PDF</button>
                    ) : po.file_url ? (
                      <a href={po.file_url} target="_blank" rel="noreferrer" className="text-fuchsia-500 hover:underline">📎 URL</a>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setViewing(po)} className="text-sky-600 hover:text-sky-500 mr-2 text-[11px]">🔍 詳細</button>
                    {isAdmin && po.kind === 'received' && (
                      <>
                        <button onClick={() => startEdit(po)} className="text-fuchsia-500 hover:text-fuchsia-400 mr-2 text-[11px]">✏️ 編集</button>
                        <button onClick={() => remove(po)} className="text-gray-400 hover:text-red-500 text-[11px]">🗑</button>
                      </>
                    )}
                    {isAdmin && po.kind === 'issued_template' && (
                      <button onClick={() => editTemplate(po)} className="text-fuchsia-500 hover:text-fuchsia-400 text-[11px]">✏️ 勤怠で編集</button>
                    )}
                    {isAdmin && po.kind === 'issued' && (
                      <span className="text-[10px] text-[var(--color-text-sub)]">履歴は変更不可</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
