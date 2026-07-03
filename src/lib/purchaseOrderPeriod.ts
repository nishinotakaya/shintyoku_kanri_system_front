// 注文書まわりの「締日ベース月次サイクル」計算ヘルパー。
// PurchaseOrderForm と PurchaseOrdersPage の両方で使う共通ロジック。

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toIso = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

const fmtSlash = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}/${m}/${d}`
}

// 期間を「closingDay 締め」で分割（例: 4/1〜5/25 かつ 25日締め → [4/1〜4/25, 4/26〜5/25]）
export const splitByClosingDay = (start: string, end: string, closingDay: number): Array<{ from: string; to: string }> => {
  const e = parseIso(end)
  const periods: Array<{ from: string; to: string }> = []
  let cur = parseIso(start)
  while (cur <= e) {
    let closeM = cur.getMonth()
    if (cur.getDate() > closingDay) closeM += 1
    const close = new Date(cur.getFullYear(), closeM, closingDay)
    const periodEnd = close <= e ? close : e
    periods.push({ from: toIso(cur), to: toIso(periodEnd) })
    const next = new Date(periodEnd)
    next.setDate(next.getDate() + 1)
    cur = next
  }
  return periods
}

// 注文書 PDF の「納品期限」表記を組み立て: "6/25, 7/25, 8/25"
export const buildDeliveryDeadline = (periodStart: string | null | undefined, periodEnd: string | null | undefined, closingDay: number = 25): string => {
  if (!periodStart || !periodEnd) return ''
  return splitByClosingDay(periodStart, periodEnd, closingDay).map((p) => fmtSlash(p.to)).join(', ')
}
