import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../lib/api'

// Backlog Git を GitHub 風に閲覧・レビューするページ。
// リポジトリ/PR は Backlog REST API、ファイルは backend の git ミラーから取得。
// 行の左の＋でレビューコメント(markdown)を下書きし、最後に「一斉送信」で PR コメントに1件で投稿する。

type RepoGroup = { project_key: string; project_name: string; repositories: { name: string; description: string | null }[] }
type PullRequest = { number: number; summary: string; description: string; base: string; branch: string; created_user: string; created: string }
type TreeFile = { path: string; size: number }
type DraftComment = { path: string; line: number; code: string; body: string }

export default function GitPage() {
  const [groups, setGroups] = useState<RepoGroup[]>([])
  const [projectKey, setProjectKey] = useState('')
  const [repoName, setRepoName] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [files, setFiles] = useState<TreeFile[]>([])
  const [pulls, setPulls] = useState<PullRequest[]>([])
  const [prNumber, setPrNumber] = useState<number | ''>('')
  const [filePath, setFilePath] = useState('')
  const [content, setContent] = useState('')
  const [fileFilter, setFileFilter] = useState('')
  const [drafts, setDrafts] = useState<DraftComment[]>([])
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [posted, setPosted] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e) {
      const axiosError = e as { response?: { data?: { error?: string } }; message?: string }
      setErr(axiosError.response?.data?.error ?? axiosError.message ?? '失敗しました')
    } finally { setBusy(null) }
  }

  // 初回: リポジトリ一覧
  useEffect(() => {
    run('repos', async () => {
      const r = await api.get<RepoGroup[]>('/backlog_git/repositories')
      setGroups(r.data)
      if (r.data.length) {
        setProjectKey(r.data[0].project_key)
        if (r.data[0].repositories.length) setRepoName(r.data[0].repositories[0].name)
      }
    })
  }, [])

  const loadTree = (sync = false) => run(sync ? 'sync' : 'tree', async () => {
    if (!projectKey || !repoName) return
    const r = await api.get<{ branches: string[]; branch: string; files: TreeFile[] }>('/backlog_git/tree', {
      params: { project: projectKey, repo: repoName, branch: branch || undefined, ...(sync ? { sync: 1 } : {}) },
    })
    setBranches(r.data.branches); setBranch(r.data.branch); setFiles(r.data.files)
    const prs = await api.get<PullRequest[]>('/backlog_git/pull_requests', { params: { project: projectKey, repo: repoName } })
    setPulls(prs.data)
    if (prs.data.length && prNumber === '') setPrNumber(prs.data[0].number)
  })

  // リポジトリ切替でツリー再取得（下書きはリポジトリごとに破棄）
  useEffect(() => {
    if (!projectKey || !repoName) return
    setFiles([]); setFilePath(''); setContent(''); setDrafts([]); setBranch(''); setPrNumber('')
    void loadTree()
  }, [projectKey, repoName])

  const openFile = (path: string) => run(`file-${path}`, async () => {
    const r = await api.get<{ content: string }>('/backlog_git/file', { params: { project: projectKey, repo: repoName, branch, path } })
    setFilePath(path); setContent(r.data.content); setEditingLine(null)
  })

  const lines = useMemo(() => (content ? content.split('\n') : []), [content])
  const visibleFiles = useMemo(
    () => (fileFilter ? files.filter((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase())) : files),
    [files, fileFilter],
  )

  const startDraft = (lineNumber: number) => {
    const existing = drafts.find((d) => d.path === filePath && d.line === lineNumber)
    setDraftBody(existing?.body ?? '')
    setEditingLine(lineNumber)
    setPreview(false)
  }

  const saveDraft = () => {
    if (editingLine == null || !draftBody.trim()) { setEditingLine(null); return }
    const draft: DraftComment = { path: filePath, line: editingLine, code: lines[editingLine - 1] ?? '', body: draftBody.trim() }
    setDrafts((prev) => [...prev.filter((d) => !(d.path === filePath && d.line === editingLine)), draft])
    setEditingLine(null); setDraftBody('')
  }

  const removeDraft = (draft: DraftComment) =>
    setDrafts((prev) => prev.filter((d) => !(d.path === draft.path && d.line === draft.line)))

  const submitAll = () => run('submit', async () => {
    if (!prNumber || drafts.length === 0) return
    const r = await api.post<{ posted: number }>('/backlog_git/review', {
      project: projectKey, repo: repoName, number: prNumber, comments: drafts,
    })
    setPosted(`PR #${prNumber} に ${r.data.posted} 件のレビューを投稿しました`)
    setDrafts([])
    setTimeout(() => setPosted(null), 5000)
  })

  const group = groups.find((g) => g.project_key === projectKey)

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4 shadow-md space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text)]">🌿 Git（Backlog）</span>
          <select value={projectKey} onChange={(e) => { setProjectKey(e.target.value); setRepoName('') }}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
            {groups.map((g) => <option key={g.project_key} value={g.project_key}>{g.project_name}</option>)}
          </select>
          <select value={repoName} onChange={(e) => setRepoName(e.target.value)}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
            <option value="">リポジトリを選択</option>
            {group?.repositories.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
          {branches.length > 0 && (
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setFilePath(''); setContent('') }}
              onBlur={() => loadTree()}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <button onClick={() => loadTree(true)} disabled={!!busy || !repoName}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 disabled:opacity-50">
            {busy === 'sync' ? '同期中…' : '🔄 同期'}
          </button>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--color-text-sub)]">
            レビュー先PR:
            <select value={prNumber} onChange={(e) => setPrNumber(e.target.value ? Number(e.target.value) : '')}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
              <option value="">選択（オープンPR {pulls.length}件）</option>
              {pulls.map((pr) => <option key={pr.number} value={pr.number}>#{pr.number} {pr.summary}</option>)}
            </select>
          </span>
        </div>
        {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
        {posted && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✅ {posted}</div>}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        {/* ファイルツリー */}
        <div className="glass w-full rounded-2xl p-3 shadow-md lg:w-72 lg:shrink-0">
          <input value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="ファイル名で絞り込み"
            className="mb-2 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
          <div className="max-h-[70vh] overflow-auto">
            {busy === 'tree' && <div className="text-xs text-[var(--color-text-sub)]">読込中…（初回はclone）</div>}
            {visibleFiles.map((f) => (
              <button key={f.path} onClick={() => openFile(f.path)}
                className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ${filePath === f.path ? 'bg-fuchsia-100 font-semibold text-fuchsia-700' : 'text-[var(--color-text)] hover:bg-gray-100'}`}
                title={f.path}>
                📄 {f.path}
              </button>
            ))}
            {!busy && files.length === 0 && repoName && <div className="text-xs text-[var(--color-text-sub)]">「🔄 同期」でリポジトリを取得します</div>}
          </div>
        </div>

        {/* コード表示 + 行レビュー */}
        <div className="glass min-w-0 flex-1 rounded-2xl p-3 shadow-md">
          {filePath ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="truncate font-mono text-xs font-semibold text-[var(--color-text)]">{filePath}</span>
                <span className="text-[10px] text-[var(--color-text-sub)]">{lines.length} 行 / 行の左の＋でレビュー</span>
              </div>
              <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-white font-mono text-[11px] leading-5">
                {lines.map((text, index) => {
                  const lineNumber = index + 1
                  const draft = drafts.find((d) => d.path === filePath && d.line === lineNumber)
                  return (
                    <div key={lineNumber}>
                      <div className={`group flex ${draft ? 'bg-amber-50' : 'hover:bg-sky-50'}`}>
                        <button onClick={() => startDraft(lineNumber)} title="この行にレビューコメント"
                          className="w-5 shrink-0 select-none text-center text-fuchsia-500 opacity-0 group-hover:opacity-100">＋</button>
                        <span className="w-10 shrink-0 select-none border-r border-[var(--color-border)] pr-1 text-right text-gray-400">{lineNumber}</span>
                        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-2">{text || ' '}</pre>
                        {draft && <span className="pr-2 text-amber-500" title="下書きあり">💬</span>}
                      </div>
                      {editingLine === lineNumber && (
                        <div className="border-y border-fuchsia-200 bg-fuchsia-50/60 p-2 font-sans">
                          <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-sub)]">
                            <span className="font-mono">{filePath}:{lineNumber}</span>
                            <button onClick={() => setPreview((v) => !v)} className={`rounded px-1.5 py-0.5 ${preview ? 'bg-fuchsia-500 text-white' : 'border border-fuchsia-300 text-fuchsia-600'}`}>
                              {preview ? '編集に戻る' : 'プレビュー'}
                            </button>
                          </div>
                          {preview ? (
                            <div className="prose prose-sm max-w-none rounded border border-[var(--color-border)] bg-white p-2 text-xs">
                              <ReactMarkdown>{draftBody || '(空)'}</ReactMarkdown>
                            </div>
                          ) : (
                            <textarea value={draftBody} autoFocus rows={3}
                              onChange={(e) => setDraftBody(e.target.value)}
                              placeholder="レビューコメント（markdown可）"
                              className="w-full rounded border border-fuchsia-300 px-2 py-1 text-xs" />
                          )}
                          <div className="mt-1 flex gap-1">
                            <button onClick={saveDraft} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">下書き保存</button>
                            <button onClick={() => setEditingLine(null)} className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px]">キャンセル</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-xs text-[var(--color-text-sub)]">左のツリーからファイルを選択してください</div>
          )}
        </div>
      </div>

      {/* レビュー下書き一覧 + 一斉送信 */}
      {drafts.length > 0 && (
        <div className="glass sticky bottom-2 rounded-2xl border border-amber-200 p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text)]">📝 レビュー下書き {drafts.length}件</span>
            <button onClick={submitAll} disabled={!!busy || !prNumber}
              title={prNumber ? `PR #${prNumber} に1コメントへ結合して投稿` : '上部でレビュー先PRを選択してください'}
              className="ml-auto rounded-lg bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'submit' ? '送信中…' : `🚀 一斉送信${prNumber ? `（PR #${prNumber}）` : ''}`}
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {drafts.map((d) => (
              <div key={`${d.path}:${d.line}`} className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-[11px]">
                <span className="shrink-0 font-mono text-fuchsia-600">{d.path}:{d.line}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{d.body}</span>
                <button onClick={() => startDraftFrom(d)} className="text-[var(--color-text-sub)] hover:text-fuchsia-600" title="編集">✏️</button>
                <button onClick={() => removeDraft(d)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  // 下書き一覧から編集: 該当ファイルを開いてから編集欄を出す
  function startDraftFrom(draft: DraftComment) {
    if (draft.path !== filePath) {
      void openFile(draft.path).then(() => { setDraftBody(draft.body); setEditingLine(draft.line) })
    } else {
      setDraftBody(draft.body); setEditingLine(draft.line)
    }
  }
}
