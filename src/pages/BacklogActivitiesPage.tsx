import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { toast } from '../lib/toast'
import { downloadBlob } from '../lib/downloadBlob'
import { effectiveTaskValue, hasTaskOverride, isRedCell, type NotionTaskEffectiveField } from '../lib/notionTaskEffective'
import {
  DAY_WIDTH_PX,
  GANTT_MAX_DAYS,
  SPACER_COLUMN_WIDTH_PX,
  WBS_EXCEL_COLORS,
  WBS_TABLE_COLUMNS,
  addDays,
  buildGanttDayRange,
  calculateDurationDays,
  calculateFilledDays,
  compareWbsLevel,
  daysBetweenDates,
  formatDateAsMonthDay,
  formatDayNumber,
  formatMonthLabel,
  formatWeekdayDateLabel,
  ganttTrackBackgroundStyle,
  mondayOfExcelWeek,
  parseDateOnly,
  sundayOfExcelWeek,
  todayDateOnly,
  wbsColumnLeftOffset,
  wbsIndent,
  weekdayLetter,
} from '../lib/wbsGantt'

type Target = { id: number; display_name: string; email: string; activity_count: number }
type MonthSummary = {
  month: string
  issue_count: number
  commit_count: number
  report_count: number
  status_count: number
}
type Activity = {
  id: number
  issue_key: string
  summary: string | null
  activity_type: 'comment' | 'status' | 'commit' | 'assigner'
  type_label: string
  content: string | null
  occurred_on: string | null
  month: string
  url: string
}
// 上司報告用サマリの1行（テンプレート gid=0 と同じ列構成）
type SummaryRow = {
  month: string
  issue_key: string
  summary: string
  status: string
  computed_status: string
  status_override: string
  start_on: string
  shori_on: string
  done_on: string
  note: string
  notion_block_id: string // 手動で紐付けた NotionTask（未紐付けは ""）
  url: string | null
}
// Notion(WBS) タスク。サマリ行のセレクトボックスで紐付け、予定/工数/進捗を上司報告に取り込む。
type NotionTaskOption = {
  notion_block_id: string
  assignee_name: string | null
  assignee_name_prev?: string | null // 修正後(担当者)
  wbs_level: string | null
  title: string
  title_prev?: string | null // 修正後(タスク名)
  start_date: string | null
  end_date: string | null
  start_date_prev: string | null // 修正後(開始日)。Notion 同期値 start_date が修正前
  end_date_prev: string | null
  workload: number | null
  workload_prev?: number | null // 修正後(工数)
  progress_rate: number | null // 0.0〜1.0
  progress_rate_prev: number | null
  status: string | null
  status_prev: string | null
  priority: string | null
  note: string
  memo: string
  // 提出済スナップショット。キーは title/assignee_name/workload/start_date/end_date/progress_rate。
  wbs_submitted_overrides?: Record<string, string> | null
  // 登録済み Excel テンプレ(xlsm)の該当 WBS 行の値。テンプレ未登録・該当行が無い場合は null。
  wbs_template_values?: {
    progress_rate: number | null
    workload: number | null
    start_date: string | null
    end_date: string | null
  } | null
}
// Excel テンプレ(進捗報告書 .xlsm)の登録状況
type WbsExcelTemplateInfo = {
  file_name: string
  uploaded_at: string
  uploaded_by_name: string
  project_title?: string | null // テンプレ内 B1(プロジェクト名)。無ければ空表示
  company_name?: string | null // テンプレ内 B2(会社名)
  project_start?: string | null // テンプレ内 G3('YYYY-MM-DD')。ガント起点にも使う
}
type Payload = {
  user: { id: number; display_name: string; email: string }
  summary: MonthSummary[]
  summary_rows: SummaryRow[]
  status_legend: string[]
  notion_tasks: NotionTaskOption[]
  activities: Activity[]
  synced_at: string | null
}

// 既定の出力／取込先テンプレート（川村_タスク）
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1fUMfik4FnsqIZgVQv-IwJf5HkH7JN1Lf7VyiP_C9pAo/edit'
// 主_リビング_進捗管理_川村_西野 の Notion(WBS) タブ。アプリ→スプシの出力は廃止（シートは人が編集するマスタ）
const NOTION_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1rhRJ8vr3m8_HRZsawMR61r5PI0DcgzYZslHez43LZ8I/edit#gid=1287451848'
const STATUS_OPTIONS = ['処理中', '処理済み', '完了'] as const

const TYPE_STYLE: Record<Activity['activity_type'], string> = {
  comment: 'bg-emerald-100 text-emerald-700',
  status: 'bg-amber-100 text-amber-700',
  commit: 'bg-slate-100 text-slate-600',
  assigner: 'bg-violet-100 text-violet-700',
}

