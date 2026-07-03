import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { buildDeliveryDeadline, splitByClosingDay } from '../lib/purchaseOrderPeriod'

// /purchase-orders 行の最低限のフィールドだけ受ける
export type BulkMailPo = {
  id: number
  kind: 'received' | 'issued'
  order_no: string
  subject: string | null
  category: string | null
  period_start: string | null
  period_end: string | null
  total_amount: number | null
  recipient_user_display_name?: string | null
  recipient_name?: string | null
  user_display_name?: string | null
  customer_name?: string | null
  template_position?: number | null
  // 月あたり工数・単価 (issued のみ。AI 下書きで「160h 506,000円(税込) 時給3,163円」を出すために使う)
  template_hours_per_cycle?: number | null
  template_rate_per_hour?: number | null
  template_base_monthly?: number | null
  has_pdf?: boolean
  filename?: string | null
}

type Props = {
  pos: BulkMailPo[]
  onClose: () => void
}

const CATEGORY_LABEL: Record<string, string> = {
  wings: 'Wings (タマ)',
  living: 'タマリビング',
  techleaders: 'テックリーダーズ',
  resystems: 'REシステムズ',
}

// issued PO (PurchaseOrderSetting) の PDF を取得してファイル化する
const fetchIssuedPdfFile = async (po: BulkMailPo): Promise<File> => {
  const r = await api.get<any>('/purchase_order_setting', { params: { category: po.category, position: po.template_position ?? 0 } })
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
  const name = `注文書_${CATEGORY_LABEL[po.category ?? 'wings'] ?? po.category}_${s.period_start ?? ''}_${s.period_end ?? ''}.pdf`
  return new File([res.data as Blob], name, { type: 'application/pdf' })
}

// received PO (ReceivedPurchaseOrder) の保存済 PDF をそのまま取得
const fetchReceivedPdfFile = async (po: BulkMailPo): Promise<File> => {
  const res = await api.get(`/received_purchase_orders/${po.id}/download`, { responseType: 'blob' })
  const name = po.filename ?? `発注書_${po.order_no}.pdf`
  return new File([res.data as Blob], name, { type: 'application/pdf' })
}

