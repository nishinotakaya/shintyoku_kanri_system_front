// Notion(WBS) の Excel(「プロジェクトのスケジュール」シート)ライクな表示に使う純粋関数群。
// 列幅・配色は元 xlsm の XML から実測した値をここに集約する(コンポーネント側に色コード・pxを散らさない)。
// 固定 px 幅はここに定義する日幅(DAY_WIDTH_PX)・スペーサー幅・スティッキー列幅(WBS_TABLE_COLUMNS)だけに限定する。

export const DAY_WIDTH_PX = 30
// Excel 列 I 相当。塗りなし・見出し無しの余白列(sticky には含めない)。
export const SPACER_COLUMN_WIDTH_PX = 16
// ガント範囲の上限日数。異常な日付が1件混入しても日別 th が数万個に膨らまないようにする。
export const GANTT_MAX_DAYS = 730

// Excel 列 B〜H。列 J(日数)は hidden="1" のため画面には出さない(日数計算自体は継続する)。
export const WBS_TABLE_COLUMNS = [
  { key: 'wbs_level', label: 'WBSレベル', widthPx: 100, align: 'left' as const },
  { key: 'title', label: 'タスク', widthPx: 220, align: 'left' as const },
  { key: 'assignee_name', label: '担当者', widthPx: 100, align: 'center' as const },
  { key: 'progress_rate', label: '進捗率', widthPx: 64, align: 'center' as const },
  { key: 'workload', label: '工数\n（人日）', widthPx: 64, align: 'center' as const },
  { key: 'start_date', label: '開始', widthPx: 64, align: 'center' as const },
  { key: 'end_date', label: '終了', widthPx: 64, align: 'center' as const },
] as const

// 元 xlsm のテーマ(実測)から起こした配色。コンポーネント側には直接色コードを書かず、ここから参照する。
export const WBS_EXCEL_COLORS = {
  headerBackground: '#595959',
  headerText: '#ffffff',
  inputCellBackground: '#DCE6F1', // accent1(4F81BD) tint 0.8
  unsubmittedChangeBackground: '#FF9999', // 修正後値がまだ提出済スナップショットに反映されていないセルの背景
  progressBarTrack: '#BFBFBF',
  ganttElapsedBar: '#A6A6A6',
  ganttRemainingBar: '#8064A2', // accent4
  todayLine: '#C00000',
  borderMedium: '#D9D9D9',
  borderThinWeekday: '#A6A6A6',
} as const

// スティッキー列の累積 left オフセット(px)。指定した列より左側の列幅の合計。
export function wbsColumnLeftOffset(columnIndex: number): number {
  let offset = 0
  for (let index = 0; index < columnIndex; index += 1) offset += WBS_TABLE_COLUMNS[index].widthPx
  return offset
}

// WBSレベル文字列("2.1.3")をドット区切りの数値配列に変換する。数値化できない要素は 0 として扱う。
function parseWbsLevelSegments(wbsLevel: string | null): number[] {
  if (!wbsLevel) return []
  return wbsLevel.split('.').map((segment) => {
    const value = parseInt(segment, 10)
    return Number.isNaN(value) ? 0 : value
  })
}