export default function BacklogActivitiesPage() {
  const [targets, setTargets] = useState<Target[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [view, setView] = useState<'summary' | 'detail' | 'notion'>('summary')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingNotion, setSyncingNotion] = useState(false)
  const [importingDocs, setImportingDocs] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importingNotion, setImportingNotion] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string; url?: string } | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({})
  // スプシ出力先。Backlog(上司報告) と Notion(WBS) を別スプレッドシートに分けられる。
  const [showSheetUrls, setShowSheetUrls] = useState(false)
  const [backlogSheetUrl, setBacklogSheetUrl] = useState(DEFAULT_SHEET_URL)
  const [notionSheetUrl, setNotionSheetUrl] = useState(NOTION_SHEET_URL)

  useEffect(() => {
    api
      .get<Target[]>('/backlog_activities/targets')
      .then((r) => {
        setTargets(r.data)
        const def = [...r.data].sort((a, b) => b.activity_count - a.activity_count)[0]
        if (def) setSelectedUserId(def.id)
      })
      .catch(() => setNotice({ kind: 'err', text: '対象ユーザーの取得に失敗しました' }))
  }, [])

  // 対応ログ・Notion(WBS)を含む Payload 全体を取得し直す。NotionView の再取得(onReload)にも使う。
  const fetchData = async (userId: number) => {
    const r = await api.get<Payload>('/backlog_activities', { params: { user_id: userId } })
    setData(r.data)
    const latest = r.data.summary.at(-1)?.month
    setOpenMonths(latest ? { [latest]: true } : {})
  }

  useEffect(() => {
    if (selectedUserId == null) return
    setLoading(true)
    setNotice(null)
    fetchData(selectedUserId)
      .catch(() => setNotice({ kind: 'err', text: '対応ログの取得に失敗しました' }))
      .finally(() => setLoading(false))
  }, [selectedUserId])

  const sync = async () => {
    if (selectedUserId == null) return
    setSyncing(true)
    setNotice(null)
    try {
      const r = await api.post<Payload>('/backlog_activities/sync', null, { params: { user_id: selectedUserId } })
      setData(r.data)
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? '同期に失敗しました' })
    } finally {
      setSyncing(false)
    }
  }

  // Notion(WBS) を Notion 本体から最新取得（同期）し、続けてスプレッドシートの「修正後」を取り込む。
  const syncNotion = async () => {
    if (selectedUserId == null) return
    setSyncingNotion(true)
    setNotice(null)
    try {
      const r = await api.post<{ synced: number }>('/notion_tasks/sync')
      if (!notionSheetUrl.trim()) {
        const p = await api.get<Payload>('/backlog_activities', { params: { user_id: selectedUserId } })
        setData(p.data)
        setNotice({ kind: 'ok', text: `Notion から ${r.data.synced} 件のタスクを同期しました。` })
        return
      }
      try {
        const imp = await api.post<Payload & { notion_imported: { imported_rows: number; skipped_rows: number; url: string } }>(
          '/backlog_activities/import_notion',
          { spreadsheet_url: notionSheetUrl },
          { params: { user_id: selectedUserId } },
        )
        setData(imp.data)
        setNotice({
          kind: 'ok',
          text: `Notion から ${r.data.synced} 件同期し、スプレッドシートから ${imp.data.notion_imported.imported_rows} 行（修正後）を取り込みました。`,
          url: imp.data.notion_imported.url,
        })
      } catch (e: any) {
        const p = await api.get<Payload>('/backlog_activities', { params: { user_id: selectedUserId } })
        setData(p.data)
        setNotice({ kind: 'err', text: `Notion 同期は完了しましたが、スプレッドシート取込に失敗しました: ${e?.response?.data?.error ?? '不明なエラー'}` })
      }
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'Notion 同期に失敗しました' })
    } finally {
      setSyncingNotion(false)
    }
  }

  // Notion ドキュメントハブの資料URLを備考「資料:カテゴリ」行へまとめて取り込む
  const importDocHub = async () => {
    if (selectedUserId == null) return
    setImportingDocs(true)
    setNotice(null)
    try {
      const r = await api.post<Payload & { doc_hub: { category: string; links: number }[] }>(
        '/backlog_activities/import_doc_hub', null, { params: { user_id: selectedUserId } })
      setData(r.data)
      const total = (r.data.doc_hub ?? []).reduce((sum, group) => sum + group.links, 0)
      setNotice({ kind: 'ok', text: `資料リンクを備考に取り込みました（${(r.data.doc_hub ?? []).length}カテゴリ / ${total}リンク）` })
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? '資料リンクの取込に失敗しました' })
    } finally {
      setImportingDocs(false)
    }
  }

  const exportSheet = async () => {
    if (selectedUserId == null) return
    setExporting(true)
    setNotice(null)
    try {
      const r = await api.post<{ url: string; appended_rows?: number; filled_dates?: number }>(
        '/backlog_activities/export',
        { spreadsheet_url: backlogSheetUrl },
        { params: { user_id: selectedUserId } },
      )
      setNotice({ kind: 'ok', text: `Backlog サマリを書き出しました（追加 ${r.data.appended_rows ?? 0} 行 / 日付補完 ${r.data.filled_dates ?? 0} 件）。`, url: r.data.url })
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'スプレッドシートへの書き出しに失敗しました' })
    } finally {
      setExporting(false)
    }
  }

  // Notion(WBS) シートの「修正後」値を notion_tasks へ取り込む（スプシ→アプリ）。
  const importNotion = async () => {
    if (selectedUserId == null) return
    if (!notionSheetUrl.trim()) {
      setShowSheetUrls(true)
      setNotice({ kind: 'err', text: 'Notion 取込元スプレッドシートの URL を入力してください（「⚙ 出力先」で設定）。' })
      return
    }
    setImportingNotion(true)
    setNotice(null)
    try {
      const r = await api.post<Payload & { notion_imported: { imported_rows: number; skipped_rows: number; url: string } }>(
        '/backlog_activities/import_notion',
        { spreadsheet_url: notionSheetUrl },
        { params: { user_id: selectedUserId } },
      )
      setData(r.data)
      setView('notion')
      setNotice({ kind: 'ok', text: `Notion(WBS) をスプレッドシートから ${r.data.notion_imported.imported_rows} 行取り込みました（対象外 ${r.data.notion_imported.skipped_rows} 行）。`, url: r.data.notion_imported.url })
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'Notion のスプレッドシート取込に失敗しました' })
    } finally {
      setImportingNotion(false)
    }
  }

  const importSheet = async () => {
    if (selectedUserId == null) return
    setImporting(true)
    setNotice(null)
    try {
      const r = await api.post<Payload & { imported: { imported_rows: number; url: string } }>(
        '/backlog_activities/import',
        { spreadsheet_url: backlogSheetUrl },
        { params: { user_id: selectedUserId } },
      )
      setData(r.data)
      setView('summary')
      setNotice({ kind: 'ok', text: `スプレッドシートから ${r.data.imported.imported_rows} 行の備考/状態を取り込みました。`, url: r.data.imported.url })
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'スプレッドシートからの取り込みに失敗しました' })
    } finally {
      setImporting(false)
    }
  }

  const saveNote = async (row: SummaryRow, patch: { note?: string; status_override?: string; notion_block_id?: string }) => {
    if (selectedUserId == null) return
    const key = `${row.month}|${row.issue_key}`
    setSavingKey(key)
    try {
      const r = await api.patch<{ ok: boolean; summary_rows: SummaryRow[] }>(
        '/backlog_activities/note',
        { month: row.month, issue_key: row.issue_key, ...patch },
        { params: { user_id: selectedUserId } },
      )
      setData((prev) => (prev ? { ...prev, summary_rows: r.data.summary_rows } : prev))
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? '備考の保存に失敗しました' })
    } finally {
      setSavingKey(null)
    }
  }

  // Notion(WBS) の「修正後」(prev 列) をダブルクリック編集 → 即時反映(楽観更新)＋永続化。
  const saveNotionTask = async (notionBlockId: string, patch: Record<string, string>) => {
    setData((prev) => (prev ? { ...prev, notion_tasks: prev.notion_tasks.map((t) => (t.notion_block_id === notionBlockId ? applyNotionPatch(t, patch) : t)) } : prev))
    try {
      const r = await api.patch<{ ok: boolean; notion_tasks: NotionTaskOption[] }>(
        '/backlog_activities/notion_task',
        { notion_block_id: notionBlockId, ...patch },
        { params: { user_id: selectedUserId } },
      )
      setData((prev) => (prev ? { ...prev, notion_tasks: r.data.notion_tasks } : prev))
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'Notion タスクの更新に失敗しました' })
    }
  }

  const byMonth = useMemo(() => {
    const map: Record<string, Activity[]> = {}
    for (const a of data?.activities ?? []) (map[a.month] ??= []).push(a)
    return map
  }, [data])

  const months = useMemo(
    () => [...(data?.summary ?? [])].sort((a, b) => b.month.localeCompare(a.month)),
    [data],
  )

  const summaryRows = useMemo(
    () => [...(data?.summary_rows ?? [])].sort((a, b) => b.month.localeCompare(a.month) || a.issue_key.localeCompare(b.issue_key)),
    [data],
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">📈 Backlog 対応ログ</h1>
          <p className="text-sm text-slate-500 mt-0.5">上司報告用のサマリと、Backlog 活動の詳細ログ。スプレッドシートと相互にエクスポート／インポートできます。</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            value={selectedUserId ?? ''}
            onChange={(e) => setSelectedUserId(Number(e.target.value))}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}（{t.activity_count}件）
              </option>
            ))}
          </select>
          {/* 最新取得（サービス本体 → アプリ） */}
          <button onClick={sync} disabled={syncing || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            title="Backlog から最新の対応ログをアプリに取り込む">
            {syncing ? '同期中…' : '🔄 Backlog を同期'}
          </button>
          <button onClick={syncNotion} disabled={syncingNotion || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            title="Notion から最新の WBS を取り込み、続けてスプレッドシートの修正後を取り込む">
            {syncingNotion ? '同期中…' : '🔄 Notion を同期'}
          </button>
          <button onClick={importDocHub} disabled={importingDocs || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
            title="Notion ドキュメントハブの資料URL(ファイル&メディア)を備考「資料:カテゴリ」行にまとめて保存">
            {importingDocs ? '取込中…' : '📁 資料リンク取込'}
          </button>

          <span className="mx-1 h-6 w-px bg-slate-300" />

          {/* Backlog ⇄ スプレッドシート */}
          <button onClick={exportSheet} disabled={exporting || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            title="Backlog の上司報告（サマリ・詳細）をスプレッドシートへ書き出す">
            {exporting ? '出力中…' : '📊 Backlog → スプシへ出力'}
          </button>
          <button onClick={importSheet} disabled={importing || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
            title="スプレッドシートの備考・状態推移を Backlog サマリへ取り込む">
            {importing ? '取込中…' : '📥 Backlog ← スプシから取込'}
          </button>

          <span className="mx-1 h-6 w-px bg-slate-300" />

          {/* Notion(WBS) ← スプレッドシート */}
          <button onClick={importNotion} disabled={importingNotion || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50"
            title="スプレッドシート（主_リビング_進捗管理）の Notion(WBS) タブで編集した修正後の値をアプリへ取り込む">
            {importingNotion ? '取込中…' : '📥 Notion ← スプシから取込'}
          </button>

          <button onClick={() => setShowSheetUrls((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-100"
            title="スプレッドシート（Backlog 出力先 / Notion 取込元）を設定">
            ⚙ スプシ設定
          </button>
        </div>
      </div>

      {showSheetUrls && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
          <p className="text-xs text-slate-500">Backlog（上司報告）は出力先、Notion（WBS）は取込元のスプレッドシートです。</p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-28 shrink-0 font-medium">📊 Backlog 出力先</span>
            <input value={backlogSheetUrl} onChange={(e) => setBacklogSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-28 shrink-0 font-medium">🟦 Notion 取込元</span>
            <input value={notionSheetUrl} onChange={(e) => setNotionSheetUrl(e.target.value)}
              placeholder="別のスプレッドシート URL を貼り付け"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-sky-400 focus:outline-none" />
          </label>
        </div>
      )}

      {/* タブ切り替え。320px 幅だとタブ3つで収まらないため、折り返さず横スクロールで1行を維持する */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 mb-4">
        <TabButton active={view === 'summary'} onClick={() => setView('summary')} label="📋 上司報告（サマリ）" />
        <TabButton active={view === 'detail'} onClick={() => setView('detail')} label="📈 対応ログ（詳細）" />
        <TabButton active={view === 'notion'} onClick={() => setView('notion')} label={`🟦 Notion(WBS)${data?.notion_tasks?.length ? `（${data.notion_tasks.length}）` : ''}`} />
      </div>

      {notice && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          <span>{notice.text}</span>
          {notice.url && (
            <a href={notice.url} target="_blank" rel="noreferrer" className="font-medium underline">シートを開く →</a>
          )}
        </div>
      )}
      {data?.synced_at && (
        <p className="text-xs text-slate-400 mb-4">最終同期: {new Date(data.synced_at).toLocaleString('ja-JP')}</p>
      )}

      {loading && <div className="text-slate-400 text-sm py-10 text-center">読み込み中…</div>}

      {!loading && data && view === 'summary' && (
        <SummaryView
          rows={summaryRows}
          legend={data.status_legend ?? []}
          notionTasks={data.notion_tasks ?? []}
          savingKey={savingKey}
          onSaveNote={(row, note) => saveNote(row, { note })}
          onSaveStatus={(row, status_override) => saveNote(row, { status_override })}
          onSaveNotion={(row, notion_block_id) => saveNote(row, { notion_block_id })}
        />
      )}

      {!loading && data && view === 'notion' && (
        <NotionView
          tasks={data.notion_tasks ?? []}
          onPatch={saveNotionTask}
          onReload={() => (selectedUserId == null ? Promise.resolve() : fetchData(selectedUserId))}
        />
      )}

      {!loading && data && view === 'detail' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {months.map((m) => (
              <div key={m.month} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-700 mb-2">{m.month}</div>
                <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <Stat label="関与課題" value={m.issue_count} />
                  <Stat label="コミット" value={m.commit_count} />
                  <Stat label="報告/調整" value={m.report_count} accent />
                  <Stat label="状態変更" value={m.status_count} />
                </div>
              </div>
            ))}
          </div>

          {months.map((m) => {
            const open = openMonths[m.month] ?? false
            const rows = byMonth[m.month] ?? []
            return (
              <div key={m.month} className="mb-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button
                  onClick={() => setOpenMonths((o) => ({ ...o, [m.month]: !open }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <span className="font-semibold text-slate-700">
                    {m.month} <span className="text-slate-400 font-normal text-sm">（{rows.length}件）</span>
                  </span>
                  <span className="text-slate-400">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {rows.map((a) => (
                      <div key={a.id} className="flex gap-3 px-4 py-2.5 text-sm">
                        <span className="text-slate-400 tabular-nums shrink-0 w-16">{a.occurred_on?.slice(5)}</span>
                        <span className={`shrink-0 self-start px-1.5 py-0.5 rounded text-[11px] font-medium ${TYPE_STYLE[a.activity_type]}`}>
                          {a.type_label}
                        </span>
                        <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0 text-blue-600 hover:underline font-medium w-24">
                          {a.issue_key}
                        </a>
                        <span className="text-slate-700 whitespace-pre-wrap break-words min-w-0">{a.content || a.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {months.length === 0 && (
            <div className="text-slate-400 text-sm py-10 text-center">
              まだデータがありません。「Backlog 同期」を押してください。
            </div>
          )}
        </>
      )}
    </div>
  )
}

type SortState = { key: string; dir: 'asc' | 'desc' }

const TH = 'sticky top-[61px] z-20 bg-slate-100 border border-slate-300 px-3 py-2 font-semibold whitespace-nowrap'
const TD = 'border border-slate-300 px-3 py-2 align-top'
const NOTION_NONE = '__none'
const NOTION_LINKED = '__linked'

// 横スクロール時に左へ固定する先頭3列。left は各列幅(96/112)の累積。Tailwind JIT のため文字列リテラルで持つ。
const FZ_HEAD = [
  'sticky left-0 z-30 w-[116px] min-w-[116px] max-w-[116px]',
  'sticky left-[116px] z-30 w-[124px] min-w-[124px] max-w-[124px]',
  'sticky left-[240px] z-30 w-[248px] min-w-[248px] max-w-[248px]',
]
const FZ_FILTER = [
  'sticky left-0 top-[94px] z-30 bg-slate-50 w-[116px] min-w-[116px] max-w-[116px] border border-slate-300 px-1.5 py-1',
  'sticky left-[116px] top-[94px] z-30 bg-slate-50 w-[124px] min-w-[124px] max-w-[124px] border border-slate-300 px-1.5 py-1',
  'sticky left-[240px] top-[94px] z-30 bg-slate-50 w-[248px] min-w-[248px] max-w-[248px] border border-slate-300 px-1.5 py-1',
]
const FZ_BODY = [
  'sticky left-0 z-10 bg-white w-[116px] min-w-[116px] max-w-[116px]',
  'sticky left-[116px] z-10 bg-white w-[124px] min-w-[124px] max-w-[124px]',
  'sticky left-[240px] z-10 bg-white w-[248px] min-w-[248px] max-w-[248px]',
]

function SummaryView({
  rows, legend, notionTasks, savingKey, onSaveNote, onSaveStatus, onSaveNotion,
}: {
  rows: SummaryRow[]
  legend: string[]
  notionTasks: NotionTaskOption[]
  savingKey: string | null
  onSaveNote: (row: SummaryRow, note: string) => void
  onSaveStatus: (row: SummaryRow, status: string) => void
  onSaveNotion: (row: SummaryRow, notionBlockId: string) => void
}) {
  const [sort, setSort] = useState<SortState>({ key: 'month', dir: 'desc' })
  const [filters, setFilters] = useState({ month: '', issue_key: '', summary: '', status: '', note: '', notion: '' })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const notionById = useMemo(() => {
    const map: Record<string, NotionTaskOption> = {}
    for (const task of notionTasks) map[task.notion_block_id] = task
    return map
  }, [notionTasks])

  const assignees = useMemo(
    () => [...new Set(notionTasks.map((t) => t.assignee_name).filter((n): n is string => !!n))],
    [notionTasks],
  )

  const setFilter = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))
  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const visible = useMemo(() => {
    const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.trim().toLowerCase())
    const filtered = rows.filter((row) => {
      if (filters.month && !has(row.month, filters.month)) return false
      if (filters.issue_key && !has(row.issue_key, filters.issue_key)) return false
      if (filters.summary && !has(row.summary, filters.summary)) return false
      if (filters.status && row.status !== filters.status) return false
      if (filters.note && !has(row.note, filters.note)) return false
      if (filters.notion) {
        if (filters.notion === NOTION_NONE) return !row.notion_block_id
        if (filters.notion === NOTION_LINKED) return !!row.notion_block_id
        const linked = notionById[row.notion_block_id]
        if (!linked || linked.assignee_name !== filters.notion) return false
      }
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = String((a as Record<string, unknown>)[sort.key] ?? '')
      const bv = String((b as Record<string, unknown>)[sort.key] ?? '')
      return av.localeCompare(bv, 'ja') * dir || b.month.localeCompare(a.month) || a.issue_key.localeCompare(b.issue_key)
    })
  }, [rows, filters, sort, notionById])

  if (rows.length === 0) {
    return <div className="text-slate-400 text-sm py-10 text-center">サマリがありません。「Backlog 同期」または「スプシから取込」を押してください。</div>
  }

  const COLS = 9

  return (
    <div>
      <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600 space-y-1">
        {legend.length > 0 && (
          <div><span className="font-semibold text-slate-500 mr-2">状態推移の凡例:</span>{legend.join(' ／ ')}</div>
        )}
        <div>
          <span className="font-semibold text-slate-500 mr-2">開始日 / 完了日:</span>
          <span className="text-sky-600 font-medium">予定(Notion)</span>
          <span className="mx-1 text-slate-400">→</span>
          <span className="font-medium text-slate-700">実績(Backlog)</span>
          <span className="ml-2 text-slate-400">右端の「Notion」で WBS タスクを紐付けると、予定・工数・進捗が ▼ で開けます。</span>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl border border-slate-300 shadow-sm">
        <table className="min-w-max text-sm border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-left text-xs">
              <SortTh label="月" k="month" sort={sort} onSort={toggleSort} className={FZ_HEAD[0]} />
              <SortTh label="課題" k="issue_key" sort={sort} onSort={toggleSort} className={FZ_HEAD[1]} />
              <SortTh label="概要" k="summary" sort={sort} onSort={toggleSort} className={FZ_HEAD[2]} />
              <SortTh label="状態推移" k="status" sort={sort} onSort={toggleSort} />
              <SortTh label="開始日 (予定→実績)" k="start_on" sort={sort} onSort={toggleSort} />
              <SortTh label="処理済日" k="shori_on" sort={sort} onSort={toggleSort} />
              <SortTh label="完了日 (予定→実績)" k="done_on" sort={sort} onSort={toggleSort} />
              <th className={`${TH} w-96 min-w-[24rem]`}>備考</th>
              <th className={TH}>Notion (WBS)</th>
            </tr>
            <tr className="bg-slate-50 text-xs">
              <th className={FZ_FILTER[0]}><FilterInput value={filters.month} onChange={(v) => setFilter('month', v)} placeholder="月で絞込" /></th>
              <th className={FZ_FILTER[1]}><FilterInput value={filters.issue_key} onChange={(v) => setFilter('issue_key', v)} placeholder="課題で絞込" /></th>
              <th className={FZ_FILTER[2]}><FilterInput value={filters.summary} onChange={(v) => setFilter('summary', v)} placeholder="概要で絞込" /></th>
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1">
                <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs">
                  <option value="">全て</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </th>
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1"><FilterInput value={filters.note} onChange={(v) => setFilter('note', v)} placeholder="備考で絞込" /></th>
              <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1">
                <select value={filters.notion} onChange={(e) => setFilter('notion', e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" title="担当者・紐付け状況で絞込">
                  <option value="">全て</option>
                  {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                  <option value={NOTION_LINKED}>紐付けあり</option>
                  <option value={NOTION_NONE}>未紐付け</option>
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = `${row.month}|${row.issue_key}`
              const linked = row.notion_block_id ? notionById[row.notion_block_id] : undefined
              const isOpen = expanded[key] ?? false
              return (
                <Fragment key={key}>
                  <tr className="hover:bg-slate-50/60">
                    <td className={`${FZ_BODY[0]} ${TD} tabular-nums text-slate-500 whitespace-nowrap`}>{row.month}</td>
                    <td className={`${FZ_BODY[1]} ${TD} whitespace-nowrap`}>
                      {row.url ? (
                        <a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{row.issue_key}</a>
                      ) : (
                        <span className="font-medium text-slate-700">{row.issue_key}</span>
                      )}
                    </td>
                    <td className={`${FZ_BODY[2]} ${TD} text-slate-700 whitespace-pre-wrap break-words`}>{row.summary}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <select
                        value={row.status_override}
                        onChange={(e) => onSaveStatus(row, e.target.value)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs focus:border-emerald-400 focus:outline-none"
                        title={row.status_override ? '手入力で上書き中' : 'Backlog 活動から自動判定'}
                      >
                        <option value="">自動{row.computed_status ? `（${row.computed_status}）` : ''}</option>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className={TD}><ScheduleCell planned={linked?.start_date} actual={row.start_on} /></td>
                    <td className={`${TD} tabular-nums text-slate-500 whitespace-nowrap`}>{row.shori_on || <span className="text-slate-300">—</span>}</td>
                    <td className={TD}><ScheduleCell planned={linked?.end_date} actual={row.done_on} /></td>
                    <td className={`${TD} p-1.5`}>
                      <NoteCell value={row.note} saving={savingKey === key} onSave={(v) => onSaveNote(row, v)} />
                    </td>
                    <td className={TD}>
                      <NotionCell
                        value={row.notion_block_id}
                        options={notionTasks}
                        assignees={assignees}
                        hasLink={!!linked}
                        saving={savingKey === key}
                        open={isOpen}
                        onToggle={() => setExpanded((e) => ({ ...e, [key]: !isOpen }))}
                        onChange={(v) => onSaveNotion(row, v)}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-sky-50/40">
                      <td colSpan={COLS} className="border border-slate-300 px-4 py-3">
                        <NotionPanel task={linked} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={COLS} className="border border-slate-300 text-center text-slate-400 py-6 text-sm">フィルター条件に一致する行がありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Notion(WBS) タスク一覧ビュー（上部タブで Backlog 報告と切替）。
// 担当 / WBSレベル / タスク名 / 開始日 / 終了日 / 工数 / 進捗率 / 進捗状況 / 優先度 / 備考。ソート・フィルター対応。
// 修正後(prev 列)編集の楽観更新を NotionTaskOption に反映する。
function applyNotionPatch(task: NotionTaskOption, patch: Record<string, string>): NotionTaskOption {
  const next = { ...task }
  if ('title_prev' in patch) next.title_prev = patch.title_prev.trim() || null
  if ('assignee_name_prev' in patch) next.assignee_name_prev = patch.assignee_name_prev.trim() || null
  if ('workload_prev' in patch) {
    const raw = patch.workload_prev.trim()
    const num = parseFloat(raw)
    next.workload_prev = raw === '' || isNaN(num) ? null : num
  }
  if ('start_date_prev' in patch) next.start_date_prev = patch.start_date_prev || null
  if ('end_date_prev' in patch) next.end_date_prev = patch.end_date_prev || null
  if ('status_prev' in patch) next.status_prev = patch.status_prev.trim() || null
  if ('progress_rate_prev' in patch) {
    const raw = patch.progress_rate_prev.replace('%', '').trim()
    const num = parseFloat(raw)
    next.progress_rate_prev = raw === '' || isNaN(num) ? null : num > 1 ? num / 100 : num
  }
  if ('memo' in patch) next.memo = patch.memo
  if ('note' in patch) next.note = patch.note
  return next
}

// ダブルクリックでテキスト入力に変わり、確定で即時反映するセル。
function EditableCell({ raw, display, kind, displayClass, onSave }: {
  raw: string
  display: ReactNode
  kind: 'date' | 'rate' | 'text'
  displayClass?: string
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(raw)
  useEffect(() => { setDraft(raw) }, [raw])

  if (editing) {
    const commit = () => { setEditing(false); if (draft !== raw) onSave(draft) }
    return (
      <input
        autoFocus
        type={kind === 'date' ? 'date' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { setDraft(raw); setEditing(false) }
        }}
        placeholder={kind === 'rate' ? '例: 60%' : kind === 'text' ? '入力…' : ''}
        className="w-full rounded border border-sky-400 px-1 py-0.5 text-xs focus:outline-none"
      />
    )
  }
  return (
    <div onDoubleClick={() => { setDraft(raw); setEditing(true) }} title="ダブルクリックで編集" className={`cursor-text min-h-[1.1rem] ${displayClass ?? ''}`}>
      {display}
    </div>
  )
}

function StatusBadge({ status, muted }: { status: string | null; muted?: boolean }) {
  if (!status) return <span className="text-slate-300">—</span>
  const tone = status === '完了' ? 'bg-emerald-100 text-emerald-700' : status === '進行中' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${muted ? 'bg-slate-100 text-slate-400' : tone}`}>{status}</span>
}

// 元 xlsm の本文フォント。プロジェクト情報行〜表全体で共通して使う。
const WBS_EXCEL_FONT_FAMILY = '"Meiryo UI", Meiryo, sans-serif'

// Excel 出力・提出済判定の対象になる修正後フィールド(WBS_TABLE_COLUMNS のうち WBSレベルを除く6列)。
const WBS_SUBMITTABLE_FIELDS: NotionTaskEffectiveField[] = ['title', 'assignee_name', 'progress_rate', 'workload', 'start_date', 'end_date']

function NotionView({ tasks, onPatch, onReload }: {
  tasks: NotionTaskOption[]
  onPatch: (notionBlockId: string, patch: Record<string, string>) => void
  onReload: () => Promise<void>
}) {
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [openTaskBlockIds, setOpenTaskBlockIds] = useState<Record<string, boolean>>({})
  const [excelTemplate, setExcelTemplate] = useState<WbsExcelTemplateInfo | null>(null)
  const [excelTemplateLoaded, setExcelTemplateLoaded] = useState(false)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [markingSubmitted, setMarkingSubmitted] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)

  useEffect(() => {
    api
      .get<{ template: WbsExcelTemplateInfo | null }>('/backlog_activities/wbs_excel_template')
      .then((r) => setExcelTemplate(r.data.template))
      .catch(() => setExcelTemplate(null))
      .finally(() => setExcelTemplateLoaded(true))
  }, [])

  const assignees = useMemo(
    () => [...new Set(tasks.map((task) => effectiveTaskValue(task, 'assignee_name')).filter((name): name is string => !!name))],
    [tasks],
  )

  const sortedTasks = useMemo(() => {
    const filtered = assigneeFilter
      ? tasks.filter((task) => effectiveTaskValue(task, 'assignee_name') === assigneeFilter)
      : tasks
    return [...filtered].sort((a, b) => compareWbsLevel(a.wbs_level, b.wbs_level))
  }, [tasks, assigneeFilter])

  // ガントの起点・終点は Excel の K5 式と同じ規則。
  // 起点 = min(project_start(テンプレ), 全タスクの実効開始日の最小値)がある週の月曜(project_start が無ければ実効開始日の最小値、それも無ければ今日)。
  // 終点 = max(起点+90日(13週分), 全タスクの実効終了日の最大値をその週の日曜まで切り上げ)。
  const ganttRange = useMemo(() => {
    const startDates: Date[] = []
    const endDates: Date[] = []
    for (const task of tasks) {
      const effectiveStartDate = effectiveTaskValue(task, 'start_date')
      const effectiveEndDate = effectiveTaskValue(task, 'end_date')
      const parsedStartDate = effectiveStartDate ? parseDateOnly(effectiveStartDate) : null
      const parsedEndDate = effectiveEndDate ? parseDateOnly(effectiveEndDate) : null
      if (parsedStartDate) startDates.push(parsedStartDate)
      if (parsedEndDate) endDates.push(parsedEndDate)
    }
    const projectStartDate = excelTemplate?.project_start ? parseDateOnly(excelTemplate.project_start) : null
    const earliestStartDate = startDates.length > 0 ? startDates.reduce((earliest, date) => (date < earliest ? date : earliest)) : null
    const latestEndDate = endDates.length > 0 ? endDates.reduce((latest, date) => (date > latest ? date : latest)) : null
    const rangeStartSourceDate = projectStartDate
      ? (earliestStartDate && earliestStartDate < projectStartDate ? earliestStartDate : projectStartDate)
      : (earliestStartDate ?? todayDateOnly())
    const rangeStart = mondayOfExcelWeek(rangeStartSourceDate)
    const minimumRangeEnd = addDays(rangeStart, 90) // Excel の K〜CW = 13週分
    const rangeEndFromTasks = latestEndDate ? sundayOfExcelWeek(latestEndDate) : minimumRangeEnd
    const rangeEndBeforeClamp = rangeEndFromTasks > minimumRangeEnd ? rangeEndFromTasks : minimumRangeEnd
    // 異常な日付が1件混入しても日別 th が膨れ上がらないよう上限で clamp する。
    const maximumRangeEnd = addDays(rangeStart, GANTT_MAX_DAYS)
    const rangeEnd = rangeEndBeforeClamp > maximumRangeEnd ? maximumRangeEnd : rangeEndBeforeClamp
    return { rangeStart, rangeEnd, days: buildGanttDayRange(rangeStart, rangeEnd) }
  }, [tasks, excelTemplate])

  const todayIndex = useMemo(() => {
    const today = todayDateOnly()
    return ganttRange.days.findIndex((day) => day.getTime() === today.getTime())
  }, [ganttRange])

  // ガント上段ヘッダ(yyyy年m月)。年月が変わるごとに区切ってラベルを立てる(span=その月に含まれる表示中の日数)。
  // 週境界の罫線(isWeekStart)は日番号行(行5)にそのまま残す。
  const monthHeaderGroups = useMemo(() => {
    const groups: { label: string; span: number }[] = []
    let currentMonthKey = ''
    ganttRange.days.forEach((day) => {
      const monthKey = `${day.getUTCFullYear()}-${day.getUTCMonth()}`
      if (monthKey !== currentMonthKey) {
        groups.push({ label: formatMonthLabel(day), span: 0 })
        currentMonthKey = monthKey
      }
      groups[groups.length - 1].span += 1
    })
    return groups
  }, [ganttRange])

  // table-fixed は colgroup の各 col 幅を尊重するが、table 自体に総幅が無いと実際の列幅が縮み、
  // sticky 列の間に隙間ができてガント側が透けて見える。colgroup の合計と一致させる。
  const stickyColumnsWidthPx = WBS_TABLE_COLUMNS.reduce((sum, column) => sum + column.widthPx, 0)
  const tableWidthPx = stickyColumnsWidthPx + SPACER_COLUMN_WIDTH_PX + ganttRange.days.length * DAY_WIDTH_PX
  const monthLabelStickyLeftPx = stickyColumnsWidthPx + SPACER_COLUMN_WIDTH_PX

  const toggleTaskOpen = (notionBlockId: string) =>
    setOpenTaskBlockIds((prev) => ({ ...prev, [notionBlockId]: !prev[notionBlockId] }))

  // 未提出かつテンプレ(xlsm)と異なる赤セル数(タスク × 6編集列で数える)。「提出済にする」ボタンの表示・disabled 判定に使う。
  const unsubmittedChangeCount = useMemo(
    () => tasks.reduce((count, task) => count + WBS_SUBMITTABLE_FIELDS.filter((field) => isRedCell(task, field)).length, 0),
    [tasks],
  )

  const uploadExcelTemplate = async (file: File) => {
    setUploadingTemplate(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const r = await api.post<{ template: WbsExcelTemplateInfo | null }>('/backlog_activities/wbs_excel_template', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setExcelTemplate(r.data.template)
      toast.success('Excel テンプレを登録しました')
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Excel テンプレの登録に失敗しました')
    } finally {
      setUploadingTemplate(false)
    }
  }

  const importExcel = async (file: File) => {
    setImportingExcel(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const r = await api.post<{
        applied_task_count: number
        applied_cell_count: number
        cleared_cell_count: number
        unmatched_row_count: number
        unchanged_row_count: number
      }>('/backlog_activities/wbs_excel_import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await onReload()
      const { applied_task_count, applied_cell_count, cleared_cell_count, unmatched_row_count, unchanged_row_count } = r.data
      toast.success(
        `Excel から取込: 変更 ${applied_cell_count} セル（${applied_task_count} 件）/ 修正後を解除 ${cleared_cell_count} セル / 変更なし ${unchanged_row_count} 行 / アプリに無い行 ${unmatched_row_count}`,
      )
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Excel の取込に失敗しました')
    } finally {
      setImportingExcel(false)
    }
  }

  const exportExcel = async () => {
    setExportingExcel(true)
    try {
      const response = await api.get('/backlog_activities/wbs_excel_export', { responseType: 'blob' })
      const contentDisposition = response.headers['content-disposition'] as string | undefined
      const filenameMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i) ?? contentDisposition?.match(/filename="?([^";]+)"?/i)
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : '進捗報告書.xlsm'
      downloadBlob(response.data as Blob, filename)
      const matchedCount = Number(response.headers['x-wbs-matched'] ?? 0)
      const appendedCount = Number(response.headers['x-wbs-appended'] ?? 0)
      const skippedCount = Number(response.headers['x-wbs-skipped'] ?? 0)
      const changedCellsHeader = response.headers['x-wbs-changed-cells'] as string | undefined
      const unsubmittedCellsHeader = response.headers['x-wbs-unsubmitted-cells'] as string | undefined
      const extraInfoParts: string[] = []
      if (changedCellsHeader != null) extraInfoParts.push(`変更セル ${changedCellsHeader}`)
      if (unsubmittedCellsHeader != null) extraInfoParts.push(`未提出（赤）${unsubmittedCellsHeader}`)
      const extraInfoSuffix = extraInfoParts.length > 0 ? ` / ${extraInfoParts.join(' / ')}` : ''
      toast.success(`更新 ${matchedCount} 行 / 追加 ${appendedCount} 行 / 収まらず ${skippedCount} 行${extraInfoSuffix}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Excel 出力に失敗しました')
    } finally {
      setExportingExcel(false)
    }
  }

  // 全タスクの現在の修正後値を提出済スナップショットにする(=赤背景を解除する)。
  const markSubmitted = async () => {
    const changedCellCountAtClick = unsubmittedChangeCount
    setMarkingSubmitted(true)
    try {
      await api.post('/backlog_activities/wbs_mark_submitted')
      await onReload()
      toast.success(`提出済にしました（${changedCellCountAtClick} 件）`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? '提出済への更新に失敗しました')
    } finally {
      setMarkingSubmitted(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 ${uploadingTemplate ? 'opacity-50' : 'cursor-pointer'}`}>
          {uploadingTemplate ? '登録中…' : '📎 Excel テンプレ登録'}
          <input
            type="file"
            accept=".xlsm"
            disabled={uploadingTemplate}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadExcelTemplate(file)
            }}
          />
        </label>
        <label
          title="ISN 側で編集した進捗報告書(.xlsx/.xlsm)の進捗率・工数・開始・終了のうち、アプリと違うセルだけを修正後として取り込み（赤表示）、同じセルの古い修正後は解除する"
          className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 ${importingExcel ? 'opacity-50' : 'cursor-pointer'}`}
        >
          {importingExcel ? '取込中…' : '📥 Excel から取込'}
          <input
            type="file"
            accept=".xlsx,.xlsm"
            disabled={importingExcel}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) importExcel(file)
            }}
          />
        </label>
        {excelTemplateLoaded && excelTemplate && (
          <span className="text-xs text-slate-500">
            登録済: {excelTemplate.file_name}（{new Date(excelTemplate.uploaded_at).toLocaleString('ja-JP')}）
          </span>
        )}
        <button
          onClick={exportExcel}
          disabled={!excelTemplate || exportingExcel}
          title={excelTemplate ? '登録済テンプレへスケジュールを反映して出力' : '先に Excel テンプレを登録してください'}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {exportingExcel ? '出力中…' : '📤 Excel 出力'}
        </button>
        <button
          onClick={markSubmitted}
          disabled={markingSubmitted || unsubmittedChangeCount === 0}
          title="現在の修正後値を提出済スナップショットにする(赤背景のセルが解除される)"
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {markingSubmitted ? '更新中…' : `✅ 提出済にする（変更 ${unsubmittedChangeCount} 件）`}
        </button>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          担当者
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs">
            <option value="">全て</option>
            {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      {tasks.length === 0 ? (
        <div className="text-slate-400 text-sm py-10 text-center">Notion(WBS) タスクがありません。カレンダーの「Notion 同期」で取り込んでください。</div>
      ) : (
        <div style={{ fontFamily: WBS_EXCEL_FONT_FAMILY }}>
          {excelTemplateLoaded && excelTemplate && (
            <div className="mb-2 space-y-0.5">
              {excelTemplate.project_title && <p className="text-lg font-bold text-slate-800">{excelTemplate.project_title}</p>}
              {excelTemplate.company_name && <p className="text-sm text-slate-600">{excelTemplate.company_name}</p>}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                {excelTemplate.project_start && (
                  <span className="flex items-center gap-1.5">
                    <span>プロジェクトの開始:</span>
                    <span className="rounded border border-slate-400 px-2 py-0.5 font-medium text-slate-800">
                      {(() => {
                        const projectStartDate = parseDateOnly(excelTemplate.project_start)
                        return projectStartDate ? formatWeekdayDateLabel(projectStartDate) : ''
                      })()}
                    </span>
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span>週表示:</span>
                  <span className="rounded border border-slate-400 px-2 py-0.5 font-medium text-slate-800">1</span>
                </span>
              </div>
            </div>
          )}
          <div className="overflow-auto max-h-[75vh] rounded-xl border border-slate-300 shadow-sm">
            <table className="table-fixed border-separate border-spacing-0" style={{ width: tableWidthPx }}>
              <colgroup>
                {WBS_TABLE_COLUMNS.map((column) => <col key={column.key} style={{ width: column.widthPx }} />)}
                <col style={{ width: SPACER_COLUMN_WIDTH_PX }} />
                {ganttRange.days.map((_, index) => <col key={index} style={{ width: DAY_WIDTH_PX }} />)}
              </colgroup>
              <thead className="sticky top-0 z-30">
                <tr>
                  {WBS_TABLE_COLUMNS.map((column, columnIndex) => (
                    <th
                      key={column.key}
                      rowSpan={3}
                      style={{
                        left: wbsColumnLeftOffset(columnIndex),
                        backgroundColor: WBS_EXCEL_COLORS.headerBackground,
                        color: WBS_EXCEL_COLORS.headerText,
                        borderBottom: `2px solid ${WBS_EXCEL_COLORS.borderMedium}`, // Excel 行7 は B〜H に縦罫線なし・下罫線 medium のみ
                        boxShadow: `1px 0 0 0 ${WBS_EXCEL_COLORS.headerBackground}`, // sticky セルは別レイヤーに描かれ境界に 1px の継ぎ目が出るので、同色の影で右隣へ 1px 重ねて埋める
                      }}
                      className={`sticky z-40 whitespace-pre-line px-1.5 py-1.5 align-middle text-xs font-bold ${column.align === 'left' ? 'text-left' : 'text-center'}`}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th rowSpan={3} className="border-0 bg-white p-0" />
                  {monthHeaderGroups.map((group, groupIndex) => (
                    <th
                      key={groupIndex}
                      colSpan={group.span}
                      style={{ height: 40, borderTopColor: WBS_EXCEL_COLORS.borderThinWeekday, borderLeftColor: WBS_EXCEL_COLORS.borderThinWeekday }}
                      className="border-0 border-t border-l text-left text-xs font-normal text-slate-700"
                    >
                      {/* 右スクロールで月の先頭が固定列の下に隠れても、ラベルは固定列の右端に貼り付いて見え続ける */}
                      <span className="sticky inline-block px-1" style={{ left: monthLabelStickyLeftPx }}>{group.label}</span>
                    </th>
                  ))}
                </tr>
                <tr>
                  {ganttRange.days.map((day, dayIndex) => {
                    const isTodayColumn = dayIndex === todayIndex
                    const isWeekStart = dayIndex % 7 === 0
                    return (
                      <th
                        key={dayIndex}
                        style={{
                          height: 20,
                          borderLeftWidth: isTodayColumn || isWeekStart ? 1 : 0,
                          borderRightWidth: isTodayColumn ? 1 : 0,
                          borderLeftColor: isTodayColumn ? WBS_EXCEL_COLORS.todayLine : WBS_EXCEL_COLORS.borderThinWeekday,
                          borderRightColor: WBS_EXCEL_COLORS.todayLine,
                        }}
                        className="border-0 border-solid text-center text-xs font-normal text-slate-700"
                      >
                        {formatDayNumber(day)}
                      </th>
                    )
                  })}
                </tr>
                <tr>
                  {ganttRange.days.map((day, dayIndex) => {
                    const isTodayColumn = dayIndex === todayIndex
                    return (
                      <th
                        key={dayIndex}
                        style={{
                          height: 40,
                          backgroundColor: WBS_EXCEL_COLORS.headerBackground,
                          color: WBS_EXCEL_COLORS.headerText,
                          borderWidth: `0 1px 2px ${isTodayColumn ? 1 : 0}px`, // border-separate なので左罫線は今日の列だけ(隣の右罫線と二重にしない)
                          borderStyle: 'solid',
                          borderLeftColor: WBS_EXCEL_COLORS.todayLine,
                          borderRightColor: isTodayColumn ? WBS_EXCEL_COLORS.todayLine : WBS_EXCEL_COLORS.borderThinWeekday,
                          borderBottomColor: WBS_EXCEL_COLORS.borderMedium,
                        }}
                        className="text-center text-[11px] font-bold"
                      >
                        {weekdayLetter(day)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => (
                  <NotionGanttRow
                    key={task.notion_block_id}
                    task={task}
                    ganttRange={ganttRange}
                    todayIndex={todayIndex}
                    open={!!openTaskBlockIds[task.notion_block_id]}
                    onToggleOpen={() => toggleTaskOpen(task.notion_block_id)}
                    onPatch={onPatch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ガントの1タスク行。左7列はスティッキーな編集可能セル(Excel入力セル色)、
// スペーサーを挟んで右はトラック1本(絶対配置バー2本、経過=グレー/残り=紫)。
function NotionGanttRow({ task, ganttRange, todayIndex, open, onToggleOpen, onPatch }: {
  task: NotionTaskOption
  ganttRange: { rangeStart: Date; rangeEnd: Date; days: Date[] }
  todayIndex: number
  open: boolean
  onToggleOpen: () => void
  onPatch: (notionBlockId: string, patch: Record<string, string>) => void
}) {
  const effectiveTitle = effectiveTaskValue(task, 'title')
  const effectiveAssigneeName = effectiveTaskValue(task, 'assignee_name')
  const effectiveWorkload = effectiveTaskValue(task, 'workload')
  const effectiveStartDate = effectiveTaskValue(task, 'start_date')
  const effectiveEndDate = effectiveTaskValue(task, 'end_date')
  const effectiveProgressRate = effectiveTaskValue(task, 'progress_rate')
  const progressPercent = Math.round((effectiveProgressRate ?? 0) * 100)

  // Excel の hidden 列「日数」相当。表示はしないが、バーの長さ計算には使い続ける。
  const durationDays = calculateDurationDays(effectiveStartDate, effectiveEndDate)
  const totalDaysInRange = ganttRange.days.length
  const trackWidthPx = totalDaysInRange * DAY_WIDTH_PX
  const parsedStartDate = effectiveStartDate ? parseDateOnly(effectiveStartDate) : null
  const barLeftPx = parsedStartDate ? daysBetweenDates(ganttRange.rangeStart, parsedStartDate) * DAY_WIDTH_PX : 0
  const elapsedDays = durationDays != null ? calculateFilledDays(durationDays, effectiveProgressRate) : 0
  const elapsedWidthPx = elapsedDays * DAY_WIDTH_PX
  const remainingWidthPx = durationDays != null ? (durationDays - elapsedDays) * DAY_WIDTH_PX : 0

  const stickyCellClassName = 'sticky z-10 px-1.5 py-1 text-[15px] text-slate-800'
  // sticky セルは別レイヤーに描かれ境界に 1px の継ぎ目が出るので、背景と同色の影で右隣へ 1px 重ねて埋める
  const stickyCellStyleWithBackground = (backgroundColor: string) => ({
    backgroundColor,
    boxShadow: `1px 0 0 0 ${backgroundColor}`,
    borderBottom: `1.5px solid ${WBS_EXCEL_COLORS.borderMedium}`, // border-separate なので上罫線は前行の下罫線に任せる
  })
  const stickyCellStyle = stickyCellStyleWithBackground(WBS_EXCEL_COLORS.inputCellBackground)
  // 未提出の修正後があり、かつ登録済みテンプレ(xlsm)の該当セル値と異なる編集セルは、Excel テンプレの赤(#FF9999)で目立たせる。
  const stickyCellStyleFor = (field: NotionTaskEffectiveField) =>
    stickyCellStyleWithBackground(isRedCell(task, field) ? WBS_EXCEL_COLORS.unsubmittedChangeBackground : WBS_EXCEL_COLORS.inputCellBackground)

  return (
    <Fragment>
      <tr className="h-10">
        <td className={`${stickyCellClassName} text-left tabular-nums`} style={{ ...stickyCellStyle, left: wbsColumnLeftOffset(0) }}>
          {task.wbs_level || ''}
        </td>
        <td className={`${stickyCellClassName} text-left`} style={{ ...stickyCellStyleFor('title'), left: wbsColumnLeftOffset(1) }}>
          <span className="flex items-center gap-1">
            <button onClick={onToggleOpen} className="shrink-0 text-[10px] text-slate-500 hover:text-slate-900" title="詳細(備考・メモ・進捗状況・優先度)を開閉">
              {open ? '▲' : '▼'}
            </button>
            {/* Excel の条件付き書式 $D8="" (担当者が空の行は太字)。列幅より長い名前は末尾を省略し、title 属性でホバー表示する */}
            <span
              className={`min-w-0 flex-1 whitespace-normal break-words text-[13px] leading-4 line-clamp-2 ${effectiveAssigneeName ? '' : 'font-bold'}`}
              title={effectiveTitle || undefined}
            >
              <EditableCell kind="text" raw={effectiveTitle}
                display={<OverrideMarkedValue value={`${wbsIndent(task.wbs_level)}${effectiveTitle || '—'}`} overridden={hasTaskOverride(task, 'title')} previousValue={task.title} />}
                onSave={(value) => onPatch(task.notion_block_id, { title_prev: value })} />
            </span>
          </span>
        </td>
        <td className={`${stickyCellClassName} text-center`} style={{ ...stickyCellStyleFor('assignee_name'), left: wbsColumnLeftOffset(2) }}>
          <EditableCell kind="text" raw={effectiveAssigneeName ?? ''}
            display={<OverrideMarkedValue value={effectiveAssigneeName || '—'} overridden={hasTaskOverride(task, 'assignee_name')} previousValue={task.assignee_name} />}
            onSave={(value) => onPatch(task.notion_block_id, { assignee_name_prev: value })} />
        </td>
        <td className={`${stickyCellClassName} text-center tabular-nums`} style={{ ...stickyCellStyleFor('progress_rate'), left: wbsColumnLeftOffset(3) }}>
          {/* Excel のデータバー(グレー、0〜100%で幅比例)を背景に敷いた上に NN% を表示 */}
          <div
            className="relative -mx-1.5 -my-1 px-1.5 py-1"
            style={{ backgroundImage: `linear-gradient(to right, ${WBS_EXCEL_COLORS.progressBarTrack} ${progressPercent}%, transparent ${progressPercent}%)` }}
          >
            <EditableCell kind="rate" raw={effectiveProgressRate == null ? '' : String(progressPercent)}
              display={<OverrideMarkedValue value={`${progressPercent}%`} overridden={hasTaskOverride(task, 'progress_rate')} previousValue={task.progress_rate == null ? null : `${Math.round(task.progress_rate * 100)}%`} />}
              onSave={(value) => onPatch(task.notion_block_id, { progress_rate_prev: value })} />
          </div>
        </td>
        <td className={`${stickyCellClassName} text-center tabular-nums`} style={{ ...stickyCellStyleFor('workload'), left: wbsColumnLeftOffset(4) }}>
          <EditableCell kind="text" raw={effectiveWorkload == null ? '' : String(effectiveWorkload)}
            display={<OverrideMarkedValue value={effectiveWorkload == null ? '—' : String(effectiveWorkload)} overridden={hasTaskOverride(task, 'workload')} previousValue={task.workload == null ? null : String(task.workload)} />}
            onSave={(value) => onPatch(task.notion_block_id, { workload_prev: value })} />
        </td>
        <td className={`${stickyCellClassName} text-center tabular-nums`} style={{ ...stickyCellStyleFor('start_date'), left: wbsColumnLeftOffset(5) }}>
          <EditableCell kind="date" raw={effectiveStartDate ?? ''}
            display={<OverrideMarkedValue value={formatDateAsMonthDay(effectiveStartDate) || '—'} overridden={hasTaskOverride(task, 'start_date')} previousValue={task.start_date} />}
            onSave={(value) => onPatch(task.notion_block_id, { start_date_prev: value })} />
        </td>
        <td className={`${stickyCellClassName} text-center tabular-nums`} style={{ ...stickyCellStyleFor('end_date'), left: wbsColumnLeftOffset(6) }}>
          <EditableCell kind="date" raw={effectiveEndDate ?? ''}
            display={<OverrideMarkedValue value={formatDateAsMonthDay(effectiveEndDate) || '—'} overridden={hasTaskOverride(task, 'end_date')} previousValue={task.end_date} />}
            onSave={(value) => onPatch(task.notion_block_id, { end_date_prev: value })} />
        </td>
        {/* Excel 列 I 相当。塗りなし・見出し無しのスペーサー(sticky には含めない) */}
        <td className="bg-white p-0" />
        <td className="p-0" colSpan={totalDaysInRange}>
          <div className="relative h-10 overflow-hidden" style={{ width: trackWidthPx, ...ganttTrackBackgroundStyle() }}>
            {elapsedWidthPx > 0 && (
              <div className="absolute top-1.5 h-7" style={{ left: barLeftPx, width: elapsedWidthPx, backgroundColor: WBS_EXCEL_COLORS.ganttElapsedBar }} />
            )}
            {remainingWidthPx > 0 && (
              <div className="absolute top-1.5 h-7" style={{ left: barLeftPx + elapsedWidthPx, width: remainingWidthPx, backgroundColor: WBS_EXCEL_COLORS.ganttRemainingBar }} />
            )}
            {todayIndex >= 0 && (
              <>
                <div className="absolute top-0 h-full w-px" style={{ left: todayIndex * DAY_WIDTH_PX, backgroundColor: WBS_EXCEL_COLORS.todayLine }} />
                <div className="absolute top-0 h-full w-px" style={{ left: (todayIndex + 1) * DAY_WIDTH_PX, backgroundColor: WBS_EXCEL_COLORS.todayLine }} />
              </>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={WBS_TABLE_COLUMNS.length} className="sticky left-0 z-10 border border-slate-300 bg-slate-50 px-3 py-2 align-top">
            <NotionTaskDetailPanel task={task} onPatch={onPatch} />
          </td>
          <td className="bg-white" />
          <td className="border border-slate-200 bg-slate-50" colSpan={totalDaysInRange} />
        </tr>
      )}
    </Fragment>
  )
}

// 修正後(_prev)が入っているセルの右上に小さな点を出し、ツールチップで修正前の値を示す。
function OverrideMarkedValue({ value, overridden, previousValue }: { value: string; overridden: boolean; previousValue: string | number | null | undefined }) {
  if (!overridden) return <span className="whitespace-pre">{value}</span>
  return (
    <span className="relative inline-block whitespace-pre pr-2" title={`修正前: ${previousValue ?? '—'}`}>
      {value}
      <span className="absolute -right-0.5 -top-0.5 text-[8px] text-sky-500">●</span>
    </span>
  )
}

// タスク名セル右端の「▼」で開く詳細行。Excel の表に無い 進捗状況/優先度/備考/メモ をここに集約する。
function NotionTaskDetailPanel({ task, onPatch }: { task: NotionTaskOption; onPatch: (notionBlockId: string, patch: Record<string, string>) => void }) {
  const effectiveStatus = effectiveTaskValue(task, 'status')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6 text-xs">
        <div className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-slate-400">進捗状況</span>
          <StatusBadge status={effectiveStatus} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-slate-400">優先度</span>
          <span className="text-slate-700">{task.priority || '—'}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">備考</span>
          <NoteCell value={task.note ?? ''} saving={false} onSave={(value) => onPatch(task.notion_block_id, { note: value })} />
        </div>
        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">メモ</span>
          <NoteCell value={task.memo ?? ''} saving={false} onSave={(value) => onPatch(task.notion_block_id, { memo: value })} />
        </div>
      </div>
    </div>
  )
}

function SortTh({ label, k, sort, onSort, className }: { label: string; k: string; sort: SortState; onSort: (k: string) => void; className?: string }) {
  const active = sort.key === k
  return (
    <th className={`${TH} ${className ?? ''}`}>
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        <span className={`text-[10px] ${active ? 'text-emerald-600' : 'text-slate-300'}`}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-normal text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
    />
  )
}

// 開始日・完了日を「予定(Notion) → 実績(Backlog)」の before→after で見せる（上司報告用）。
function ScheduleCell({ planned, actual }: { planned?: string | null; actual?: string }) {
  const real = actual && actual.length > 0 ? actual : ''
  if (!planned && !real) return <span className="text-slate-300">—</span>
  return (
    <span className="whitespace-nowrap tabular-nums text-xs">
      <span className="text-sky-600" title="予定(Notion)">{planned || '—'}</span>
      <span className="mx-1 text-slate-400">→</span>
      <span className="font-medium text-slate-700" title="実績(Backlog)">{real || '—'}</span>
    </span>
  )
}

// 課題に対応する Notion(WBS) タスクを選んで紐付けるセレクト + 詳細パネルの開閉。
function NotionCell({
  value, options, assignees, hasLink, saving, open, onToggle, onChange,
}: {
  value: string
  options: NotionTaskOption[]
  assignees: string[]
  hasLink: boolean
  saving: boolean
  open: boolean
  onToggle: () => void
  onChange: (notionBlockId: string) => void
}) {
  const label = (o: NotionTaskOption) => [o.wbs_level, o.title].filter(Boolean).join(' ')
  const orphans = options.filter((o) => !o.assignee_name)
  return (
    <div className="flex items-center gap-1.5 min-w-[14rem]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[12rem] flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs focus:border-emerald-400 focus:outline-none"
        title="この課題に対応する Notion(WBS) タスクを選んで紐付け"
      >
        <option value="">未紐付け</option>
        {assignees.map((a) => (
          <optgroup key={a} label={a}>
            {options.filter((o) => o.assignee_name === a).map((o) => (
              <option key={o.notion_block_id} value={o.notion_block_id}>{label(o)}</option>
            ))}
          </optgroup>
        ))}
        {orphans.length > 0 && (
          <optgroup label="その他">
            {orphans.map((o) => <option key={o.notion_block_id} value={o.notion_block_id}>{label(o)}</option>)}
          </optgroup>
        )}
      </select>
      {hasLink && (
        <button onClick={onToggle} title="Notion 詳細を開閉" className="shrink-0 rounded border border-slate-300 px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
          {open ? '▲' : '▼'}
        </button>
      )}
      {saving && <span className="text-[10px] text-emerald-500 whitespace-nowrap">保存中…</span>}
    </div>
  )
}

// 紐付けた Notion(WBS) タスクの詳細（WBS/タスク名/開始/終了/工数/進捗率/進捗状況/優先度/備考）。
function NotionPanel({ task }: { task?: NotionTaskOption }) {
  if (!task) return <span className="text-xs text-slate-400">Notion タスクが見つかりません（同期で削除された可能性があります）。</span>
  const pct = task.progress_rate == null ? '—' : `${Math.round(task.progress_rate * 100)}%`
  const items: [string, string][] = [
    ['担当', task.assignee_name || '—'],
    ['WBSレベル', task.wbs_level || '—'],
    ['タスク名', task.title || '—'],
    ['開始日', task.start_date || '—'],
    ['終了日', task.end_date || '—'],
    ['工数', task.workload == null ? '—' : `${task.workload} 人日`],
    ['進捗率', pct],
    ['進捗状況', task.status || '—'],
    ['優先度', task.priority || '—'],
    ['備考', task.note || '—'],
  ]
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(([label, val]) => (
        <div key={label} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
          <span className="text-xs text-slate-700 break-words whitespace-pre-wrap">{val}</span>
        </div>
      ))}
    </div>
  )
}

// 備考の自前ドラフトを持ち、フォーカスを外した時に変更があれば保存する。
const NOTE_URL_RE = /(https?:\/\/[^\s）」"']+)/g

// URL をクリック可能なリンクに変換して表示する
function linkifyNote(text: string) {
  return text.split(NOTE_URL_RE).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
        className="break-all text-sky-600 underline hover:text-sky-800">{part}</a>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}

function NoteCell({ value, saving, onSave }: { value: string; saving: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setDraft(value) }, [value])
  if (!editing) {
    // 表示モード: URL はクリックで遷移できるリンクに。クリック(リンク以外)で編集モードへ。
    return (
      <div className="relative min-h-[4.5rem] cursor-text whitespace-pre-wrap break-words px-1.5 py-1 text-sm leading-relaxed"
        title="クリックで編集" onClick={() => setEditing(true)}>
        {value ? linkifyNote(value) : <span className="text-slate-300">入力…</span>}
        {saving && <span className="absolute right-1 top-1 text-[10px] text-emerald-500">保存中…</span>}
      </div>
    )
  }
  return (
    <div className="relative">
      <textarea
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onSave(draft) }}
        rows={Math.max(3, draft.split('\n').length)}
        placeholder="入力…"
        className="block w-full min-h-[4.5rem] resize-none border-0 bg-white px-1.5 py-1 text-sm leading-relaxed rounded outline-none ring-1 ring-emerald-300"
      />
      {saving && <span className="absolute right-1 top-1 text-[10px] text-emerald-500">保存中…</span>}
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}</span>
      <span className={`font-bold tabular-nums ${accent ? 'text-emerald-600' : 'text-slate-800'}`}>{value}</span>
    </div>
  )
}
