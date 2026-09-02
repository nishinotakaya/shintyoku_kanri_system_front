// リビング(Notion)タスクの LINE 報告文面をフロント側で組み立てる。
// サーバ側 NotionLineReport (rails-backend/app/services/notion_line_report.rb) と同じ書式を保つこと。
// 変更があった項目は「修正前 → 修正後」(例: 2026/09/10 → 9/15)、無ければ現在値だけを出す。
export type NotionReportEntry = {
  title: string
  wbsLevel?: string | null
  url: string
  status?: string | null
  statusPrev?: string | null
  note?: string | null
  before: { start: string | null; end: string | null; ratePercent: number | null }
  after: { start: string | null; end: string | null; ratePercent: number | null }
}

const fullDate = (iso: string | null) => (iso ? iso.replaceAll('-', '/') : '-')

const shortDate = (iso: string | null) => {
  if (!iso) return '-'
  const [, month, day] = iso.split('-')
  return `${Number(month)}/${Number(day)}`
}

const dateLine = (before: string | null, after: string | null) => {
  if (!before && !after) return '-'
  if (!before || before === after) return fullDate(after ?? before)
  return `${fullDate(before)} → ${shortDate(after)}`
}

const percent = (value: number | null) => (value == null ? '-' : `${value}%`)

const rateLine = (before: number | null, after: number | null) => {
  if (before == null && after == null) return '-'
  if (before == null || before === after) return percent(after)
  return `${percent(before)} → ${percent(after)}`
}

export function buildNotionLineReportMessage(entries: NotionReportEntry[], reporter?: string | null): string {
  const header = `📋 進捗報告${reporter ? `（${reporter}）` : ''}`
  const sections = entries.map((entry) => {
    const lines = [`タスク: ${[entry.title, entry.wbsLevel || null].filter(Boolean).join(' ')}`]
    lines.push(`開始日: ${dateLine(entry.before.start, entry.after.start)}`)
    lines.push(`終了日: ${dateLine(entry.before.end, entry.after.end)}`)
    lines.push(`進捗率: ${rateLine(entry.before.ratePercent, entry.after.ratePercent)}`)
    if (entry.status) {
      lines.push(`ステータス: ${entry.statusPrev && entry.statusPrev !== entry.status ? `${entry.statusPrev} → ${entry.status}` : entry.status}`)
    }
    if (entry.note) lines.push(`備考: ${entry.note}`)
    lines.push('リンク')
    lines.push(entry.url)
    return lines.join('\n')
  })
  return [header, ...sections].join('\n\n')
}