// WBSレベルの自然順比較（"1.2" < "1.10" のような文字列比較の誤りを避ける）。
export function compareWbsLevel(a: string | null, b: string | null): number {
  const segmentsA = parseWbsLevelSegments(a)
  const segmentsB = parseWbsLevelSegments(b)
  const length = Math.max(segmentsA.length, segmentsB.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (segmentsA[index] ?? 0) - (segmentsB[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// タスク名の先頭に付ける全角スペースのインデント。ルール: max(ドット区切りの要素数 - 2, 1) 個。
export function wbsIndent(wbsLevel: string | null): string {
  const segments = parseWbsLevelSegments(wbsLevel)
  if (segments.length === 0) return ''
  const indentCount = Math.max(segments.length - 2, 1)
  return '　'.repeat(indentCount)
}

// 'YYYY-MM-DD' 文字列を UTC 起点の Date に変換する（ローカルタイムゾーンでの日付ズレを避ける）。
export function parseDateOnly(dateText: string): Date | null {
  const [yearText, monthText, dayText] = dateText.split('-')
  const year = parseInt(yearText, 10)
  const month = parseInt(monthText, 10)
  const day = parseInt(dayText, 10)
  if (!year || !month || !day) return null
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  // "2026-02-31" のような存在しない日付は Date が翌月へ繰り上げてしまうため、往復一致で弾く。
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) return null
  return parsedDate
}

// ローカル時刻(JST等)の「今日」を、日付のみの UTC 起点 Date として返す。
export function todayDateOnly(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

// 2 つの日付のみ Date の差分日数(to - from)。
export function daysBetweenDates(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

// Excel の「プロジェクトの開始 - WEEKDAY(プロジェクトの開始,1) + 2」と同じ規則で、
// その日付が属する週の月曜日を求める(WEEKDAY type 1: 日=1,月=2,...,土=7)。
export function mondayOfExcelWeek(date: Date): Date {
  const excelWeekdayNumber = date.getUTCDay() + 1
  return addDays(date, -excelWeekdayNumber + 2)
}

// 上記の週の日曜日(月曜+6日)。
export function sundayOfExcelWeek(date: Date): Date {
  return addDays(mondayOfExcelWeek(date), 6)
}

// 'YYYY-MM-DD' を 'M/D' 表示に変換する。
export function formatDateAsMonthDay(dateText: string | null): string {
  if (!dateText) return ''
  const [, monthText, dayText] = dateText.split('-')
  if (!monthText || !dayText) return ''
  return `${parseInt(monthText, 10)}/${parseInt(dayText, 10)}`
}

// 'yyyy/m/d' 表示(プロジェクト開始日に使う。ガント上段ヘッダは月表示(formatMonthLabel)に変更済み)。
export function formatWeekStartLabel(date: Date): string {
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

// 'yyyy年m月' 表示(ガント上段ヘッダ。月ごとにグルーピングしたラベルに使う)。
export function formatMonthLabel(date: Date): string {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`
}

// ガント日別ヘッダ(行5相当)の日番号のみの表示。
export function formatDayNumber(date: Date): string {
  return String(date.getUTCDate())
}

const WEEKDAY_LETTERS = ['日', '月', '火', '水', '木', '金', '土']
export function weekdayLetter(date: Date): string {
  return WEEKDAY_LETTERS[date.getUTCDay()]
}

// Excel の表示形式 "aaa, yyyy/m/d" 相当(例: "月, 2026/8/10")。
export function formatWeekdayDateLabel(date: Date): string {
  return `${weekdayLetter(date)}, ${formatWeekStartLabel(date)}`
}

// 開始・終了(両方とも 'YYYY-MM-DD')から日数(両端含む)を計算する。片方でも無ければ null。
// 終了 < 開始 の場合も null を返す(負のバー幅を出さない)。
export function calculateDurationDays(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (!start || !end) return null
  const durationDays = daysBetweenDates(start, end) + 1
  return durationDays > 0 ? durationDays : null
}

// 進捗率に応じて塗る経過日数。Excel の条件付き書式と同じ規則: floor(日数 × 進捗率)。
export function calculateFilledDays(durationDays: number, progressRate: number | null): number {
  return Math.floor(durationDays * (progressRate ?? 0))
}

// ガントの日別グリッド（開始日から終了日まで、両端含む）を生成する。
export function buildGanttDayRange(rangeStart: Date, rangeEnd: Date): Date[] {
  const days: Date[] = []
  let cursor = rangeStart
  while (cursor.getTime() <= rangeEnd.getTime()) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

// ガントの行トラック背景（日の罫線のみ。土日の網掛けは元 xlsm に無いため付けない）。
export function ganttTrackBackgroundStyle(): { backgroundImage: string } {
  return {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0px, transparent ${DAY_WIDTH_PX - 1}px, ${WBS_EXCEL_COLORS.borderMedium} ${DAY_WIDTH_PX - 1}px, ${WBS_EXCEL_COLORS.borderMedium} ${DAY_WIDTH_PX}px)`,
  }
}
