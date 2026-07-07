import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// 改行をそのまま反映(breaks)＋表・リンク等のGFM対応でmarkdownを描画
const MD_PLUGINS = [remarkGfm, remarkBreaks]
import { api } from '../lib/api'

// Backlog Git を GitHub 風に閲覧・レビューするページ。
// 🔀 プルリク: PR一覧 → 詳細（説明・既存コメント・変更ファイルdiff）。diff行の＋でレビュー下書き。
// 📁 ファイル: ブランチのファイルツリー → コード表示。行の＋でレビュー下書き。
// 下書きは「一斉送信」で 1 コメントに結合して PR へ投稿。単発コメントも PR 詳細から送れる。

type RepoGroup = { project_key: string; project_name: string; repositories: { name: string; description: string | null }[] }
type PullRequest = { number: number; summary: string; description: string; base: string; branch: string; created_user: string; created: string }
type TreeFile = { path: string; size: number }
type DiffLine = { type: 'add' | 'del' | 'ctx' | 'hunk'; old_no?: number; new_no?: number; text: string }
type DiffFile = { path: string; deleted: boolean; lines: DiffLine[] }
type PrComment = { id: number; user: string; content: string; created: string }
type PrDetail = PullRequest & { status?: string; comments: PrComment[]; files: DiffFile[]; diff_error?: string | null }
type DraftComment = { path: string; line: number; code: string; body: string }
type SystemNote = { id: number; user: string; mine: boolean; content: string; created: string }

const LINE_BG: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-50',
  del: 'bg-red-50 text-red-700',
  ctx: '',
  hunk: 'bg-sky-50 text-sky-700',
}

