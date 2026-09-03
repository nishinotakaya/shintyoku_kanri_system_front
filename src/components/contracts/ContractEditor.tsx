import { useEffect, useRef, useState } from 'react'
import {
  contractToFormInput, updateContract, issueContract, duplicateContract, voidContract,
  fetchContractPdfBlob, formatContractDate, formatContractDateTime,
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_BADGE_CLASS,
} from '../../lib/contracts'
import type { Contract, ContractFormInput, ContractArticle } from '../../lib/contracts'
import { showPdf } from '../../lib/openPdf'
import ContractEmailModal from './ContractEmailModal'

type Props = {
  contract: Contract
  onUpdated: (contract: Contract) => void
  onDuplicated: (contract: Contract) => void
  onClose: () => void
}

// 条文一覧の React key 用に、編集画面内だけで使う安定 id を条文ごとに持たせる(並べ替え・削除で
// フォーカス/IME の状態が別の行に飛ばないように)。API へ送るときは id を落とす。
type EditableArticle = ContractArticle & { id: string }
type EditorFormState = Omit<ContractFormInput, 'articles'> & { articles: EditableArticle[] }

function generateArticleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function toEditableArticles(articles: ContractArticle[]): EditableArticle[] {
  return articles.map((article) => ({ ...article, id: generateArticleId() }))
}

// 各条文が PDF 上で何ページ目から始まるかを計算する(先頭からの改ページ回数を数えるだけの単純な採番)。
// 1条文目は常にページ1、以降 page_break_before が true になった条文からページ番号が1つ増える。
function computeArticlePageNumbers(articles: EditableArticle[]): number[] {
  let currentPageNumber = 1
  return articles.map((article) => {
    if (article.page_break_before) currentPageNumber += 1
    return currentPageNumber
  })
}

function buildEditorFormState(contract: Contract): EditorFormState {
  const base = contractToFormInput(contract)
  return { ...base, articles: toEditableArticles(base.articles) }
}

// タップ領域44px以上・iOSの入力ズーム回避(16px基準)を発行者ページでも徹底する
const inputCls = 'w-full rounded-md border border-[var(--color-border)] px-3 py-2.5 text-base disabled:bg-gray-50'
const labelCls = 'mb-1 block text-base font-semibold text-[var(--color-text-sub)]'
const iconButtonCls = 'flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-sub)] hover:bg-gray-50 disabled:opacity-30'

