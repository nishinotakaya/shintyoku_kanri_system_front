// 運送(transport)の報酬形態。設定(請求書設定)で 時給 / 日給 を選ぶ。
//   時給: 稼働時間 × 時給
//   日給: 稼働日数 × 日給 ＋ 所定時間を超えた分 × 超過時給(残業)
// 超過は「日ごとの超過を足す」— 月の合計時間から所定時間を引くのではない。
export type TransportPaySetting = {
  pay_type: 'hourly' | 'daily'
  unit_price: number | null
  daily_rate: number | null
  standard_hours: number | null
  overtime_unit_price: number | null
}

export const DEFAULT_STANDARD_HOURS = 8

export function isDailyPay(setting?: TransportPaySetting | null): boolean {
  return setting?.pay_type === 'daily'
}

export function standardHoursOf(setting?: TransportPaySetting | null): number {
  const hours = Number(setting?.standard_hours ?? 0)
  return hours > 0 ? hours : DEFAULT_STANDARD_HOURS
}

// その日の超過(残業)時間。日給のときだけ意味を持つ
export function overtimeHoursOf(workedHours: number, setting?: TransportPaySetting | null): number {
  if (!isDailyPay(setting)) return 0
  return Math.max(workedHours - standardHoursOf(setting), 0)
}
