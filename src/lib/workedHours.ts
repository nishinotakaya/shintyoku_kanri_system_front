// 'HH:MM' の開始/終了から稼働時間(時間)を出す。終了が開始より前なら日をまたいだ稼働として +24h する
// (運送は深夜またぎの配送があるため)。どちらかが空なら 0。
export function workedHoursBetween(clockIn?: string | null, clockOut?: string | null): number {
  if (!clockIn || !clockOut) return 0
  const [startHour, startMinute] = clockIn.split(':').map(Number)
  const [endHour, endMinute] = clockOut.split(':').map(Number)
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0
  const startMinutes = startHour * 60 + startMinute
  const endMinutes = endHour * 60 + endMinute
  const diffMinutes = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes
  return diffMinutes / 60
}
