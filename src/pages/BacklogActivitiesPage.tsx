import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'

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
  wbs_level: string | null
  title: string
  start_date: string | null
  end_date: string | null
  start_date_prev: string | null // 修正前(前回同期値)
  end_date_prev: string | null
  workload: number | null
  progress_rate: number | null // 0.0〜1.0
  progress_rate_prev: number | null
  status: string | null
  status_prev: string | null
  priority: string | null
  note: string
  memo: string
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
// Notion(WBS) 出力先（Backlog とは別スプレッドシート）
const NOTION_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1bLBbvF9CJNKJgE6mwyUhVmw0dmuvq_ZyZwwAvYbsLyw/edit'
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
  const [exportingNotion, setExportingNotion] = useState(false)
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

  useEffect(() => {
    if (selectedUserId == null) return
    setLoading(true)
    setNotice(null)
    api
      .get<Payload>('/backlog_activities', { params: { user_id: selectedUserId } })
      .then((r) => {
        setData(r.data)
        const latest = r.data.summary.at(-1)?.month
        setOpenMonths(latest ? { [latest]: true } : {})
      })
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

  // Notion(WBS) を Notion 本体から最新取得（同期）してページを再読込する。
  const syncNotion = async () => {
    if (selectedUserId == null) return
    setSyncingNotion(true)
    setNotice(null)
    try {
      const r = await api.post<{ synced: number }>('/notion_tasks/sync')
      const p = await api.get<Payload>('/backlog_activities', { params: { user_id: selectedUserId } })
      setData(p.data)
      setNotice({ kind: 'ok', text: `Notion から ${r.data.synced} 件のタスクを同期しました。` })
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

  // Notion(WBS) を Backlog とは別のスプレッドシートへ書き出す。
  const exportNotion = async () => {
    if (selectedUserId == null) return
    if (!notionSheetUrl.trim()) {
      setShowSheetUrls(true)
      setNotice({ kind: 'err', text: 'Notion 出力先スプレッドシートの URL を入力してください（「⚙ 出力先」で設定）。' })
      return
    }
    setExportingNotion(true)
    setNotice(null)
    try {
      const r = await api.post<{ url: string; rows?: number; tab?: string }>(
        '/backlog_activities/export_notion',
        { spreadsheet_url: notionSheetUrl },
        { params: { user_id: selectedUserId } },
      )
      setNotice({ kind: 'ok', text: `Notion(WBS) を ${r.data.rows ?? 0} 行書き出しました（タブ: ${r.data.tab ?? 'Notion(WBS)'}）。`, url: r.data.url })
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.response?.data?.error ?? 'Notion のスプレッドシート出力に失敗しました' })
    } finally {
      setExportingNotion(false)
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
      setNotice({ kind: 'ok', text: `Notion(WBS) を ${r.data.notion_imported.imported_rows} 行取り込みました（対象外 ${r.data.notion_imported.skipped_rows} 行）。※次の Notion 同期で上書きされます。`, url: r.data.notion_imported.url })
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
            title="Notion から最新の WBS タスクをアプリに取り込む">
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

          {/* Notion(WBS) ⇄ スプレッドシート */}
          <button onClick={exportNotion} disabled={exportingNotion || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
            title="Notion(WBS) タスクをスプレッドシートへ書き出す">
            {exportingNotion ? '出力中…' : '🟦 Notion → スプシへ出力'}
          </button>
          <button onClick={importNotion} disabled={importingNotion || selectedUserId == null}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50"
            title="スプレッドシートで編集した Notion(WBS) の値をアプリへ取り込む">
            {importingNotion ? '取込中…' : '📥 Notion ← スプシから取込'}
          </button>

          <button onClick={() => setShowSheetUrls((v) => !v)}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-100"
            title="スプレッドシートの出力先（Backlog / Notion）を設定">
            ⚙ 出力先
          </button>
        </div>
      </div>

      {showSheetUrls && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
          <p className="text-xs text-slate-500">出力先スプレッドシートを Backlog（上司報告）と Notion（WBS）で分けられます。</p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-28 shrink-0 font-medium">📊 Backlog 出力先</span>
            <input value={backlogSheetUrl} onChange={(e) => setBacklogSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-emerald-400 focus:outline-none" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-28 shrink-0 font-medium">🟦 Notion 出力先</span>
            <input value={notionSheetUrl} onChange={(e) => setNotionSheetUrl(e.target.value)}
              placeholder="別のスプレッドシート URL を貼り付け"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-sky-400 focus:outline-none" />
          </label>
        </div>
      )}

      {/* タブ切り替え */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
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
        <NotionView tasks={data.notion_tasks ?? []} onPatch={saveNotionTask} />
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

function NotionView({ tasks, onPatch }: { tasks: NotionTaskOption[]; onPatch: (notionBlockId: string, patch: Record<string, string>) => void }) {
  const [sort, setSort] = useState<SortState>({ key: 'wbs_level', dir: 'asc' })
  const [filters, setFilters] = useState({ assignee: '', wbs_level: '', title: '', status: '', note: '', memo: '' })
  const setFilter = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))
  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const assignees = useMemo(() => [...new Set(tasks.map((t) => t.assignee_name).filter((n): n is string => !!n))], [tasks])
  const statuses = useMemo(() => [...new Set(tasks.map((t) => t.status).filter((s): s is string => !!s))], [tasks])

  const visible = useMemo(() => {
    const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.trim().toLowerCase())
    const numKeys = new Set(['workload', 'progress_rate', 'progress_rate_prev'])
    const filtered = tasks.filter((t) => {
      if (filters.assignee && t.assignee_name !== filters.assignee) return false
      if (filters.wbs_level && !has(t.wbs_level ?? '', filters.wbs_level)) return false
      if (filters.title && !has(t.title ?? '', filters.title)) return false
      if (filters.status && (t.status ?? '') !== filters.status) return false
      if (filters.note && !has(t.note ?? '', filters.note)) return false
      if (filters.memo && !has(t.memo ?? '', filters.memo)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (numKeys.has(sort.key)) {
        const av = (a as Record<string, unknown>)[sort.key]
        const bv = (b as Record<string, unknown>)[sort.key]
        return ((av == null ? -Infinity : Number(av)) - (bv == null ? -Infinity : Number(bv))) * dir
      }
      const av = String((a as Record<string, unknown>)[sort.key] ?? '')
      const bv = String((b as Record<string, unknown>)[sort.key] ?? '')
      return av.localeCompare(bv, 'ja') * dir
    })
  }, [tasks, filters, sort])

  if (tasks.length === 0) {
    return <div className="text-slate-400 text-sm py-10 text-center">Notion(WBS) タスクがありません。カレンダーの「Notion 同期」で取り込んでください。</div>
  }
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-slate-300 shadow-sm">
      <table className="min-w-max text-sm border-collapse">
        <thead>
          <tr className="bg-slate-100 text-slate-600 text-left text-xs">
            <SortTh label="担当" k="assignee_name" sort={sort} onSort={toggleSort} className={FZ_HEAD[0]} />
            <SortTh label="WBSレベル" k="wbs_level" sort={sort} onSort={toggleSort} className={FZ_HEAD[1]} />
            <SortTh label="タスク名" k="title" sort={sort} onSort={toggleSort} className={FZ_HEAD[2]} />
            <SortTh label="開始日(修正前)" k="start_date" sort={sort} onSort={toggleSort} />
            <SortTh label="開始日(修正後)" k="start_date_prev" sort={sort} onSort={toggleSort} />
            <SortTh label="終了日(修正前)" k="end_date" sort={sort} onSort={toggleSort} />
            <SortTh label="終了日(修正後)" k="end_date_prev" sort={sort} onSort={toggleSort} />
            <SortTh label="工数" k="workload" sort={sort} onSort={toggleSort} />
            <SortTh label="進捗率(修正前)" k="progress_rate" sort={sort} onSort={toggleSort} />
            <SortTh label="進捗率(修正後)" k="progress_rate_prev" sort={sort} onSort={toggleSort} />
            <SortTh label="進捗状況(修正前)" k="status" sort={sort} onSort={toggleSort} />
            <SortTh label="進捗状況(修正後)" k="status_prev" sort={sort} onSort={toggleSort} />
            <SortTh label="優先度" k="priority" sort={sort} onSort={toggleSort} />
            <th className={`${TH} w-96 min-w-[22rem]`}>備考</th>
            <th className={`${TH} w-96 min-w-[22rem]`}>メモ</th>
          </tr>
          <tr className="bg-slate-50 text-xs">
            {/* 0 担当 (固定) */}
            <th className={FZ_FILTER[0]}>
              <select value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" title="担当者で絞込">
                <option value="">全て</option>
                {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </th>
            {/* 1 WBS (固定) */}
            <th className={FZ_FILTER[1]}><FilterInput value={filters.wbs_level} onChange={(v) => setFilter('wbs_level', v)} placeholder="WBSで絞込" /></th>
            {/* 2 タスク名 (固定) */}
            <th className={FZ_FILTER[2]}><FilterInput value={filters.title} onChange={(v) => setFilter('title', v)} placeholder="タスク名で絞込" /></th>
            {/* 3-9 開始(前/後)・終了(前/後)・工数・進捗率(前/後) */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            {/* 10 進捗状況(修正前) */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1">
              <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs" title="進捗状況(修正前)で絞込">
                <option value="">全て</option>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </th>
            {/* 11 進捗状況(修正後) */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            {/* 12 優先度 */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1" />
            {/* 13 備考 */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1"><FilterInput value={filters.note} onChange={(v) => setFilter('note', v)} placeholder="備考で絞込" /></th>
            {/* 14 メモ */}
            <th className="sticky top-[94px] z-10 bg-slate-50 border border-slate-300 px-1.5 py-1"><FilterInput value={filters.memo} onChange={(v) => setFilter('memo', v)} placeholder="メモで絞込" /></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((task) => (
            <tr key={task.notion_block_id} className="hover:bg-slate-50/60">
              <td className={`${FZ_BODY[0]} ${TD} whitespace-nowrap text-slate-700`}>{task.assignee_name || '—'}</td>
              <td className={`${FZ_BODY[1]} ${TD} tabular-nums whitespace-nowrap text-slate-500`}>{task.wbs_level || '—'}</td>
              <td className={`${FZ_BODY[2]} ${TD} text-slate-700 whitespace-pre-wrap break-words`}>
                {task.notion_block_id ? (
                  <a href={`https://www.notion.so/${task.notion_block_id.replace(/-/g, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sky-700 hover:underline" title="Notion で開く">
                    {task.title} ↗
                  </a>
                ) : task.title}
              </td>
              <td className={`${TD} tabular-nums whitespace-nowrap font-medium text-slate-700`}>{task.start_date || '—'}</td>
              <td className={`${TD} tabular-nums whitespace-nowrap`}>
                <EditableCell kind="date" raw={task.start_date_prev ?? ''}
                  display={task.start_date_prev || <span className="text-slate-300">—</span>}
                  displayClass={task.start_date_prev && task.start_date_prev !== task.start_date ? 'text-rose-600' : 'text-slate-400'}
                  onSave={(v) => onPatch(task.notion_block_id, { start_date_prev: v })} />
              </td>
              <td className={`${TD} tabular-nums whitespace-nowrap font-medium text-slate-700`}>{task.end_date || '—'}</td>
              <td className={`${TD} tabular-nums whitespace-nowrap`}>
                <EditableCell kind="date" raw={task.end_date_prev ?? ''}
                  display={task.end_date_prev || <span className="text-slate-300">—</span>}
                  displayClass={task.end_date_prev && task.end_date_prev !== task.end_date ? 'text-rose-600' : 'text-slate-400'}
                  onSave={(v) => onPatch(task.notion_block_id, { end_date_prev: v })} />
              </td>
              <td className={`${TD} tabular-nums whitespace-nowrap text-slate-500`}>{task.workload == null ? '—' : `${task.workload} 人日`}</td>
              <td className={`${TD} tabular-nums whitespace-nowrap font-medium text-slate-700`}>{pct(task.progress_rate)}</td>
              <td className={`${TD} tabular-nums whitespace-nowrap`}>
                <EditableCell kind="rate" raw={task.progress_rate_prev == null ? '' : String(Math.round(task.progress_rate_prev * 100))}
                  display={task.progress_rate_prev == null ? <span className="text-slate-300">＋</span> : pct(task.progress_rate_prev)}
                  displayClass={task.progress_rate_prev != null && task.progress_rate_prev !== task.progress_rate ? 'text-rose-600' : 'text-slate-400'}
                  onSave={(v) => onPatch(task.notion_block_id, { progress_rate_prev: v })} />
              </td>
              <td className={`${TD} whitespace-nowrap`}><StatusBadge status={task.status} /></td>
              <td className={`${TD} whitespace-nowrap`}>
                <EditableCell kind="text" raw={task.status_prev ?? ''}
                  display={<StatusBadge status={task.status_prev} muted />}
                  onSave={(v) => onPatch(task.notion_block_id, { status_prev: v })} />
              </td>
              <td className={`${TD} whitespace-nowrap text-slate-500`}>{task.priority || '—'}</td>
              <td className={`${TD} align-top min-w-[22rem]`}>
                <NoteCell value={task.note ?? ''} saving={false} onSave={(v) => onPatch(task.notion_block_id, { note: v })} />
              </td>
              <td className={`${TD} align-top min-w-[22rem]`}>
                <NoteCell value={task.memo ?? ''} saving={false} onSave={(v) => onPatch(task.notion_block_id, { memo: v })} />
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={15} className="border border-slate-300 text-center text-slate-400 py-6 text-sm">フィルター条件に一致するタスクがありません。</td></tr>
          )}
        </tbody>
      </table>
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
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
