// 請求書の明細(品目)エディタ。請求書「作成」「編集」「統合PDF編集」「ラボップ宛」の各モーダル共通の _form パーシャル。
// レイアウトは実際の請求書PDF(invoice.html.erb)と同じテーブル体裁: 品番・品名 / 数量 / 単位 / 単価 / 金額。
// 数量・単価を変更すると金額を qty×unit_price で自動計算する（金額の直接入力も可）。
export type InvoiceItem = { label: string; qty: number; unit: string; unit_price: number; amount: number }

// 新規明細行の初期値（各モーダル共通）
export const emptyInvoiceItem = (): InvoiceItem => ({ label: '', qty: 1, unit: '式', unit_price: 0, amount: 0 })

// 明細1行へ patch を適用する共通ロジック。数量か単価が変わったら金額を qty×unit_price で再計算する。
// 作成/編集/統合/ラボップ宛の各モーダルが同じ挙動になるよう、ここに一本化する。
export function applyInvoiceItemPatch(items: InvoiceItem[], index: number, patch: Partial<InvoiceItem>): InvoiceItem[] {
  return items.map((item, idx) => {
    if (idx !== index) return item
    const next = { ...item, ...patch }
    if ('qty' in patch || 'unit_price' in patch) next.amount = Math.round((Number(next.qty) || 0) * (Number(next.unit_price) || 0))
    return next
  })
}

// 明細から 小計(税抜)/消費税/合計(税込) を出す。サーバ(InvoicePdfRenderer#calculation)と同じ式。
//   税抜: 小計=明細合計、消費税=小計×税率(四捨五入)、合計=小計+消費税
//   税込: 合計=明細合計、小計=合計÷(1+税率)(四捨五入)、消費税=合計−小計
export function invoiceTotals(items: InvoiceItem[], taxRate: number, taxIncluded: boolean): { subtotal: number; tax: number; total: number } {
  const itemsSum = items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0)
  if (taxIncluded) {
    const subtotal = Math.round(itemsSum / (1 + taxRate / 100))
    return { subtotal, tax: itemsSum - subtotal, total: itemsSum }
  }
  const tax = Math.round((itemsSum * taxRate) / 100)
  return { subtotal: itemsSum, tax, total: itemsSum + tax }
}

type Props = {
  items: InvoiceItem[]
  category: string                                   // 税率判定 (resystems/techleaders は 0%)
  onUpdate: (index: number, patch: Partial<InvoiceItem>) => void
  onAdd: () => void
  onRemove: (index: number) => void
  showTotals?: boolean                               // 小計/消費税/税込の表示 (既定 true)
  taxIncluded?: boolean                              // 税込(内税)設定のユーザー: 明細合計がそのまま税込合計
}

const CELL = 'w-full rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300'

export default function InvoiceItemsEditor({ items, category, onUpdate, onAdd, onRemove, showTotals = true, taxIncluded = false }: Props) {
  const taxRate = category === 'resystems' || category === 'techleaders' ? 0 : 10
  const { subtotal, tax, total } = invoiceTotals(items, taxRate, taxIncluded)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold text-[var(--color-text)]">明細</div>
        <button type="button" onClick={onAdd}
          className="rounded-md whitespace-nowrap border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-sub)] hover:bg-gray-50">＋ 行追加</button>
      </div>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-left text-[var(--color-text-sub)]">
            <th className="py-1 pr-1 font-semibold">品番・品名</th>
            <th className="py-1 px-1 font-semibold w-14">数量</th>
            <th className="py-1 px-1 font-semibold w-12">単位</th>
            <th className="py-1 px-1 font-semibold w-24">単価</th>
            <th className="py-1 px-1 font-semibold w-24">金額</th>
            <th className="py-1 pl-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-[var(--color-border)]">
              <td className="py-1 pr-1"><input value={it.label} onChange={(e) => onUpdate(i, { label: e.target.value })} className={CELL} /></td>
              <td className="py-1 px-1"><input type="number" step="0.5" value={it.qty} onChange={(e) => onUpdate(i, { qty: Number(e.target.value) })} className={`${CELL} text-right font-mono tabular-nums`} /></td>
              <td className="py-1 px-1"><input value={it.unit} onChange={(e) => onUpdate(i, { unit: e.target.value })} className={CELL} /></td>
              <td className="py-1 px-1"><input type="number" value={it.unit_price} onChange={(e) => onUpdate(i, { unit_price: Number(e.target.value) })} className={`${CELL} text-right font-mono tabular-nums`} /></td>
              <td className="py-1 px-1"><input type="number" value={it.amount} onChange={(e) => onUpdate(i, { amount: Number(e.target.value) })} className={`${CELL} text-right font-mono tabular-nums`} /></td>
              <td className="py-1 pl-1 text-center"><button type="button" onClick={() => onRemove(i)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={6} className="py-1 text-center text-[10px] text-[var(--color-text-sub)]">明細なし（＋行追加 で追加）</td></tr>}
        </tbody>
        {showTotals && items.length > 0 && (
          <tfoot>
            <tr className="border-t border-[var(--color-border)]">
              <td colSpan={4} className="py-1 pr-1 text-right text-[var(--color-text-sub)]">
                小計（税抜）¥{subtotal.toLocaleString()} ／ {taxIncluded ? '内消費税' : '消費税'}{taxRate}% ¥{tax.toLocaleString()}
              </td>
              <td className="py-1 px-1 text-right font-mono tabular-nums font-semibold text-sky-700">¥{total.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
