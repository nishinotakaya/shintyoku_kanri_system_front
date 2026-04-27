// 締日基準の「現在所属している請求月」を返す。
// 例: closingDay=25, today=4/27 → 5月分（4/26〜5/25 期間）
//     closingDay=25, today=4/25 → 4月分
export function billingMonthForToday(closingDay = 25, now: Date = new Date()): { year: number; month: number } {
  if (now.getDate() > closingDay) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { year: next.getFullYear(), month: next.getMonth() + 1 }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}