export default function ContractEditor({ contract, onUpdated, onDuplicated, onClose }: Props) {
  const [form, setForm] = useState<EditorFormState>(() => buildEditorFormState(contract))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidConfirming, setVoidConfirming] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)

  // 契約書を切り替えたとき(新規作成直後・別行を選択)だけフォームを作り直す。
  // save 後の再描画では contract.id は変わらないので、ユーザーの入力中の値を消さない。
  useEffect(() => {
    setForm(buildEditorFormState(contract))
    setMessage(null)
    setShareUrl(null)
    setCopyFeedback(false)
    setVoidConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id])

  const editable = contract.editable

  const updateField = (key: keyof Omit<ContractFormInput, 'articles'>, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }
  const updateArticle = (index: number, patch: Partial<ContractArticle>) => {
    setForm((prev) => ({
      ...prev,
      articles: prev.articles.map((article, articleIndex) => (articleIndex === index ? { ...article, ...patch } : article)),
    }))
  }
  const addArticle = () => {
    setForm((prev) => {
      // 一番下の「第N条」を拾って次の条番号をデフォルト入力する(第15条が最後なら 第16条)
      const lastNumberedHeading = [...prev.articles].reverse()
        .map((article) => article.heading.match(/第(\d+)条/))
        .find((match) => match != null)
      const nextArticleNumber = lastNumberedHeading ? Number(lastNumberedHeading[1]) + 1 : prev.articles.length + 1
      return {
        ...prev,
        articles: [...prev.articles, { id: generateArticleId(), heading: `第${nextArticleNumber}条`, body: '', page_break_before: false }],
      }
    })
  }
  const removeArticle = (index: number) => {
    setForm((prev) => ({ ...prev, articles: prev.articles.filter((_, articleIndex) => articleIndex !== index) }))
  }
  // 条文の並べ替えはドラッグ&ドロップ(⠿ ハンドル)。pointer events なのでスマホのタッチでも動く。
  // ドラッグ中はリストを動かさず「ここに入る」線だけ出し、指を離した瞬間に確定する
  // (ドラッグ中に入れ替えると各カードの座標が変わって判定が暴れるため)。
  const [draggingArticleId, setDraggingArticleId] = useState<string | null>(null)
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null)
  const articleCardRefs = useRef(new Map<string, HTMLDivElement>())

  const startArticleDrag = (event: React.PointerEvent<HTMLButtonElement>, articleId: string) => {
    if (!editable) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingArticleId(articleId)
    setDropInsertIndex(null)
  }

  // 挿入位置 = ドラッグ中以外のカードのうち、中心Yがポインタより上にある数(リスト全体の並びで数える)
  const computeInsertIndex = (pointerY: number): number => {
    let insertIndex = 0
    for (const article of form.articles) {
      if (article.id === draggingArticleId) continue
      const card = articleCardRefs.current.get(article.id)
      if (!card) continue
      const rect = card.getBoundingClientRect()
      if (pointerY > rect.top + rect.height / 2) insertIndex += 1
    }
    return insertIndex
  }

  const moveArticleDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingArticleId) return
    setDropInsertIndex(computeInsertIndex(event.clientY))
  }

  const endArticleDrag = () => {
    if (draggingArticleId && dropInsertIndex != null) {
      setForm((prev) => {
        const currentIndex = prev.articles.findIndex((article) => article.id === draggingArticleId)
        if (currentIndex < 0) return prev
        const nextArticles = prev.articles.filter((article) => article.id !== draggingArticleId)
        nextArticles.splice(dropInsertIndex, 0, prev.articles[currentIndex])
        return { ...prev, articles: nextArticles }
      })
    }
    setDraggingArticleId(null)
    setDropInsertIndex(null)
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      // articles の id は編集画面内の React key 用なので、API へ送る前に落とす
      const payload: ContractFormInput = {
        ...form,
        articles: form.articles.map(({ heading, body, page_break_before }) => ({ heading, body, page_break_before })),
      }
      const updated = await updateContract(contract.id, payload)
      onUpdated(updated)
      setMessage('保存しました')
    } catch (error: any) {
      alert(`保存失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setSaving(false)
    }
  }

  // PDF はモーダル表示(showPdf)。以前の別タブ方式(openPdfWindow)は廃止。
  const previewPdf = async () => {
    try {
      const blob = await fetchContractPdfBlob(contract.id)
      showPdf(blob, `${contract.title}.pdf`)
    } catch (error: any) {
      alert(`PDF 取得失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    }
  }

  const issueLink = async () => {
    setIssuing(true)
    try {
      const updated = await issueContract(contract.id)
      onUpdated(updated)
      setShareUrl(updated.share_url ?? null)
      setCopyFeedback(false)
    } catch (error: any) {
      alert(`発行失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setIssuing(false)
    }
  }

  const copyShareUrl = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      alert('コピーに失敗しました。URL を長押しして手動でコピーしてください')
    }
  }

  const sendViaLine = () => {
    if (!shareUrl) return
    const shareMessage = `${contract.title}\n下記のリンクからご確認・署名をお願いいたします。\n${shareUrl}`
    window.open(`https://line.me/R/share?text=${encodeURIComponent(shareMessage)}`, '_blank', 'noopener,noreferrer')
  }

  const duplicate = async () => {
    setDuplicating(true)
    try {
      const created = await duplicateContract(contract.id)
      onDuplicated(created)
    } catch (error: any) {
      alert(`複製失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setDuplicating(false)
    }
  }

  const confirmVoid = async () => {
    setVoiding(true)
    try {
      const updated = await voidContract(contract.id)
      onUpdated(updated)
      setVoidConfirming(false)
      // 無効化後は直前に発行したリンクの表示も消す(コピー/LINEボタンごと相手に送れる状態を残さない)
      setShareUrl(null)
    } catch (error: any) {
      alert(`無効化失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setVoiding(false)
    }
  }

  const canIssue = contract.status === 'draft' || contract.status === 'sent'
  const articlePageNumbers = computeArticlePageNumbers(form.articles)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="text-sm text-[var(--color-text-sub)] hover:text-[var(--color-text)]">
            ← 一覧に戻る
          </button>
          <span className={`rounded px-2 py-0.5 text-sm font-semibold ${CONTRACT_STATUS_BADGE_CLASS[contract.status]}`}>
            {CONTRACT_STATUS_LABEL[contract.status]}
          </span>
        </div>
        {message && <div className="text-sm text-emerald-600">{message}</div>}
      </div>

      {contract.status === 'signed' && (
        <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="font-semibold text-emerald-700">署名済み（内容の変更はできません）</div>
          <div>署名者: {contract.signer_name ?? '—'}</div>
          <div>署名日時: {formatContractDateTime(contract.signed_at)}</div>
          <div className="break-all font-mono text-sm text-emerald-700">SHA-256: {contract.content_sha256 ?? '—'}</div>
        </div>
      )}

      {contract.status === 'void' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          この契約書は無効化されています。内容の変更はできません。
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-[var(--color-border)] p-4 sm:p-5">
        <label className="block">
          <span className={labelCls}>タイトル</span>
          <input value={form.title} onChange={(e) => updateField('title', e.target.value)} disabled={!editable} className={inputCls} />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <fieldset className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
            <legend className="px-1 text-base font-semibold text-[var(--color-text-sub)]">甲</legend>
            <label className="block">
              <span className={labelCls}>会社名（個人は氏名）</span>
              <input value={form.party_a_name} onChange={(e) => updateField('party_a_name', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>住所</span>
              <input value={form.party_a_address} onChange={(e) => updateField('party_a_address', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>代表者</span>
              <input value={form.party_a_representative} onChange={(e) => updateField('party_a_representative', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
          </fieldset>
          <fieldset className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
            <legend className="px-1 text-base font-semibold text-[var(--color-text-sub)]">乙</legend>
            <label className="block">
              <span className={labelCls}>会社名（個人は氏名）</span>
              <input value={form.party_b_name} onChange={(e) => updateField('party_b_name', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>住所</span>
              <input value={form.party_b_address} onChange={(e) => updateField('party_b_address', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>代表者</span>
              <input value={form.party_b_representative} onChange={(e) => updateField('party_b_representative', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>メールアドレス（メール送付の宛先）</span>
              <input type="email" value={form.party_b_email} onChange={(e) => updateField('party_b_email', e.target.value)} disabled={!editable} className={inputCls} />
            </label>
          </fieldset>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={labelCls}>契約日</span>
            <input type="date" value={form.contract_date} onChange={(e) => updateField('contract_date', e.target.value)} disabled={!editable} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>開始日</span>
            <input type="date" value={form.start_on} onChange={(e) => updateField('start_on', e.target.value)} disabled={!editable} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>終了日</span>
            <input type="date" value={form.end_on} onChange={(e) => updateField('end_on', e.target.value)} disabled={!editable} className={inputCls} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-[var(--color-text-sub)]">条文</span>
            {editable && (
              <button type="button" onClick={addArticle} className="h-11 rounded-md border border-[var(--color-border)] px-3 text-base font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">
                ＋ 条文を追加
              </button>
            )}
          </div>
          <div className="space-y-4">
            {form.articles.map((article, index) => {
              const articlePageNumber = articlePageNumbers[index]
              // ドラッグ中: 自分より前にある「ドラッグ中以外」のカード数 = このカードの挿入前位置
              const positionAmongOthers = form.articles.slice(0, index).filter((a) => a.id !== draggingArticleId).length
              const showDropLineBefore = draggingArticleId != null && article.id !== draggingArticleId
                && dropInsertIndex === positionAmongOthers
              return (
                <div key={article.id}
                  ref={(element) => {
                    if (element) articleCardRefs.current.set(article.id, element)
                    else articleCardRefs.current.delete(article.id)
                  }}
                  className={draggingArticleId === article.id ? 'opacity-70' : undefined}>
                  {showDropLineBefore && <div className="mb-2 h-1 rounded bg-fuchsia-400" />}
                  {article.page_break_before && (
                    <div className="mb-2 flex items-center gap-2 border-t-2 border-dashed border-fuchsia-300 pt-2">
                      <span className="text-sm font-semibold text-fuchsia-600">ページ {articlePageNumber}</span>
                      <span className="text-sm text-[var(--color-text-sub)]">（ここから新しいページ）</span>
                    </div>
                  )}
                  <div className={`space-y-3 rounded-lg border p-3 ${draggingArticleId === article.id ? 'border-fuchsia-400 ring-2 ring-fuchsia-200' : 'border-[var(--color-border)]'}`}>
                    <div className="flex items-center gap-2">
                      {editable && (
                        <button type="button"
                          onPointerDown={(e) => startArticleDrag(e, article.id)}
                          onPointerMove={moveArticleDrag}
                          onPointerUp={endArticleDrag}
                          onPointerCancel={endArticleDrag}
                          aria-label="ドラッグして並べ替え" title="ドラッグして並べ替え"
                          className={`${iconButtonCls} shrink-0 touch-none select-none cursor-grab active:cursor-grabbing`}>⠿</button>
                      )}
                      <input
                        value={article.heading}
                        onChange={(e) => updateArticle(index, { heading: e.target.value })}
                        disabled={!editable}
                        placeholder="第1条（目的）"
                        className={`${inputCls} flex-1 font-semibold`}
                      />
                      {editable && (
                        <button type="button" onClick={() => removeArticle(index)}
                          aria-label="この条文を削除" title="この条文を削除"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-500 hover:bg-red-50">✕</button>
                      )}
                    </div>
                    <textarea
                      value={article.body}
                      onChange={(e) => updateArticle(index, { body: e.target.value })}
                      disabled={!editable}
                      rows={4}
                      className={inputCls}
                    />
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-sub)]">
                      <input
                        type="checkbox"
                        checked={article.page_break_before ?? false}
                        onChange={(e) => updateArticle(index, { page_break_before: e.target.checked })}
                        disabled={!editable}
                        className="accent-fuchsia-500"
                      />
                      ここから新しいページ
                    </label>
                  </div>
                </div>
              )
            })}
            {draggingArticleId != null
              && dropInsertIndex === form.articles.filter((a) => a.id !== draggingArticleId).length
              && <div className="h-1 rounded bg-fuchsia-400" />}
            {form.articles.length === 0 && (
              <div className="text-sm text-[var(--color-text-sub)]">条文がありません（＋ 条文を追加 で追加）</div>
            )}
            {editable && form.articles.length > 0 && (
              <button type="button" onClick={addArticle}
                className="h-11 w-full rounded-md border border-dashed border-fuchsia-300 text-base font-semibold text-fuchsia-600 hover:bg-fuchsia-50">
                ＋ 条文を追加
              </button>
            )}
          </div>
        </div>

        <label className="block">
          <span className={labelCls}>特記事項</span>
          <textarea value={form.special_terms} onChange={(e) => updateField('special_terms', e.target.value)} disabled={!editable} rows={3} className={inputCls} />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        {editable && (
          <button type="button" onClick={save} disabled={saving}
            className="h-11 rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-4 text-base font-semibold text-white shadow disabled:opacity-50">
            {saving ? '保存中…' : '💾 保存'}
          </button>
        )}
        <button type="button" onClick={previewPdf}
          className="h-11 rounded-md border border-[var(--color-border)] bg-white px-4 text-base font-semibold text-[var(--color-text)] hover:bg-gray-50">
          {contract.status === 'signed' ? '📄 署名済 PDF' : '📄 PDF プレビュー'}
        </button>
        {canIssue && (
          <button type="button" onClick={issueLink} disabled={issuing}
            className="h-11 rounded-md bg-gradient-to-r from-sky-500 to-cyan-500 px-4 text-base font-semibold text-white shadow disabled:opacity-50">
            {issuing ? '発行中…' : '🔗 署名リンクを発行'}
          </button>
        )}
        {canIssue && (
          <button type="button" onClick={() => setEmailModalOpen(true)}
            className="h-11 rounded-md bg-gradient-to-r from-sky-500 to-blue-500 px-4 text-base font-semibold text-white shadow">
            📧 メールで送付
          </button>
        )}
        <button type="button" onClick={duplicate} disabled={duplicating}
          className="h-11 rounded-md border border-[var(--color-border)] bg-white px-4 text-base font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50">
          {duplicating ? '複製中…' : '📑 複製'}
        </button>
        {contract.status === 'sent' && (
          voidConfirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-semibold text-red-600">本当に無効にしますか？</span>
              <button type="button" onClick={confirmVoid} disabled={voiding}
                className="h-11 rounded-md bg-red-500 px-4 text-base font-semibold text-white shadow disabled:opacity-50">
                {voiding ? '処理中…' : 'はい、無効にする'}
              </button>
              <button type="button" onClick={() => setVoidConfirming(false)}
                className="h-11 rounded-md border border-[var(--color-border)] bg-white px-4 text-base text-[var(--color-text-sub)]">
                キャンセル
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setVoidConfirming(true)}
              className="h-11 rounded-md border border-red-300 bg-white px-4 text-base font-semibold text-red-500 hover:bg-red-50">
              🚫 無効にする
            </button>
          )
        )}
      </div>

      {shareUrl && contract.status === 'sent' && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <div className="text-sm font-semibold text-sky-700">署名リンクを発行しました</div>
          <div className="break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-[var(--color-text)]">{shareUrl}</div>
          <div className="text-sm text-[var(--color-text-sub)]">有効期限: {formatContractDate(contract.share_expires_at)}</div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={copyShareUrl}
              className="h-11 rounded-md border border-sky-300 bg-white px-4 text-base font-semibold text-sky-700 hover:bg-sky-100">
              {copyFeedback ? '✅ コピーしました' : '📋 コピー'}
            </button>
            <button type="button" onClick={sendViaLine}
              className="h-11 rounded-md bg-[#06C755] px-4 text-base font-semibold text-white shadow hover:opacity-90">
              LINE で送る
            </button>
          </div>
        </div>
      )}
      {emailModalOpen && (
        <ContractEmailModal
          contract={contract}
          onClose={() => setEmailModalOpen(false)}
          onSent={(updated) => {
            onUpdated(updated)
            setShareUrl(updated.share_url ?? null)
          }}
        />
      )}
    </div>
  )
}
