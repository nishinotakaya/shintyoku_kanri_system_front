import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  fetchPublicContract, fetchPublicContractPdfBlob, signPublicContract,
  formatContractDate, formatContractDateTime,
} from '../lib/contracts'
import type { ContractParty, PublicContract } from '../lib/contracts'
import { showPdfWhileLoading } from '../lib/openPdf'
import SignaturePad from '../components/contracts/SignaturePad'

// 相手(乙)が開く署名ページ。検索エンジンに拾われたくないので noindex を head に足す。
function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])
}

function GuidancePage({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm space-y-3 text-center">
        <div className="text-xl font-bold text-[var(--color-text)]">{heading}</div>
        <div className="text-base text-[var(--color-text-sub)]">{body}</div>
      </div>
    </div>
  )
}

function PartyCard({ label, party }: { label: string; party: ContractParty }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="text-sm font-semibold text-[var(--color-text-sub)]">{label}</div>
      <div className="text-[17px] font-semibold leading-relaxed text-[var(--color-text)] sm:text-lg">{party.name || '—'}</div>
      {party.representative && <div className="text-[17px] leading-relaxed text-[var(--color-text-sub)] sm:text-lg">代表者: {party.representative}</div>}
      {party.address && <div className="text-[17px] leading-relaxed text-[var(--color-text-sub)] sm:text-lg">{party.address}</div>}
    </div>
  )
}

