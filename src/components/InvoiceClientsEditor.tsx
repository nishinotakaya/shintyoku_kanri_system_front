import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// 請求先(宛先)マスタ。取引先が複数ある人(運送など)がここに登録しておき、
// 請求書ごとにセレクトで選ぶ。選んだ時点の宛名は請求書側に焼き付くので、
// ここを直しても発行済み・選択済みの請求書の宛先は動かない。
export type InvoiceClient = {
  id: number
  name: string
  honorific: string
  subject: string | null
  postal_code: string | null
  address: string | null
  tel: string | null
  fax: string | null
  contact_name: string | null
  is_default: boolean
}

type FormState = {
  name: string
  honorific: string
  subject: string
  postal_code: string
  address: string
  tel: string
  fax: string
  contact_name: string
  is_default: boolean
}

const EMPTY_FORM: FormState = {
  name: '', honorific: '御中', subject: '', postal_code: '',
  address: '', tel: '', fax: '', contact_name: '', is_default: false,
}

const toForm = (client: InvoiceClient): FormState => ({
  name: client.name,
  honorific: client.honorific || '御中',
  subject: client.subject ?? '',
  postal_code: client.postal_code ?? '',
  address: client.address ?? '',
  tel: client.tel ?? '',
  fax: client.fax ?? '',
  contact_name: client.contact_name ?? '',
  is_default: client.is_default,
})

export default function InvoiceClientsEditor({ asUserId }: { asUserId?: number }) {
  const [clients, setClients] = useState<InvoiceClient[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const params = asUserId ? { as_user_id: asUserId } : undefined

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<InvoiceClient[]>('/invoice_clients', { params })
      setClients(res.data)
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '請求先の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [asUserId])

  const startNew = () => { setForm(EMPTY_FORM); setEditingId('new') }
  const startEdit = (client: InvoiceClient) => { setForm(toForm(client)); setEditingId(client.id) }
  const cancel = () => { setEditingId(null); setErr(null) }

  const save = async () => {
    if (!form.name.trim()) { setErr('会社名（宛名）を入れてください'); return }
    setBusy(true)
    setErr(null)
    try {
      const payload = { invoice_client: { ...form, name: form.name.trim() }, ...(params ?? {}) }
      if (editingId === 'new') await api.post('/invoice_clients', payload)
      else await api.patch(`/invoice_clients/${editingId}`, payload)
      setEditingId(null)
      await load()
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (client: InvoiceClient) => {
    if (!confirm(`「${client.name}」を請求先から外しますか？（過去の請求書の宛先はそのまま残ります）`)) return
    setBusy(true)
    try {
      await api.delete(`/invoice_clients/${client.id}`, { params })
      await load()
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '削除に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: keyof FormState, span = 'col-span-1') => (
    <label className={`block ${span}`}>
      <span className="text-[11px] text-[var(--color-text-sub)]">{label}</span>
      <input
        value={String(form[key] ?? '')}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-fuchsia-400/60 focus:bg-gray-50"
      />
    </label>
  )

  return (
    <div className="mt-6 rounded-xl border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">請求先（宛先）</div>
          <div className="text-[10px] text-[var(--color-text-sub)]">
            取引先を登録しておくと、請求書ごとに宛先を選べます。未選択の請求書は「既定」の宛先になります
          </div>
        </div>
        <button onClick={startNew} disabled={busy}
          className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-50">
          + 請求先を追加
        </button>
      </div>

      {err && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-600">{err}</div>}

      <div className="mt-3 space-y-1">
        {loading ? (
          <div className="text-[11px] text-[var(--color-text-sub)]">読み込み中…</div>
        ) : clients.length === 0 ? (
          <div className="text-[11px] text-[var(--color-text-sub)]">まだ登録がありません（請求書は下の「請求先」欄の宛名で発行されます）</div>
        ) : clients.map((client) => (
          <div key={client.id} className="flex items-center gap-2 rounded-lg bg-[var(--color-bg)] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-[var(--color-text)]">
                {client.name} <span className="text-[var(--color-text-sub)]">{client.honorific}</span>
                {client.is_default && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">既定</span>
                )}
              </div>
              {(client.subject || client.address) && (
                <div className="truncate text-[10px] text-[var(--color-text-sub)]">
                  {[client.subject, client.address].filter(Boolean).join(' / ')}
                </div>
              )}
            </div>
            <button onClick={() => startEdit(client)} className="shrink-0 text-[11px] text-indigo-600">編集</button>
            <button onClick={() => remove(client)} className="shrink-0 text-[11px] text-red-500">削除</button>
          </div>
        ))}
      </div>

      {editingId !== null && (
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-[var(--color-border)] p-3">
          <div className="col-span-2 flex gap-2">
            <div className="flex-1">{field('会社名（宛名）', 'name', 'col-span-2')}</div>
            <label className="block w-24">
              <span className="text-[11px] text-[var(--color-text-sub)]">敬称</span>
              <select value={form.honorific} onChange={(e) => setForm({ ...form, honorific: e.target.value })}
                className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm">
                <option value="御中">御中</option>
                <option value="様">様</option>
              </select>
            </label>
          </div>
          {field('件名（既定）', 'subject', 'col-span-2')}
          {field('担当者', 'contact_name')}
          {field('TEL', 'tel')}
          {field('郵便番号', 'postal_code')}
          {field('FAX', 'fax')}
          {field('住所', 'address', 'col-span-2')}
          <label className="col-span-2 flex items-center gap-2 text-[11px] text-[var(--color-text-sub)]">
            <input type="checkbox" checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            既定の請求先にする（宛先を選んでいない請求書はここ宛になります）
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <button onClick={cancel} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs">キャンセル</button>
            <button onClick={save} disabled={busy}
              className="rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