export default function GitPage() {
  const [view, setView] = useState<'prs' | 'files'>('prs')
  const [groups, setGroups] = useState<RepoGroup[]>([])
  const [projectKey, setProjectKey] = useState('')
  const [repoName, setRepoName] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [files, setFiles] = useState<TreeFile[]>([])
  const [pulls, setPulls] = useState<PullRequest[]>([])
  const [prDetail, setPrDetail] = useState<PrDetail | null>(null)
  const [prComment, setPrComment] = useState('')
  const [commentTab, setCommentTab] = useState<'backlog' | 'system'>('backlog')
  const [systemNotes, setSystemNotes] = useState<SystemNote[]>([])
  const [systemNoteDraft, setSystemNoteDraft] = useState('')
  const [showDescription, setShowDescription] = useState(true)
  const [filePath, setFilePath] = useState('')
  const [content, setContent] = useState('')
  const [fileFilter, setFileFilter] = useState('')
  const [drafts, setDrafts] = useState<DraftComment[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null) // "path:line"
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

  // 初回: リポジトリ一覧（前回選んだプロジェクト/リポジトリを復元）
  useEffect(() => {
    run('repos', async () => {
      const r = await api.get<RepoGroup[]>('/backlog_git/repositories')
      setGroups(r.data)
      if (!r.data.length) return
      const savedProject = localStorage.getItem('gitProjectKey')
      const savedRepo = localStorage.getItem('gitRepoName')
      const initialGroup = r.data.find((g) => g.project_key === savedProject) ?? r.data[0]
      setProjectKey(initialGroup.project_key)
      const initialRepo = initialGroup.repositories.find((repo) => repo.name === savedRepo) ?? initialGroup.repositories[0]
      if (initialRepo) setRepoName(initialRepo.name)
    })
  }, [])

  // 選択を記憶（次回開いたとき同じプロジェクト/リポジトリから）
  useEffect(() => {
    if (projectKey) localStorage.setItem('gitProjectKey', projectKey)
    if (repoName) localStorage.setItem('gitRepoName', repoName)
  }, [projectKey, repoName])

  const loadPulls = async () => {
    const prs = await api.get<PullRequest[]>('/backlog_git/pull_requests', { params: { project: projectKey, repo: repoName } })
    setPulls(prs.data)
  }

  // branchOverride を渡すことで「前のリポジトリのブランチ名」を引き継がない
  const loadTree = (sync = false, branchOverride?: string) => run(sync ? 'sync' : 'tree', async () => {
    if (!projectKey || !repoName) return
    const useBranch = branchOverride ?? branch
    const r = await api.get<{ branches: string[]; branch: string; files: TreeFile[] }>('/backlog_git/tree', {
      params: { project: projectKey, repo: repoName, branch: useBranch || undefined, ...(sync ? { sync: 1 } : {}) },
    })
    setBranches(r.data.branches); setBranch(r.data.branch); setFiles(r.data.files)
    await loadPulls()
  })

  const loadSystemNotes = async (number: number) => {
    const r = await api.get<SystemNote[]>('/backlog_git/notes', { params: { project: projectKey, repo: repoName, number } })
    setSystemNotes(r.data)
  }

  const openPr = (number: number) => run(`pr-${number}`, async () => {
    const r = await api.get<PrDetail>('/backlog_git/pr_detail', { params: { project: projectKey, repo: repoName, number } })
    setPrDetail(r.data)
    setShowDescription(true)
    await loadSystemNotes(number).catch(() => setSystemNotes([]))
  })

  // リポジトリ切替: 状態をリセットして PR 一覧を取得（ファイルツリーはファイルタブで必要になったら）
  useEffect(() => {
    if (!projectKey || !repoName) return
    setFiles([]); setFilePath(''); setContent(''); setDrafts([]); setBranch(''); setBranches([]); setPrDetail(null)
    void run('pulls', loadPulls)
  }, [projectKey, repoName])

  // ファイルタブを開いた時にツリー未取得なら取得
  useEffect(() => {
    if (view === 'files' && repoName && files.length === 0) void loadTree(false, '')
  }, [view, repoName])

  const openFile = (path: string) => run(`file-${path}`, async () => {
    const r = await api.get<{ content: string }>('/backlog_git/file', { params: { project: projectKey, repo: repoName, branch, path } })
    setFilePath(path); setContent(r.data.content); setEditingKey(null)
  })

  const lines = useMemo(() => (content ? content.split('\n') : []), [content])
  const visibleFiles = useMemo(
    () => (fileFilter ? files.filter((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase())) : files),
    [files, fileFilter],
  )

  const draftAt = (path: string, line: number) => drafts.find((d) => d.path === path && d.line === line)

  const startDraft = (path: string, line: number) => {
    setDraftBody(draftAt(path, line)?.body ?? '')
    setEditingKey(`${path}:${line}`)
    setPreview(false)
  }

  const saveDraft = () => {
    if (!editingKey || !draftBody.trim()) { setEditingKey(null); return }
    const [path, lineText] = splitKey(editingKey)
    const line = Number(lineText)
    const code = view === 'prs'
      ? (prDetail?.files.find((f) => f.path === path)?.lines.find((l) => l.new_no === line)?.text ?? '')
      : (lines[line - 1] ?? '')
    setDrafts((prev) => [...prev.filter((d) => !(d.path === path && d.line === line)), { path, line, code, body: draftBody.trim() }])
    setEditingKey(null); setDraftBody('')
  }

  const removeDraft = (draft: DraftComment) =>
    setDrafts((prev) => prev.filter((d) => !(d.path === draft.path && d.line === draft.line)))

  const reviewTarget = prDetail?.number
  const submitAll = () => run('submit', async () => {
    if (!reviewTarget || drafts.length === 0) return
    const r = await api.post<{ posted: number }>('/backlog_git/review', {
      project: projectKey, repo: repoName, number: reviewTarget, comments: drafts,
    })
    setPosted(`PR #${reviewTarget} に ${r.data.posted} 件のレビューを投稿しました`)
    setDrafts([])
    void openPr(reviewTarget)
    setTimeout(() => setPosted(null), 5000)
  })

  // システム内のみのメモ（Backlog には送らない）
  const submitSystemNote = () => run('sysnote', async () => {
    if (!prDetail || !systemNoteDraft.trim()) return
    await api.post('/backlog_git/notes', { project: projectKey, repo: repoName, number: prDetail.number, content: systemNoteDraft.trim() })
    setSystemNoteDraft('')
    await loadSystemNotes(prDetail.number)
  })

  const deleteSystemNote = (id: number) => run(`delnote-${id}`, async () => {
    if (!prDetail) return
    await api.delete(`/backlog_git/notes/${id}`)
    await loadSystemNotes(prDetail.number)
  })

  const submitComment = () => run('comment', async () => {
    if (!prDetail || !prComment.trim()) return
    await api.post('/backlog_git/comment', { project: projectKey, repo: repoName, number: prDetail.number, content: prComment.trim() })
    setPrComment('')
    void openPr(prDetail.number)
  })

  const group = groups.find((g) => g.project_key === projectKey)

  // 行レビューの編集ボックス（PR diff / ファイル表示 共通）
  const renderDraftEditor = (path: string, line: number) => (
    <div className="border-y border-fuchsia-200 bg-fuchsia-50/60 p-2 font-sans">
      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-sub)]">
        <span className="font-mono">{path}:{line}</span>
        <button onClick={() => setPreview((v) => !v)} className={`rounded px-1.5 py-0.5 ${preview ? 'bg-fuchsia-500 text-white' : 'border border-fuchsia-300 text-fuchsia-600'}`}>
          {preview ? '編集に戻る' : 'プレビュー'}
        </button>
      </div>
      {preview ? (
        <div className="prose prose-sm max-w-none rounded border border-[var(--color-border)] bg-white p-2 text-xs">
          <ReactMarkdown remarkPlugins={MD_PLUGINS}>{draftBody || '(空)'}</ReactMarkdown>
        </div>
      ) : (
        <textarea value={draftBody} autoFocus rows={3}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="レビューコメント（markdown可）"
          className="w-full rounded border border-fuchsia-300 px-2 py-1 text-xs" />
      )}
      <div className="mt-1 flex gap-1">
        <button onClick={saveDraft} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">下書き保存</button>
        <button onClick={() => setEditingKey(null)} className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px]">キャンセル</button>
      </div>
    </div>
  )

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
          <div className="flex items-center gap-1">
            <button onClick={() => setView('prs')}
              className={`rounded px-2 py-1 text-xs font-semibold ${view === 'prs' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>🔀 プルリク</button>
            <button onClick={() => setView('files')}
              className={`rounded px-2 py-1 text-xs font-semibold ${view === 'files' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>📁 ファイル</button>
          </div>
          {view === 'files' && branches.length > 0 && (
            <select value={branch}
              onChange={(e) => { const next = e.target.value; setBranch(next); setFilePath(''); setContent(''); void loadTree(false, next) }}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <button onClick={() => (view === 'files' ? loadTree(true) : run('sync', async () => { await loadPulls(); if (prDetail) await openPr(prDetail.number) }))}
            disabled={!!busy || !repoName}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 disabled:opacity-50">
            {busy === 'sync' ? '同期中…' : '🔄 同期'}
          </button>
        </div>
        {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
        {posted && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✅ {posted}</div>}
      </div>

      {view === 'prs' ? (
        <div className="flex flex-col gap-3 lg:flex-row">
          {/* PR 一覧 */}
          <div className="glass w-full rounded-2xl p-3 shadow-md lg:w-80 lg:shrink-0">
            <div className="mb-1 text-xs font-semibold text-[var(--color-text)]">オープンPR {pulls.length}件</div>
            <div className="max-h-[70vh] space-y-1 overflow-auto">
              {pulls.map((pr) => (
                <button key={pr.number} onClick={() => openPr(pr.number)}
                  className={`block w-full rounded-lg border px-2 py-1.5 text-left text-[11px] ${prDetail?.number === pr.number ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-[var(--color-border)] bg-white hover:bg-gray-50'}`}>
                  <div className="font-semibold text-[var(--color-text)]">#{pr.number} {pr.summary}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">{pr.created_user} / {pr.branch} → {pr.base}</div>
                </button>
              ))}
              {pulls.length === 0 && <div className="text-xs text-[var(--color-text-sub)]">{repoName ? 'オープンのPRはありません' : 'リポジトリを選択してください'}</div>}
            </div>
          </div>

          {/* PR 詳細 */}
          <div className="glass min-w-0 flex-1 rounded-2xl p-3 shadow-md">
            {busy?.startsWith('pr-') && <div className="text-xs text-[var(--color-text-sub)]">PR取得中…（初回はリポジトリcloneのため時間がかかります）</div>}
            {prDetail ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-bold text-[var(--color-text)]">#{prDetail.number} {prDetail.summary}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-text-sub)]">
                    {prDetail.created_user} / <span className="font-mono">{prDetail.branch}</span> → <span className="font-mono">{prDetail.base}</span>
                    {prDetail.status && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">{prDetail.status}</span>}
                  </div>
                </div>

                {/* 説明 */}
                {prDetail.description?.trim() && (
                  <div className="rounded-lg border border-[var(--color-border)] bg-white">
                    <button onClick={() => setShowDescription((v) => !v)} className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[var(--color-text-sub)]">
                      <span>{showDescription ? '▼' : '▶'}</span> 説明
                    </button>
                    {showDescription && (
                      <div className="prose prose-sm max-w-none border-t border-[var(--color-border)] p-2 text-xs">
                        <ReactMarkdown remarkPlugins={MD_PLUGINS}>{prDetail.description}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {/* 変更ファイル(diff) */}
                <div>
                  <div className="mb-1 text-xs font-semibold text-[var(--color-text)]">📝 変更ファイル {prDetail.files.length}件 <span className="ml-1 font-normal text-[10px] text-[var(--color-text-sub)]">行の左の＋でレビュー</span></div>
                  {prDetail.diff_error && <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">diff取得不可: {prDetail.diff_error}</div>}
                  <div className="space-y-2">
                    {prDetail.files.map((file) => (
                      <div key={file.path} className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
                        <div className="border-b border-[var(--color-border)] bg-gray-50 px-2 py-1 font-mono text-[11px] font-semibold text-[var(--color-text)]">
                          {file.path}{file.deleted && <span className="ml-2 text-red-500">(削除)</span>}
                        </div>
                        <div className="max-h-96 overflow-auto font-mono text-[11px] leading-5">
                          {file.lines.map((diffLine, index) => {
                            const canComment = diffLine.new_no != null && diffLine.type !== 'hunk'
                            const draft = canComment ? draftAt(file.path, diffLine.new_no!) : undefined
                            return (
                              <div key={index}>
                                <div className={`group flex ${LINE_BG[diffLine.type]} ${draft ? 'bg-amber-50' : ''}`}>
                                  {canComment ? (
                                    <button onClick={() => startDraft(file.path, diffLine.new_no!)} title="この行にレビューコメント"
                                      className="w-5 shrink-0 select-none text-center text-fuchsia-500 opacity-0 group-hover:opacity-100">＋</button>
                                  ) : <span className="w-5 shrink-0" />}
                                  <span className="w-9 shrink-0 select-none pr-1 text-right text-gray-400">{diffLine.old_no ?? ''}</span>
                                  <span className="w-9 shrink-0 select-none border-r border-[var(--color-border)] pr-1 text-right text-gray-400">{diffLine.new_no ?? ''}</span>
                                  <span className="w-4 shrink-0 select-none text-center text-gray-400">{diffLine.type === 'add' ? '+' : diffLine.type === 'del' ? '-' : ''}</span>
                                  <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1">{diffLine.text || ' '}</pre>
                                  {draft && <span className="pr-2 text-amber-500" title="下書きあり">💬</span>}
                                </div>
                                {canComment && editingKey === `${file.path}:${diffLine.new_no}` && renderDraftEditor(file.path, diffLine.new_no!)}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* コメント: Backlog(相手に見える) / システム内のみ(Backlogに送らない) をタブで分離 */}
                <div>
                  <div className="mb-2 flex items-center gap-1">
                    <button onClick={() => setCommentTab('backlog')}
                      className={`rounded px-2 py-1 text-xs font-semibold ${commentTab === 'backlog' ? 'bg-sky-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
                      💬 Backlogコメント {prDetail.comments.length}
                    </button>
                    <button onClick={() => setCommentTab('system')}
                      className={`rounded px-2 py-1 text-xs font-semibold ${commentTab === 'system' ? 'bg-violet-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
                      🔒 システム内 {systemNotes.length}
                    </button>
                    <span className="ml-1 text-[10px] text-[var(--color-text-sub)]">
                      {commentTab === 'backlog' ? 'BacklogのPRに投稿されます（相手に見える）' : 'このシステム内だけ。Backlogには送られません'}
                    </span>
                  </div>

                  {commentTab === 'backlog' ? (
                    <>
                      <div className="space-y-2">
                        {prDetail.comments.map((comment) => (
                          <div key={comment.id} className="rounded-lg border border-[var(--color-border)] bg-white p-2">
                            <div className="mb-1 text-[10px] text-[var(--color-text-sub)]">{comment.user} ・ {new Date(comment.created).toLocaleString('ja-JP')}</div>
                            <div className="prose prose-sm max-w-none text-xs"><ReactMarkdown remarkPlugins={MD_PLUGINS}>{comment.content}</ReactMarkdown></div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-white p-2">
                        <textarea value={prComment} onChange={(e) => setPrComment(e.target.value)} rows={3}
                          placeholder="PRにコメントする（markdown可・Backlogに投稿されます）"
                          className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs" />
                        <div className="mt-1 flex justify-end">
                          <button onClick={submitComment} disabled={!!busy || !prComment.trim()}
                            className="rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50">
                            {busy === 'comment' ? '送信中…' : '💬 Backlogへ送信'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {systemNotes.map((note) => (
                          <div key={note.id} className="rounded-lg border border-violet-200 bg-violet-50/40 p-2">
                            <div className="mb-1 flex items-center text-[10px] text-[var(--color-text-sub)]">
                              <span>{note.user} ・ {new Date(note.created).toLocaleString('ja-JP')}</span>
                              {note.mine && (
                                <button onClick={() => deleteSystemNote(note.id)} title="削除"
                                  className="ml-auto text-gray-400 hover:text-red-500">🗑</button>
                              )}
                            </div>
                            <div className="prose prose-sm max-w-none text-xs"><ReactMarkdown remarkPlugins={MD_PLUGINS}>{note.content}</ReactMarkdown></div>
                          </div>
                        ))}
                        {systemNotes.length === 0 && <div className="text-xs text-[var(--color-text-sub)]">まだメモはありません</div>}
                      </div>
                      <div className="mt-2 rounded-lg border border-violet-200 bg-white p-2">
                        <textarea value={systemNoteDraft} onChange={(e) => setSystemNoteDraft(e.target.value)} rows={3}
                          placeholder="システム内メモ（markdown可・Backlogには送られません）"
                          className="w-full rounded border border-violet-200 px-2 py-1 text-xs" />
                        <div className="mt-1 flex justify-end">
                          <button onClick={submitSystemNote} disabled={!!busy || !systemNoteDraft.trim()}
                            className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50">
                            {busy === 'sysnote' ? '保存中…' : '🔒 システム内に保存'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              !busy && <div className="py-10 text-center text-xs text-[var(--color-text-sub)]">左の一覧からPRを選択してください</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          {/* ファイルツリー */}
          <div className="glass w-full rounded-2xl p-3 shadow-md lg:w-72 lg:shrink-0">
            <input value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="ファイル名で絞り込み"
              className="mb-2 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
            <div className="max-h-[70vh] overflow-auto">
              {(busy === 'tree' || busy === 'sync') && <div className="text-xs text-[var(--color-text-sub)]">読込中…（初回はclone）</div>}
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
                    const draft = draftAt(filePath, lineNumber)
                    return (
                      <div key={lineNumber}>
                        <div className={`group flex ${draft ? 'bg-amber-50' : 'hover:bg-sky-50'}`}>
                          <button onClick={() => startDraft(filePath, lineNumber)} title="この行にレビューコメント"
                            className="w-5 shrink-0 select-none text-center text-fuchsia-500 opacity-0 group-hover:opacity-100">＋</button>
                          <span className="w-10 shrink-0 select-none border-r border-[var(--color-border)] pr-1 text-right text-gray-400">{lineNumber}</span>
                          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-2">{text || ' '}</pre>
                          {draft && <span className="pr-2 text-amber-500" title="下書きあり">💬</span>}
                        </div>
                        {editingKey === `${filePath}:${lineNumber}` && renderDraftEditor(filePath, lineNumber)}
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
      )}

      {/* レビュー下書き一覧 + 一斉送信 */}
      {drafts.length > 0 && (
        <div className="glass sticky bottom-2 rounded-2xl border border-amber-200 p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text)]">📝 レビュー下書き {drafts.length}件</span>
            <button onClick={submitAll} disabled={!!busy || !reviewTarget}
              title={reviewTarget ? `PR #${reviewTarget} に1コメントへ結合して投稿` : 'プルリクタブでPRを開いてください'}
              className="ml-auto rounded-lg bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'submit' ? '送信中…' : `🚀 一斉送信${reviewTarget ? `（PR #${reviewTarget}）` : ''}`}
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {drafts.map((d) => (
              <div key={`${d.path}:${d.line}`} className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-[11px]">
                <span className="shrink-0 font-mono text-fuchsia-600">{d.path}:{d.line}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{d.body}</span>
                <button onClick={() => { setDraftBody(d.body); setEditingKey(`${d.path}:${d.line}`) }} className="text-[var(--color-text-sub)] hover:text-fuchsia-600" title="編集">✏️</button>
                <button onClick={() => removeDraft(d)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// "path:line" を最後のコロンで分割（パスにコロンは通常含まれない前提）
function splitKey(key: string): [string, string] {
  const lastColon = key.lastIndexOf(':')
  return [key.slice(0, lastColon), key.slice(lastColon + 1)]
}
