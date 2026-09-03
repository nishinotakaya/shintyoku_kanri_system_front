import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import {
  fetchContracts, createContract, fetchContractPdfBlob, fetchContractsZipBlob,
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_BADGE_CLASS, formatContractDate,
} from '../lib/contracts'
import { showPdfWhileLoading } from '../lib/openPdf'
import type { Contract, ContractTemplate } from '../lib/contracts'
import ContractEditor from '../components/contracts/ContractEditor'
import Modal from '../components/Modal'

// テンプレート選択カードの見た目・挙動を配列で定義(新テンプレートを増やすときはここに足す)
const TEMPLATE_OPTIONS: { template: ContractTemplate; label: string; description: string }[] = [
  { template: 'standard', label: '業務委託契約書（標準・15条）', description: '従来どおりの標準テンプレート' },
  { template: 'transport', label: '運送業務委託契約書（HAUKUR運送・全29条）', description: 'HAUKUR運送向けの全29条テンプレート' },
]

// transport テンプレート選択時のタイトル既定値
const TRANSPORT_DEFAULT_TITLE = '運送業務委託契約書'

export default function ContractsPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null)
  // 契約日フィルター(一覧と一括ダウンロードの両方に効く)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [zipBusy, setZipBusy] = useState(false)

  const load = async (filter?: { contractDateFrom?: string; contractDateTo?: string }) => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await fetchContracts(filter)
      setContracts(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    load({ contractDateFrom: dateFrom || undefined, contractDateTo: dateTo || undefined }).catch(() => {})
  }, [dateFrom, dateTo])

  // フィルターに合致する契約書PDFをzipでまとめて保存する
  const downloadZip = async () => {
    setZipBusy(true)
    try {
      const blob = await fetchContractsZipBlob({ contractDateFrom: dateFrom || undefined, contractDateTo: dateTo || undefined })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `契約書一括_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      const data = error?.response?.data
      let messageText = error?.message ?? ''
      if (data instanceof Blob) {
        try { messageText = JSON.parse(await data.text())?.error ?? messageText } catch { /* JSONでなければそのまま */ }
      } else if (data?.error) {
        messageText = data.error
      }
      alert(`一括ダウンロード失敗: ${messageText}`)
    } finally {
      setZipBusy(false)
    }
  }

  // 編集対象は id で覚えて contracts から都度引く。save/issue/void 後の onUpdated が
  // contracts 配列を更新するだけで、開いている編集画面にも自動で最新状態が反映される。
  const editingContract = useMemo(() => contracts.find((contract) => contract.id === editingId) ?? null, [contracts, editingId])

  const startCreate = async (template: ContractTemplate) => {
    setCreating(true)
    try {
      const title = template === 'transport' ? TRANSPORT_DEFAULT_TITLE : undefined
      const created = await createContract(template, title)
      setContracts((prev) => [created, ...prev])
      setEditingId(created.id)
      setTemplateModalOpen(false)
    } catch (error: any) {
      alert(`作成失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setCreating(false)
    }
  }

  // PDF はエディタと同じモーダル表示(showPdf: pdf.js 描画なのでスマホでも全ページ見える)
  const openContractPdf = async (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation()
    if (pdfLoadingId != null) return
    setPdfLoadingId(contract.id)
    try {
      await showPdfWhileLoading(`${contract.title}.pdf`, () => fetchContractPdfBlob(contract.id))
    } catch (error: any) {
      alert(`PDF 取得失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setPdfLoadingId(null)
    }
  }

  const handleUpdated = (updated: Contract) => {
    setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)))
  }
  const handleDuplicated = (created: Contract) => {
    setContracts((prev) => [created, ...prev])
    setEditingId(created.id)
  }

  if (editingContract) {
    return (
      <ContractEditor
        contract={editingContract}
        onUpdated={handleUpdated}
        onDuplicated={handleDuplicated}
        onClose={() => setEditingId(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-lg font-semibold tracking-tight">📝 契約書</div>
          <div className="text-sm text-[var(--color-text-sub)]">{contracts.length} 件</div>
        </div>
        <button
          type="button"
          onClick={() => setTemplateModalOpen(true)}
          disabled={creating}
          className="h-11 rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 text-base font-semibold text-white shadow disabled:opacity-50"
        >
          {creating ? '作成中…' : '＋ 新規作成'}
        </button>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-gray-300 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-[var(--color-text-sub)]">契約日（から）</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-11 w-full rounded-md border border-gray-300 px-2 text-base sm:w-44" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-[var(--color-text-sub)]">契約日（まで）</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-11 w-full rounded-md border border-gray-300 px-2 text-base sm:w-44" />
        </label>
        {(dateFrom || dateTo) && (
          <button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}
            className="h-11 rounded-md border border-gray-300 bg-white px-3 text-base text-[var(--color-text-sub)] hover:bg-gray-50">
            フィルター解除
          </button>
        )}
        <button
          type="button"
          onClick={downloadZip}
          disabled={zipBusy || contracts.length === 0}
          className="h-11 rounded-md border border-sky-300 bg-white px-4 text-base font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-50 sm:ml-auto"
        >
          {zipBusy ? 'zip作成中…' : `🗂 一括ダウンロード (${contracts.length}件)`}
        </button>
      </div>

      {templateModalOpen && (
        <Modal onClose={() => setTemplateModalOpen(false)} size="sm" panelClassName="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold text-[var(--color-text)]">テンプレートを選択</div>
            <button type="button" onClick={() => setTemplateModalOpen(false)} className="text-[var(--color-text-sub)] hover:text-red-500">✕</button>
          </div>
          <div className="space-y-3">
            {TEMPLATE_OPTIONS.map((option) => (
              <button
                key={option.template}
                type="button"
                onClick={() => startCreate(option.template)}
                disabled={creating}
                className="block w-full rounded-lg border border-[var(--color-border)] p-3 text-left hover:bg-fuchsia-50/40 disabled:opacity-50"
              >
                <div className="text-base font-semibold text-[var(--color-text)]">{option.label}</div>
                <div className="mt-1 text-sm text-[var(--color-text-sub)]">{option.description}</div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {loading ? (
        <div className="text-base text-[var(--color-text-sub)]">読み込み中…</div>
      ) : loadError ? (
        <div className="space-y-2">
          <div className="text-base text-red-500">読み込みに失敗しました</div>
          <button
            type="button"
            onClick={() => load()}
            className="h-11 rounded-md border border-red-300 bg-white px-4 text-base font-semibold text-red-500 hover:bg-red-50"
          >
            再試行
          </button>
        </div>
      ) : contracts.length === 0 ? (
        <div className="text-base text-[var(--color-text-sub)]">契約書がまだありません</div>
      ) : (
        <>
          {/* スマホ: カード表示 */}
          <div className="space-y-3 sm:hidden">
            {contracts.map((contract) => (
              <div
                key={contract.id}
                onClick={() => setEditingId(contract.id)}
                className="block w-full cursor-pointer rounded-xl border-2 border-gray-300 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-lg font-semibold text-[var(--color-text)]">{contract.title}</div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-sm font-semibold ${CONTRACT_STATUS_BADGE_CLASS[contract.status]}`}>
                    {CONTRACT_STATUS_LABEL[contract.status]}
                  </span>
                </div>
                <div className="mt-2 text-sm text-[var(--color-text-sub)]">乙: {contract.party_b.name || '—'}</div>
                {me?.admin && <div className="mt-1 text-sm text-[var(--color-text-sub)]">作成者: {contract.user_name}</div>}
                <div className="mt-1 flex items-center justify-between text-sm text-[var(--color-text-sub)]">
                  <span>契約日: {formatContractDate(contract.contract_date)}</span>
                  <span>更新: {formatContractDate(contract.updated_at)}</span>
                </div>
                <button
                  type="button"
                  onClick={(event) => openContractPdf(contract, event)}
                  disabled={pdfLoadingId != null}
                  className="mt-3 h-10 w-full rounded-md border border-fuchsia-300 bg-white px-3 text-sm font-semibold text-fuchsia-600 active:bg-fuchsia-50 disabled:opacity-50"
                >
                  {pdfLoadingId === contract.id ? 'PDF 生成中…' : '📄 PDF を開く'}
                </button>
              </div>
            ))}
          </div>

          {/* sm以上: テーブル表示 */}
          <div className="hidden overflow-x-auto rounded-xl border-2 border-gray-300 bg-white shadow-sm sm:block">
            <table className="w-full text-base">
              <thead className="bg-gray-100 text-[var(--color-text-sub)]">
                <tr>
                  <th className="px-3 py-3 text-left">タイトル</th>
                  <th className="px-3 py-3 text-left">乙</th>
                  <th className="px-3 py-3 text-left">状態</th>
                  <th className="px-3 py-3 text-left">契約日</th>
                  <th className="px-3 py-3 text-left">更新日</th>
                  <th className="px-3 py-3 text-left">PDF</th>
                  {me?.admin && <th className="px-3 py-3 text-left">作成者</th>}
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr
                    key={contract.id}
                    onClick={() => setEditingId(contract.id)}
                    className="cursor-pointer border-t border-gray-300 hover:bg-fuchsia-50/40"
                  >
                    <td className="px-3 py-3 font-semibold text-[var(--color-text)]">{contract.title}</td>
                    <td className="px-3 py-3">{contract.party_b.name || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded px-2 py-0.5 text-sm font-semibold ${CONTRACT_STATUS_BADGE_CLASS[contract.status]}`}>
                        {CONTRACT_STATUS_LABEL[contract.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[var(--color-text-sub)]">{formatContractDate(contract.contract_date)}</td>
                    <td className="px-3 py-3 text-[var(--color-text-sub)]">{formatContractDate(contract.updated_at)}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={(event) => openContractPdf(contract, event)}
                        disabled={pdfLoadingId != null}
                        className="rounded-md border border-fuchsia-300 bg-white px-3 py-1.5 text-sm font-semibold text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-50"
                      >
                        {pdfLoadingId === contract.id ? '生成中…' : '📄 開く'}
                      </button>
                    </td>
                    {me?.admin && <td className="px-3 py-3 text-[var(--color-text-sub)]">{contract.user_name}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
