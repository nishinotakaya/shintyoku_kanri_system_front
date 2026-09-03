import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import {
  fetchContracts, createContract, duplicateContract, fetchContractPdfBlob, fetchContractsZipBlob,
  CONTRACT_STATUS_LABEL, CONTRACT_STATUS_BADGE_CLASS, formatContractDate,
} from '../lib/contracts'
import { showPdfWhileLoading } from '../lib/openPdf'
import type { Contract } from '../lib/contracts'
import ContractEditor from '../components/contracts/ContractEditor'

// 新規作成は HAUKUR運送の業務委託契約書(全29条)のみ。テンプレート選択モーダルは廃止した。
const TRANSPORT_DEFAULT_TITLE = '運送業務委託契約書'

export default function ContractsPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null)
  // 20件を超えたらページ送り(スマホカード・PCテーブル共通)
  const [listPage, setListPage] = useState(1)
  const LIST_PAGE_SIZE = 20
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

  const startCreate = async () => {
    setCreating(true)
    try {
      const created = await createContract('transport', TRANSPORT_DEFAULT_TITLE)
      setContracts((prev) => [created, ...prev])
      setEditingId(created.id)
    } catch (error: any) {
      alert(`作成失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setCreating(false)
    }
  }

  // PDF はエディタと同じモーダル表示(showPdf: pdf.js 描画なのでスマホでも全ページ見える)
  useEffect(() => { setListPage(1) }, [dateFrom, dateTo, contracts.length])

  const pagedContracts = contracts.slice((listPage - 1) * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE)

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

  const [duplicatingId, setDuplicatingId] = useState<number | null>(null)
  const duplicateFromList = async (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation()
    if (duplicatingId != null) return
    setDuplicatingId(contract.id)
    try {
      const created = await duplicateContract(contract.id)
      setContracts((prev) => [created, ...prev])
      setEditingId(created.id)
    } catch (error: any) {
      alert(`複製失敗: ${error?.response?.data?.error ?? error?.message ?? ''}`)
    } finally {
      setDuplicatingId(null)
    }
  }

  const handleUpdated = (updated: Contract) => {
    setContracts((prev) => prev.map((contract) => (contract.id === updated.id ? updated : contract)))
  }

  if (editingContract) {
    return (
      <ContractEditor
        contract={editingContract}
        onUpdated={handleUpdated}
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
          onClick={startCreate}
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
            {pagedContracts.map((contract) => (
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
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setEditingId(contract.id) }}
                    className="h-10 rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-2 text-sm font-semibold text-white shadow active:opacity-80"
                  >
                    ✏️ 編集
                  </button>
                  <button
                    type="button"
                    onClick={(event) => duplicateFromList(contract, event)}
                    disabled={duplicatingId != null}
                    className="h-10 rounded-md border border-gray-300 bg-white px-2 text-sm font-semibold text-[var(--color-text)] active:bg-gray-50 disabled:opacity-50"
                  >
                    {duplicatingId === contract.id ? '複製中…' : '📑 複製'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => openContractPdf(contract, event)}
                    disabled={pdfLoadingId != null}
                    className="h-10 rounded-md border border-fuchsia-300 bg-white px-2 text-sm font-semibold text-fuchsia-600 active:bg-fuchsia-50 disabled:opacity-50"
                  >
                    {pdfLoadingId === contract.id ? '生成中…' : '📄 PDF'}
                  </button>
                </div>
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
                  <th className="px-3 py-3 text-left">操作</th>
                  {me?.admin && <th className="px-3 py-3 text-left">作成者</th>}
                </tr>
              </thead>
              <tbody>
                {pagedContracts.map((contract) => (
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
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setEditingId(contract.id) }}
                          className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-sm font-semibold text-white shadow hover:opacity-90"
                        >
                          ✏️ 編集
                        </button>
                        <button
                          type="button"
                          onClick={(event) => duplicateFromList(contract, event)}
                          disabled={duplicatingId != null}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-50"
                        >
                          {duplicatingId === contract.id ? '複製中…' : '📑 複製'}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => openContractPdf(contract, event)}
                          disabled={pdfLoadingId != null}
                          className="rounded-md border border-fuchsia-300 bg-white px-3 py-1.5 text-sm font-semibold text-fuchsia-600 hover:bg-fuchsia-50 disabled:opacity-50"
                        >
                          {pdfLoadingId === contract.id ? '生成中…' : '📄 PDF'}
                        </button>
                      </div>
                    </td>
                    {me?.admin && <td className="px-3 py-3 text-[var(--color-text-sub)]">{contract.user_name}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {contracts.length > LIST_PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <button onClick={() => setListPage((p) => Math.max(1, p - 1))} disabled={listPage === 1}
                className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3 disabled:opacity-40">← 前</button>
              <span className="text-[var(--color-text-sub)]">
                {(listPage - 1) * LIST_PAGE_SIZE + 1}–{Math.min(listPage * LIST_PAGE_SIZE, contracts.length)} / {contracts.length} 件
              </span>
              <button onClick={() => setListPage((p) => p + 1)} disabled={listPage * LIST_PAGE_SIZE >= contracts.length}
                className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3 disabled:opacity-40">次 →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