export default function PurchaseOrderBulkMailModal({ pos, onClose }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(pos.map((p) => `${p.kind}-${p.id}`)))
  const [to, setTo] = useState('calmdownyourlife@gmail.com')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)

  const selected = pos.filter((p) => selectedIds.has(`${p.kind}-${p.id}`))
  const totalAmount = selected.reduce((acc, p) => acc + (p.total_amount ?? 0), 0)

  useEffect(() => { void requestDraft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const toggle = (key: string) => setSelectedIds((prev) => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  const requestDraft = async () => {
    setDrafting(true); setMsg(null)
    try {
      const r = await api.post<{ subject: string; body: string }>('/emails/purchase_order_bulk_draft', {
        items: selected.map((p) => {
          // 月額(税込)は total / サイクル数 で確定。
          // PurchaseOrderSetting.base_monthly はレコードによって税抜/税込が混在しているため信用しない。
          // 月額(税抜) = 月額(税込) / 1.1。時給は rate_per_hour が税抜で統一されているので ×1.1 で税込化。
          const cycles = (p.period_start && p.period_end) ? splitByClosingDay(p.period_start, p.period_end, 25).length : 1
          const monthlyTaxInc = (p.total_amount && cycles > 0) ? Math.round(p.total_amount / cycles) : 0
          const monthlyTaxExc = monthlyTaxInc > 0 ? Math.round(monthlyTaxInc / 1.1) : 0
          const hourlyTaxExc = p.template_rate_per_hour ?? 0
          const hourlyTaxInc = hourlyTaxExc ? Math.round(hourlyTaxExc * 1.1) : 0
          return {
            subject: p.subject,
            order_no: p.order_no,
            category: p.category,
            period_start: p.period_start,
            period_end: p.period_end,
            total_amount: p.total_amount,
            hours_per_cycle: p.template_hours_per_cycle,
            monthly_tax_inc: monthlyTaxInc,
            monthly_tax_exc: monthlyTaxExc,
            hourly_tax_inc: hourlyTaxInc,
            hourly_tax_exc: hourlyTaxExc,
          }
        }),
      })
      setSubject(r.data.subject)
      setBody(r.data.body)
      setDraftLoaded(true)
    } catch (e: any) {
      setMsg(`AI下書き失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setDrafting(false)
    }
  }

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setExtraFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }
  const removeExtra = (i: number) => setExtraFiles((prev) => prev.filter((_, idx) => idx !== i))

  const send = async () => {
    if (!subject.trim() || !body.trim()) { setMsg('件名・本文を入力してください'); return }
    if (selected.length === 0) { setMsg('送付対象を1件以上選択してください'); return }
    setSending(true); setMsg(null)
    try {
      // 各 PO の PDF を取得（issued は再生成、received は保存済バイナリ）
      const pdfFiles = await Promise.all(selected.map((p) =>
        p.kind === 'issued' ? fetchIssuedPdfFile(p) : fetchReceivedPdfFile(p)
      ))
      const fd = new FormData()
      fd.append('to', to)
      fd.append('subject', subject)
      fd.append('body', body)
      pdfFiles.forEach((f) => fd.append('files[]', f))
      extraFiles.forEach((f) => fd.append('files[]', f))
      const r = await api.post<{ ok: boolean; sent_to: string }>('/emails/purchase_order_send', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMsg(`✅ 送信しました (実宛先: ${r.data.sent_to}, 添付 ${pdfFiles.length + extraFiles.length} 件)`)
    } catch (e: any) {
      setMsg(`送信失敗: ${e?.response?.data?.error ?? e?.message ?? ''}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">📧 注文書を一括送付</div>
            <div className="text-[11px] text-[var(--color-text-sub)]">
              選択中 {selected.length}/{pos.length} 件 ／ 合計 ¥{totalAmount.toLocaleString()}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500" aria-label="閉じる">✕</button>
        </div>

        <label className="block mb-2">
          <div className="text-[11px] font-semibold mb-0.5">宛先</div>
          <input value={to} onChange={(e) => setTo(e.target.value)} list="po-bulk-mail-to-list" autoComplete="email" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" />
          <datalist id="po-bulk-mail-to-list">
            <option value="calmdownyourlife@gmail.com" />
            <option value="takaya777boxing@gmail.com" />
            <option value="takaya314boxing@gmail.com" />
          </datalist>
          <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">
            標準: <code>calmdownyourlife@gmail.com</code> (川村)
          </div>
        </label>

        <div className="rounded-md border border-[var(--color-border)] px-2 py-1.5 mb-2">
          <div className="text-[11px] font-semibold mb-1">送付対象を選択（デフォルト全選択）</div>
          {pos.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-sub)]">対象がありません</div>
          ) : pos.map((p) => {
            const key = `${p.kind}-${p.id}`
            return (
              <label key={key} className="flex items-center gap-2 text-[11px] cursor-pointer">
                <input type="checkbox" checked={selectedIds.has(key)} onChange={() => toggle(key)} />
                <span className={p.kind === 'issued' ? 'text-sky-600' : 'text-fuchsia-600'}>
                  {p.kind === 'issued' ? '📤' : '📥'}
                </span>
                <span className="font-mono">{p.order_no}</span>
                <span>{p.subject ?? '(案件名未設定)'}</span>
                <span className="text-[var(--color-text-sub)]">{p.period_start ?? '—'}〜{p.period_end ?? '—'}</span>
                {p.total_amount != null && <span className="text-amber-600">¥{p.total_amount.toLocaleString()}</span>}
              </label>
            )
          })}
        </div>

        <label className="block mb-2">
          <div className="text-[11px] font-semibold mb-0.5">件名</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm" placeholder={drafting ? 'AI 下書き生成中…' : ''} />
        </label>

        <label className="block mb-2">
          <div className="text-[11px] font-semibold mb-0.5">本文</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-sm font-mono" placeholder={drafting ? 'AI 下書き生成中…' : ''} />
          <div className="mt-1 flex justify-end">
            <button onClick={requestDraft} disabled={drafting} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">
              {drafting ? 'AI 生成中…' : '🤖 AI で再生成'}
            </button>
          </div>
        </label>

        <div className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-[var(--color-text-sub)]">
          自動添付: 選択された {selected.length} 件の注文書 PDF（発行注文書は最新内容で再生成、受領注文書は保存済バイナリ）
        </div>

        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold">追加添付</div>
            <label className="cursor-pointer rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">
              + ファイル追加
              <input type="file" multiple onChange={handleFiles} className="hidden" />
            </label>
          </div>
          {extraFiles.length === 0 ? (
            <div className="text-[10px] text-[var(--color-text-sub)]">なし</div>
          ) : (
            <ul className="text-[11px] space-y-0.5">
              {extraFiles.map((f, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>📎 {f.name}（{Math.round(f.size / 1024)} KB）</span>
                  <button onClick={() => removeExtra(i)} className="text-gray-400 hover:text-red-500">🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`text-[11px] ${msg?.includes('失敗') ? 'text-red-500' : 'text-emerald-600'}`}>{msg ?? ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">閉じる</button>
            <button onClick={send} disabled={sending || drafting || !draftLoaded || selected.length === 0} className="rounded-md whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {sending ? '送信中…' : `📧 一括送信 (${selected.length} 件)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
