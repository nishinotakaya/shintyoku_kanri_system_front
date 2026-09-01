// 締日ベースの対象期間(◯月度)の計算。カレンダーの見出しと集計の両方で使うので、
// バックエンドの User#period_for(rails-backend/app/models/user.rb) と同じ意味論をここ1箇所に置く。

// その月の末日。closingDay=31 等の「末日締め」で月によって末日が変わる(2月など)場合の丸めに使う。
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// その月度の締日。締日が月末日より後ろなら月末日に丸める。
export function closingDateOf(year: number, month: number, closingDay: number): Date {
  return new Date(year, month - 1, Math.min(closingDay, lastDayOfMonth(year, month)))
}

// 締日期間の開始日/終了日。開始日は「前月度の締日の翌日」。
// 例: closingDay=25 の2026年9月度 → 2026-08-26〜2026-09-25
//     closingDay=31(末日締め)の2026年9月度 → 2026-09-01〜2026-09-30
export function billingPeriodRange(year: number, month: number, closingDay: number): { start: Date; end: Date } {
  const end = closingDateOf(year, month, closingDay)
  const previousMonthYear = month === 1 ? year - 1 : year
  const previousMonth = month === 1 ? 12 : month - 1
  const previousEnd = closingDateOf(previousMonthYear, previousMonth, closingDay)
  const start = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() + 1)
  return { start, end }
}

// Date → 'YYYY-MM-DD'(勤怠レコードの work_date と突き合わせる形式)
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 'YYYY-MM-DD' → 'YYYY年M月D日'(見出し表示用)
export function formatJpDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return `${year}年${month}月${day}日`
}
