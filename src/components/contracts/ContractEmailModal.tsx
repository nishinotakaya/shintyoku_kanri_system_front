import { useState } from 'react'
import Modal from '../Modal'
import { sendContractEmail, polishContractEmail, SIGN_URL_PLACEHOLDER } from '../../lib/contracts'
import type { Contract } from '../../lib/contracts'

// 契約書をメールで送るモーダル。宛先・文面をチェック → AI添削 → 送信の流れ。
// 送信時にサーバが署名リンクを発行し、本文中の {署名URL} を実リンクに置き換える。
// 乙はメール内のリンクから電子署名まで完結できる。
function buildDefaultBody(contract: Contract): string {
  const recipient = contract.party_b.name ? `${contract.party_b.name} 様` : 'ご担当者様'
  const sender = contract.user_name
  return [
    recipient,
    '',
    `お世話になっております。${sender}です。`,
    `「${contract.title}」をお送りいたします。`,
    '内容をご確認のうえ、下記リンクより電子署名をお願いいたします。',
    '',
    SIGN_URL_PLACEHOLDER,
    '',
    '※リンクの有効期限は送信から30日です。',
    '※ご不明点がありましたら、このメールへの返信にてご連絡ください。',
    '',
    sender,
  ].join('\n')
}

export default function ContractEmailModal({ contract, onClose, onSent }: {
  contract: Contract
  onClose: () => void
  onSent: (updated: Contract) => void
}) {
  const [to, setTo] = useState(contract.party_b.email ?? '')
  const [subject, setSubject] = useState(`【${contract.title}】ご署名のお願い`)
  const [body, setBody] = useState(() => buildDefaultBody(contract))
  const [polishing, setPolishing] = useState(false)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const polish = async () => {
    setPolishing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await polishContractEmail(contract.id, { subject, body })
      setSubject(result.subject)
      setBody(result.body)
      setNotice(result.polished ? '✅ AI添削を反映しました。内容を確認して送信してください' : 'AI添削は現在使えないため、文面はそのままです')
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'AI添削に失敗しました')
    } finally {
      setPolishing(false)
    }
  }

  const send = async () => {
    if (!to.trim()) {
      setError('宛先メールアドレスを入力してください')
      return
    }
    setSending(true)
    setError(null)
    try {
      const updated = await sendContractEmail(contract.id, { to: to.trim(), subject, body })
      onSent(updated)
      onClose()
      alert(`✅ ${to.trim()} へ送信しました。相手はメール内のリンクから電子署名できます`)
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? '送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-2 text-base'

  return (
    <Modal onClose={onClose} panelClassName="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-semibold text-[var(--color-text)]">📧 契約書をメールで送付</div>
        <button type="button" onClick={onClose} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
      </div>

      <div className="text-sm text-[var(--color-text-sub)]">
        送信すると署名リンクが発行され、本文中の <code className="rounded bg-gray-100 px-1">{SIGN_URL_PLACEHOLDER}</code> が実際のリンクに置き換わります。
        相手はリンクを開いてそのまま電子署名できます。
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-[var(--color-text-sub)]">宛先（乙のメールアドレス）</span>
        <input type="email" value={to} onChange={(e) => setTo(e.target.value)}
          placeholder="partner@example.com" className={inputCls} />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-[var(--color-text-sub)]">件名</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-[var(--color-text-sub)]">本文</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
          className={`${inputCls} resize-y leading-relaxed`} />
      </label>

      {notice && <div className="text-sm text-emerald-600">{notice}</div>}
      {error && <div className="text-sm text-red-500">{error}</div>}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={polish} disabled={polishing || sending}
          className="h-11 rounded-md border border-violet-300 bg-white px-4 text-base font-semibold text-violet-600 hover:bg-violet-50 disabled:opacity-50">
          {polishing ? '添削中…' : '🤖 AI添削'}
        </button>
        <button type="button" onClick={send} disabled={sending || polishing}
          className="h-11 rounded-md bg-gradient-to-r from-sky-500 to-blue-500 px-4 text-base font-semibold text-white shadow disabled:opacity-50">
          {sending ? '送信中…' : '📤 送信する'}
        </button>
      </div>
    </Modal>
  )
}