export default function ContractSignPage() {
  const { token } = useParams<{ token: string }>()
  useNoIndexMeta()

  const [contract, setContract] = useState<PublicContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<'not_found' | 'unknown' | null>(null)

  const [signerName, setSignerName] = useState('')
  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [agreedContent, setAgreedContent] = useState(false)
  const [agreedElectronic, setAgreedElectronic] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setLoadError('not_found'); setLoading(false); return }
    let cancelled = false
    fetchPublicContract(token)
      .then((data) => {
        if (cancelled) return
        setContract(data)
        setSignerName(data.party_b.name ?? '')
      })
      .catch((error: any) => {
        if (cancelled) return
        setLoadError(error?.response?.status === 404 ? 'not_found' : 'unknown')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  // PDF はモーダル表示(showPdf)。以前の別タブ方式(openPdfWindow)は廃止。
  const openContractPdf = async () => {
    if (!token) return
    try {
      await showPdfWhileLoading(`${contract?.title ?? '契約書'}.pdf`, () => fetchPublicContractPdfBlob(token))
    } catch {
      alert('PDF の取得に失敗しました')
    }
  }

  const canSubmit = agreedContent && agreedElectronic && !!signatureImage && signerName.trim() !== '' && !submitting

  const handleSubmit = async () => {
    if (!token || !signatureImage || !canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await signPublicContract(token, {
        signer_name: signerName.trim(),
        signature_image: signatureImage,
        agreed: agreedContent,
        consent_electronic: agreedElectronic,
      })
      // status/signer_name/signed_at はサーバー側の値を正として取り直す
      const refreshed = await fetchPublicContract(token)
      setContract(refreshed)
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error ?? '署名の送信に失敗しました。もう一度お試しください')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-base text-[var(--color-text-sub)]">読み込み中…</div>
      </div>
    )
  }

  if (loadError === 'not_found') {
    return <GuidancePage heading="契約書が見つかりません" body="URL が正しいことをご確認ください。心当たりのない場合は、契約書を送付した担当者にお問い合わせください。" />
  }
  if (loadError === 'unknown' || !contract) {
    return <GuidancePage heading="読み込みに失敗しました" body="通信環境をご確認のうえ、ページを再読み込みしてください。" />
  }
  if (contract.status === 'void') {
    return <GuidancePage heading="この契約書は無効になっています" body="契約書を送付した担当者に再発行を依頼してください。" />
  }
  if (contract.status === 'sent' && !contract.signable) {
    return <GuidancePage heading="この署名リンクの有効期限が切れています" body="契約書を送付した担当者に再発行を依頼してください。" />
  }
  if (contract.status !== 'signed' && contract.status !== 'sent') {
    return <GuidancePage heading="現在この契約書は閲覧できません" body="契約書を送付した担当者にお問い合わせください。" />
  }

  const alreadySigned = contract.status === 'signed'

  return (
    <div className="min-h-screen bg-[var(--color-bg)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-bold text-[var(--color-text)] sm:text-3xl">{contract.title}</h1>
          {/* スマホで最初に目に入る位置にもPDFボタンを置く(下部にも同じボタンあり) */}
          <button
            type="button"
            onClick={openContractPdf}
            className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white text-lg font-semibold text-[var(--color-text)] active:scale-[0.99]"
          >
            📄 PDF で見る
          </button>
        </header>

        <section className="glass rounded-xl p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PartyCard label="甲" party={contract.party_a} />
            <PartyCard label="乙" party={contract.party_b} />
          </div>
        </section>

        <section className="glass space-y-2 rounded-xl p-4 text-[17px] leading-relaxed text-[var(--color-text-sub)] sm:text-lg">
          <div>契約締結日: {formatContractDate(contract.contract_date)}</div>
          <div>契約期間: {formatContractDate(contract.start_on)} 〜 {formatContractDate(contract.end_on)}</div>
        </section>

        <section className="glass space-y-5 rounded-xl p-4">
          {contract.articles.map((article, index) => (
            <div key={index}>
              <div className="text-lg font-bold text-[var(--color-text)] sm:text-xl">{article.heading}</div>
              <div className="mt-1 whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--color-text)] sm:text-lg">{article.body}</div>
            </div>
          ))}
        </section>

        {contract.special_terms && (
          <section className="glass space-y-2 rounded-xl p-4">
            <div className="text-lg font-bold text-[var(--color-text)] sm:text-xl">特記事項</div>
            <div className="whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--color-text)] sm:text-lg">{contract.special_terms}</div>
          </section>
        )}

        <button
          type="button"
          onClick={openContractPdf}
          className="h-12 w-full rounded-lg border border-[var(--color-border)] bg-white text-lg font-semibold text-[var(--color-text)] active:scale-[0.99]"
        >
          📄 PDF で見る
        </button>

        {alreadySigned ? (
          <section className="glass space-y-3 rounded-xl p-4 text-base">
            <div className="text-xl font-bold text-emerald-600">✅ 署名が完了しました</div>
            <div>署名者: {contract.signer_name ?? '—'}</div>
            <div>署名日時: {formatContractDateTime(contract.signed_at)}</div>
            <button
              type="button"
              onClick={openContractPdf}
              className="h-12 w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-lg font-semibold text-white shadow"
            >
              署名済 PDF を見る
            </button>
          </section>
        ) : (
          <section className="glass space-y-4 rounded-xl p-4">
            <div className="text-xl font-bold text-[var(--color-text)]">署名</div>
            <label className="block">
              <span className="mb-1 block text-base font-semibold text-[var(--color-text-sub)]">署名者名</span>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-3 text-base"
                placeholder="山田 太郎"
              />
            </label>
            <div>
              <div className="mb-1 text-base font-semibold text-[var(--color-text-sub)]">署名（指またはマウスで描いてください）</div>
              <SignaturePad onChange={setSignatureImage} />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-3 py-3">
                <input type="checkbox" checked={agreedContent} onChange={(e) => setAgreedContent(e.target.checked)} className="h-6 w-6 shrink-0" />
                <span className="text-base">契約内容をすべて確認し、同意します</span>
              </label>
              <label className="flex items-center gap-3 py-3">
                <input type="checkbox" checked={agreedElectronic} onChange={(e) => setAgreedElectronic(e.target.checked)} className="h-6 w-6 shrink-0" />
                <span className="text-base">契約書を電磁的方法で受け取ることに同意します</span>
              </label>
            </div>
            {submitError && <div className="text-sm text-red-500">{submitError}</div>}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="h-12 w-full rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-lg font-semibold text-white shadow-lg disabled:opacity-40"
            >
              {submitting ? '送信中…' : '署名して送信'}
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
