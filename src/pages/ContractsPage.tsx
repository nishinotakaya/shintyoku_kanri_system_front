import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import {
  fetchContracts, createContract, fetchContractPdfBlob,
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_BADGE_CLASS, formatContractDate,
} from '../lib/contracts'
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

  const load = async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await fetchContracts()
      setContracts(data)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<Me>('/me').then((r) => setMe(r.data)).catch(() => {})
    load().catch(() => {})
  }, [])

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

  // PDF を別タブで開く(ブラウザの PDF ビューアからそのままダウンロードできる)。
  // ポップアップブロック対策で、クリック直後に空タブを確保してから blob を流し込む。
  const openContractPdf = async (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation()
    if (pdfLoadingId != null) return
    const newTab = window.open('', '_blank')
    setPdfLoadingId(contract.id)
    try {
      const blob = await fetchContractPdfBlob(contract.id)
      const url = URL.createObjectURL(new File([blob], `${contract.title}.pdf`, { type: 'application/pdf' }))
      if (newTab) newTab.location.href = url
      else window.open(url, '_blank')
    } catch (error: any) {
      newTab?.close()
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
                className="block w-full cursor-pointer rounded-xl border border-[var(--color-border)] bg-white p-4 text-left shadow-sm active:scale-[0.99]"
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
                  {pdfLoadingId === contract.id ? 'PDF 生成中…' : '📄 PDF を開く（別タブ）'}
                </button>
              </div>
            ))}
          </div>

          {/* sm以上: テーブル表示 */}
          <div className="hidden overflow-x-auto rounded-xl border border-[var(--color-border)] bg-white shadow-sm sm:block">
            <table className="w-full text-base">
              <thead className="bg-gray-50 text-[var(--color-text-sub)]">
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
                    className="cursor-pointer border-t border-[var(--color-border)] hover:bg-fuchsia-50/40"
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
