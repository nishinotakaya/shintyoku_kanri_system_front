import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { api } from '../../lib/api'

// 改行をそのまま反映(breaks)＋表・リンク等のGFM対応でmarkdownを描画
const MD_PLUGINS = [remarkGfm, remarkBreaks]

// GitHub を GitPage 内から閲覧・コメントするパネル。
// リポジトリ選択 → PR一覧 → PR詳細（説明・変更ファイルdiff・コメント）の3段構成。

type GithubSetting = { has_token: boolean; default_repos: string; display_name: string | null }
type GithubRepository = {
  full_name: string
  name: string
  owner: string
  private: boolean
  html_url: string
  description: string | null
  updated_at: string
  open_issues_count: number
}
type GithubPullRequest = {
  number: number
  title: string
  state: string
  user: string
  html_url: string
  created_at: string
  updated_at: string
  draft: boolean
  merged_at: string | null
  comments: number
  body: string | null
}
type GithubPrComment = { id: number; user: string; body: string; created_at: string; html_url: string }
type GithubPrFile = { filename: string; status: string; additions: number; deletions: number; patch: string | null }
type PatchLine = { type: 'add' | 'del' | 'ctx' | 'hunk'; newNo: number | null; text: string }
type DraftComment = { path: string; line: number; code: string; body: string }
type GithubPrDetail = {
  number: number
  title: string
  state: string
  body: string | null
  user: string
  html_url: string
  merged: boolean
  head_sha: string | null
  comments: GithubPrComment[]
  files: GithubPrFile[]
}
type GithubNotification = {
  id: string
  reason: string
  repo_full_name: string | null
  title: string | null
  type: string | null
  number: number | null
  updated_at: string
  html_url: string | null
  comment: { user: string; body: string; html_url: string } | null
}

// 通知理由の日本語ラベルと色（メンション/レビュー依頼を目立たせる）
const REASON_META: Record<string, { label: string; cls: string }> = {
  mention: { label: 'メンション', cls: 'bg-fuchsia-100 text-fuchsia-700' },
  team_mention: { label: 'チーム宛て', cls: 'bg-fuchsia-100 text-fuchsia-700' },
  review_requested: { label: 'レビュー依頼', cls: 'bg-amber-100 text-amber-700' },
  comment: { label: 'コメント', cls: 'bg-sky-100 text-sky-700' },
  assign: { label: 'アサイン', cls: 'bg-emerald-100 text-emerald-700' },
  author: { label: '自分のPR', cls: 'bg-gray-100 text-gray-700' },
}

const STATE_FILTERS: { key: 'all' | 'open' | 'closed'; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'open', label: 'オープン' },
  { key: 'closed', label: 'クローズ' },
]

const FILE_STATUS_LABEL: Record<string, string> = {
  added: '追加', removed: '削除', modified: '変更', renamed: 'リネーム',
}
const FILE_STATUS_STYLE: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  removed: 'bg-red-100 text-red-700',
  modified: 'bg-amber-100 text-amber-700',
  renamed: 'bg-sky-100 text-sky-700',
}

const PATCH_LINE_BG: Record<PatchLine['type'], string> = {
  add: 'bg-emerald-50 text-emerald-700',
  del: 'bg-red-50 text-red-700',
  ctx: '',
  hunk: 'bg-sky-50 text-sky-700',
}

// unified diff の patch 文字列をハンク解析し、新ファイル側の行番号(newNo)を各行に付与する。
// del 行は新ファイルに存在しないので newNo は null のまま進めない。
function parsePatch(patch: string): PatchLine[] {
  const patchLines: PatchLine[] = []
  let newLineNumber = 0
  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const hunkMatch = rawLine.match(/\+(\d+)/)
      newLineNumber = hunkMatch ? Number(hunkMatch[1]) : 0
      patchLines.push({ type: 'hunk', newNo: null, text: rawLine })
      continue
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      patchLines.push({ type: 'add', newNo: newLineNumber, text: rawLine })
      newLineNumber += 1
      continue
    }
    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      patchLines.push({ type: 'del', newNo: null, text: rawLine })
      continue
    }
    patchLines.push({ type: 'ctx', newNo: newLineNumber, text: rawLine })
    newLineNumber += 1
  }
  return patchLines
}

// "path:line" を最後のコロンで分割（パスにコロンは通常含まれない前提）
function splitDraftKey(key: string): [string, string] {
  const lastColon = key.lastIndexOf(':')
  return [key.slice(0, lastColon), key.slice(lastColon + 1)]
}

export default function GithubPanel() {
  const [setting, setSetting] = useState<GithubSetting | null>(null)
  const [repositories, setRepositories] = useState<GithubRepository[]>([])
  const [selectedRepo, setSelectedRepo] = useState('')
  const [pullRequests, setPullRequests] = useState<GithubPullRequest[]>([])
  const [prStateFilter, setPrStateFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [prDetail, setPrDetail] = useState<GithubPrDetail | null>(null)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<GithubNotification[]>([])
  const [showInbox, setShowInbox] = useState(true)
  // 変更ファイル単位のレビューコメント（開いているファイルのパスと下書き）
  const [fileCommentPath, setFileCommentPath] = useState<string | null>(null)
  const [fileCommentDraft, setFileCommentDraft] = useState('')
  // パネル見出しのインライン編集
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // 一覧エリアごとの取得エラー（再試行ボタンで同じ取得を再実行する）
  const [reposError, setReposError] = useState<string | null>(null)
  const [prsError, setPrsError] = useState<string | null>(null)
  const [prDetailError, setPrDetailError] = useState<string | null>(null)
  // 再試行用に直近リクエストしたPR番号・リポジトリを覚えておく
  const [openingPrNumber, setOpeningPrNumber] = useState<number | null>(null)
  const [openingRepoFullName, setOpeningRepoFullName] = useState('')
  // 行ごとのレビュー下書き（一斉送信で1コメントに結合してPRへ投稿）
  const [drafts, setDrafts] = useState<DraftComment[]>([])
  const [editingDraftKey, setEditingDraftKey] = useState<string | null>(null) // "path:line"
  const [draftBody, setDraftBody] = useState('')
  const [draftCode, setDraftCode] = useState('')
  const [draftPreview, setDraftPreview] = useState(false)
  // PR一覧行から直接投稿するインラインコメント（選択中PRでなくても投稿できる）
  const [quickCommentPrNumber, setQuickCommentPrNumber] = useState<number | null>(null)
  const [quickCommentText, setQuickCommentText] = useState('')
  const [posted, setPosted] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e) {
      const axiosError = e as { response?: { data?: { error?: string } }; message?: string }
      setErr(axiosError.response?.data?.error ?? axiosError.message ?? '失敗しました')
    } finally { setBusy(null) }
  }

  // 一覧エリア個別のエラーメッセージ抽出（再試行ボタンの表示用）
  const extractErrorMessage = (e: unknown) => {
    const axiosError = e as { response?: { data?: { error?: string } } }
    return axiosError.response?.data?.error ?? '取得に失敗しました'
  }

  // 初回: トークン設定を確認。未設定ならここで止め、以降のAPIは呼ばない
  useEffect(() => {
    run('setting', async () => {
      const r = await api.get<GithubSetting>('/github/setting')
      setSetting(r.data)
    })
  }, [])

  const loadRepositories = () => run('repos', async () => {
    try {
      const r = await api.get<GithubRepository[]>('/github/repositories')
      setRepositories(r.data)
      setReposError(null)
      if (r.data.length === 0) return
      const savedRepo = localStorage.getItem('githubSelectedRepo')
      const initialRepo = r.data.find((repo) => repo.full_name === savedRepo) ?? r.data[0]
      setSelectedRepo(initialRepo.full_name)
    } catch (e) {
      setReposError(extractErrorMessage(e))
    }
  })

  // トークン設定済みならリポジトリ一覧と自分宛て通知を取得（default_repos が先頭）
  useEffect(() => {
    if (!setting?.has_token) return
    void loadRepositories()
    // 自分宛て通知（メンション・レビュー依頼・コメント）。失敗しても本体は動かす
    api.get<GithubNotification[]>('/github/notifications').then((r) => setNotifications(r.data)).catch(() => {})
  }, [setting?.has_token])

  // 通知アイテムを開く: 同アプリ内でそのリポジトリ・PRを表示（PR以外はGitHubを新規タブで開く）
  const openNotification = (notification: GithubNotification) => {
    if (notification.type === 'PullRequest' && notification.repo_full_name && notification.number) {
      setSelectedRepo(notification.repo_full_name)
      void openPullRequest(notification.number, notification.repo_full_name)
    } else if (notification.html_url) {
      window.open(notification.html_url, '_blank')
    }
  }

  // 見出し(表示名)を保存
  const saveTitle = () => run('title', async () => {
    const r = await api.patch<GithubSetting>('/github/setting', { github_setting: { display_name: titleDraft.trim() } })
    setSetting((prev) => (prev ? { ...prev, display_name: r.data.display_name } : prev))
    setEditingTitle(false)
  })

  // 変更ファイルへレビューコメントを投稿（公開・即時）
  const submitFileComment = (path: string) => run(`file-comment-${path}`, async () => {
    if (!prDetail || !prDetail.head_sha || !fileCommentDraft.trim()) return
    await api.post('/github/review_comment', {
      full_name: selectedRepo, number: prDetail.number,
      commit_id: prDetail.head_sha, path, body: fileCommentDraft.trim(),
    })
    setFileCommentDraft(''); setFileCommentPath(null)
    await openPullRequest(prDetail.number)
  })

  // 選択リポジトリを記憶（次回開いたとき同じリポジトリから）
  useEffect(() => {
    if (selectedRepo) localStorage.setItem('githubSelectedRepo', selectedRepo)
  }, [selectedRepo])

  const loadPullRequests = (fullName: string) => run('pulls', async () => {
    try {
      const r = await api.get<GithubPullRequest[]>('/github/pull_requests', { params: { full_name: fullName, state: 'all' } })
      setPullRequests(r.data)
      setPrsError(null)
    } catch (e) {
      setPrsError(extractErrorMessage(e))
    }
  })

  // リポジトリ切替: 詳細をリセットしてPR一覧を取得
  useEffect(() => {
    if (!selectedRepo) return
    setPrDetail(null); setExpandedFile(null); setPrDetailError(null)
    void loadPullRequests(selectedRepo)
  }, [selectedRepo])

  // repoFullName を明示指定できるようにする(通知から別リポジトリのPRを開くとき、
  // setSelectedRepo 直後は state が古いままなので selectedRepo に依存しない)
  const openPullRequest = (number: number, repoFullName: string = selectedRepo) => run(`pr-${number}`, async () => {
    setOpeningPrNumber(number); setOpeningRepoFullName(repoFullName)
    try {
      const r = await api.get<GithubPrDetail>('/github/pr_detail', { params: { full_name: repoFullName, number } })
      setPrDetail(r.data)
      setExpandedFile(null)
      setPrDetailError(null)
    } catch (e) {
      setPrDetail(null)
      setPrDetailError(extractErrorMessage(e))
    }
  })

  // PR へのコメント投稿。選択中PRの詳細画面・PR一覧行の両方から共通で使う
  const postPrComment = (prNumber: number, body: string) =>
    api.post('/github/comment', { full_name: selectedRepo, number: prNumber, body })

  const submitComment = () => run('comment', async () => {
    if (!prDetail || !commentDraft.trim()) return
    await postPrComment(prDetail.number, commentDraft.trim())
    setCommentDraft('')
    await openPullRequest(prDetail.number)
  })

  // PR一覧行の＋から直接投稿。投稿後は入力欄を閉じ、一覧のコメント数を再取得する
  const submitQuickComment = (prNumber: number) => run(`quick-comment-${prNumber}`, async () => {
    if (!quickCommentText.trim()) return
    await postPrComment(prNumber, quickCommentText.trim())
    setQuickCommentPrNumber(null)
    setQuickCommentText('')
    await loadPullRequests(selectedRepo)
  })

  // 行レビュー下書き: diff行の＋から編集を開始し、保存して一斉送信で1コメントに結合してPRへ投稿する
  const draftAt = (path: string, line: number) => drafts.find((d) => d.path === path && d.line === line)

  const startDraft = (path: string, line: number, code: string) => {
    const existing = draftAt(path, line)
    setDraftBody(existing?.body ?? '')
    setDraftCode(existing?.code ?? code)
    setEditingDraftKey(`${path}:${line}`)
    setDraftPreview(false)
  }

  const saveDraft = () => {
    if (!editingDraftKey || !draftBody.trim()) { setEditingDraftKey(null); return }
    const [path, lineText] = splitDraftKey(editingDraftKey)
    const line = Number(lineText)
    setDrafts((prev) => [...prev.filter((d) => !(d.path === path && d.line === line)), { path, line, code: draftCode, body: draftBody.trim() }])
    setEditingDraftKey(null); setDraftBody(''); setDraftCode('')
  }

  const removeDraft = (draft: DraftComment) =>
    setDrafts((prev) => prev.filter((d) => !(d.path === draft.path && d.line === draft.line)))

  const reviewTarget = prDetail?.number
  const submitDrafts = () => run('submit-review', async () => {
    if (!reviewTarget || drafts.length === 0) return
    const r = await api.post<{ posted: number }>('/github/post_review', {
      full_name: selectedRepo, number: reviewTarget, comments: drafts,
    })
    setDrafts([])
    await openPullRequest(reviewTarget)
    setPosted(`PR #${reviewTarget} に ${r.data.posted} 件のレビューを投稿しました`)
    setTimeout(() => setPosted(null), 5000)
  })

  const visiblePullRequests = useMemo(
    () => (prStateFilter === 'all' ? pullRequests : pullRequests.filter((pr) => pr.state === prStateFilter)),
    [pullRequests, prStateFilter],
  )

  const pullRequestStateBadge = (pr: GithubPullRequest) => {
    if (pr.merged_at) return <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">merged</span>
    if (pr.state === 'open') return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">open</span>
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">closed</span>
  }

  const prDetailStateBadge = (detail: GithubPrDetail) => {
    if (detail.merged) return <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">merged</span>
    if (detail.state === 'open') return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">open</span>
    return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">closed</span>
  }

  // 行レビューの編集ボックス（diff行の＋から開く。保存すると下書き一覧に積まれる）
  const renderDraftEditor = (path: string, line: number) => (
    <div className="border-y border-fuchsia-200 bg-fuchsia-50/60 p-2 font-sans">
      <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--color-text-sub)]">
        <span className="font-mono">{path}:{line}</span>
        <button onClick={() => setDraftPreview((v) => !v)} className={`rounded px-1.5 py-0.5 ${draftPreview ? 'bg-fuchsia-500 text-white' : 'border border-fuchsia-300 text-fuchsia-600'}`}>
          {draftPreview ? '編集に戻る' : 'プレビュー'}
        </button>
      </div>
      {draftPreview ? (
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
        <button onClick={() => setEditingDraftKey(null)} className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px]">キャンセル</button>
      </div>
    </div>
  )

  // patch を行番号付きで描画。add/ctx行の左の＋でその行にレビュー下書きを開始できる。
  const renderPatch = (path: string, patch: string) => {
    const patchLines = parsePatch(patch)
    return (
      <div className="max-h-96 overflow-auto bg-white font-mono text-[11px] leading-5">
        {patchLines.map((patchLine, index) => {
          const canComment = patchLine.newNo != null && patchLine.type !== 'hunk'
          const draft = canComment ? draftAt(path, patchLine.newNo!) : undefined
          return (
            <div key={index}>
              <div className={`group flex ${PATCH_LINE_BG[patchLine.type]} ${draft ? 'bg-amber-50' : ''}`}>
                {canComment ? (
                  <button onClick={() => startDraft(path, patchLine.newNo!, patchLine.text)} title="この行にレビューコメント"
                    className="w-5 shrink-0 select-none text-center text-fuchsia-500 opacity-0 group-hover:opacity-100">＋</button>
                ) : <span className="w-5 shrink-0" />}
                <span className="w-9 shrink-0 select-none border-r border-[var(--color-border)] pr-1 text-right text-gray-400">{patchLine.newNo ?? ''}</span>
                <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1">{patchLine.text || ' '}</pre>
                {draft && <span className="pr-2 text-amber-500" title="下書きあり">💬</span>}
              </div>
              {canComment && editingDraftKey === `${path}:${patchLine.newNo}` && renderDraftEditor(path, patchLine.newNo!)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl p-4 shadow-md space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {editingTitle ? (
            <span className="flex items-center gap-1">
              <input value={titleDraft} autoFocus onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                placeholder="表示名（例: 自分のGitHub）"
                className="rounded border border-fuchsia-300 px-2 py-0.5 text-sm" />
              <button onClick={saveTitle} disabled={busy === 'title'} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">保存</button>
              <button onClick={() => setEditingTitle(false)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]">✕</button>
            </span>
          ) : (
            <button onClick={() => { setTitleDraft(setting?.display_name ?? ''); setEditingTitle(true) }}
              title="クリックで名前を変更" className="group flex items-center gap-1 text-sm font-semibold text-[var(--color-text)]">
              <span>{setting?.display_name?.trim() || '🐙 Git（GitHub）'}</span>
              <span className="text-[10px] text-[var(--color-text-sub)] opacity-0 group-hover:opacity-100">✏️</span>
            </button>
          )}
          {setting?.has_token && repositories.length > 0 && (
            <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
              {repositories.map((repo) => (
                <button key={repo.full_name} onClick={() => setSelectedRepo(repo.full_name)}
                  title={repo.description ?? repo.full_name}
                  className={`rounded-lg border px-2 py-1 text-[11px] ${selectedRepo === repo.full_name ? 'border-fuchsia-400 bg-fuchsia-50 font-semibold text-fuchsia-700' : 'border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-gray-50'}`}>
                  {repo.private ? '🔒' : '🌐'} {repo.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
        {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>}
        {posted && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✅ {posted}</div>}
        {reposError && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            <span>{reposError}</span>
            <button onClick={loadRepositories} disabled={!!busy}
              className="ml-auto rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-600 disabled:opacity-50">再試行</button>
          </div>
        )}
      </div>

      {/* 自分宛て（メンション・レビュー依頼・コメント）インボックス */}
      {setting?.has_token && notifications.length > 0 && (
        <div className="glass rounded-2xl p-3 shadow-md">
          <button onClick={() => setShowInbox((v) => !v)} className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
            <span className="text-[10px] text-[var(--color-text-sub)]">{showInbox ? '▼' : '▶'}</span>
            <span>🔔 自分宛て</span>
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{notifications.length}</span>
          </button>
          {showInbox && (
            <div className="max-h-72 space-y-1 overflow-auto">
              {notifications.map((n) => {
                const meta = REASON_META[n.reason] ?? { label: n.reason, cls: 'bg-gray-100 text-gray-700' }
                return (
                  <button key={n.id} onClick={() => openNotification(n)}
                    className="block w-full rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-left hover:bg-fuchsia-50">
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-text-sub)]">
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                      <span className="font-mono">{n.repo_full_name}{n.number ? ` #${n.number}` : ''}</span>
                      <span>・{new Date(n.updated_at).toLocaleDateString('ja-JP')}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-semibold text-[var(--color-text)]">{n.title}</div>
                    {n.comment && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--color-text-sub)]">
                        {n.comment.user}: {n.comment.body}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {busy === 'setting' && <div className="text-xs text-[var(--color-text-sub)]">確認中…</div>}

      {setting && !setting.has_token && (
        <div className="glass rounded-2xl p-4 shadow-md">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            GitHubアクセストークンが未設定です。設定 → GitHub タブから登録してください
          </div>
        </div>
      )}

      {setting?.has_token && (
        <div className="flex flex-col gap-3 lg:flex-row">
          {/* PR 一覧 */}
          <div className="glass w-full rounded-2xl p-3 shadow-md lg:w-80 lg:shrink-0">
            <div className="mb-2 flex items-center gap-1">
              {STATE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setPrStateFilter(f.key)}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${prStateFilter === f.key ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="mb-1 text-xs font-semibold text-[var(--color-text)]">PR {visiblePullRequests.length}件</div>
            <div className="max-h-[70vh] space-y-1 overflow-auto">
              {busy === 'pulls' && <div className="text-xs text-[var(--color-text-sub)]">読込中…</div>}
              {prsError && (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
                  <span className="min-w-0 flex-1">{prsError}</span>
                  <button onClick={() => loadPullRequests(selectedRepo)} disabled={!!busy}
                    className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-600 disabled:opacity-50">再試行</button>
                </div>
              )}
              {visiblePullRequests.map((pr) => (
                <div key={pr.number}>
                  <div role="button" tabIndex={0} onClick={() => openPullRequest(pr.number)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openPullRequest(pr.number) }}
                    className={`flex cursor-pointer items-start gap-1 rounded-lg border px-2 py-1.5 text-left text-[11px] ${prDetail?.number === pr.number ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-[var(--color-border)] bg-white hover:bg-gray-50'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[var(--color-text)]">#{pr.number} {pr.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-text-sub)]">
                        {pullRequestStateBadge(pr)}
                        {pr.draft && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">draft</span>}
                        <span>{pr.user}</span>
                        <span>・{new Date(pr.updated_at).toLocaleDateString('ja-JP')}</span>
                        <span>💬{pr.comments}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); setQuickCommentPrNumber((prev) => (prev === pr.number ? null : pr.number)); setQuickCommentText('') }}
                        title="このPRにコメントする" className="px-0.5 text-[12px] text-[var(--color-text-sub)] hover:text-fuchsia-600">＋</button>
                      {pr.html_url && (
                        <a href={pr.html_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          title="GitHubで開く" className="px-0.5 text-[12px] text-[var(--color-text-sub)] hover:text-sky-600">↗</a>
                      )}
                    </div>
                  </div>
                  {quickCommentPrNumber === pr.number && (
                    <div className="mt-1 rounded-lg border border-sky-200 bg-sky-50/50 p-2">
                      <textarea value={quickCommentText} autoFocus onChange={(e) => setQuickCommentText(e.target.value)} rows={2}
                        placeholder="このPRにコメントする（markdown可・GitHubに公開で投稿されます）"
                        className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-[11px]" />
                      <div className="mt-1 flex justify-end gap-1">
                        <button onClick={() => { setQuickCommentPrNumber(null); setQuickCommentText('') }}
                          className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[10px]">✕</button>
                        <button onClick={() => submitQuickComment(pr.number)} disabled={!!busy || !quickCommentText.trim()}
                          className="rounded bg-gradient-to-r from-sky-500 to-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow disabled:opacity-50">
                          {busy === `quick-comment-${pr.number}` ? '送信中…' : '投稿'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy !== 'pulls' && !prsError && visiblePullRequests.length === 0 && (
                <div className="text-xs text-[var(--color-text-sub)]">{selectedRepo ? 'PRはありません' : 'リポジトリを選択してください'}</div>
              )}
            </div>
          </div>

          {/* PR 詳細 */}
          <div className="glass min-w-0 flex-1 rounded-2xl p-3 shadow-md">
            {busy?.startsWith('pr-') && <div className="text-xs text-[var(--color-text-sub)]">PR取得中…</div>}
            {prDetailError && !busy?.startsWith('pr-') && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                <span className="min-w-0 flex-1">{prDetailError}</span>
                <button onClick={() => openingPrNumber && openPullRequest(openingPrNumber, openingRepoFullName)} disabled={!!busy || !openingPrNumber}
                  className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-red-600 disabled:opacity-50">再試行</button>
              </div>
            )}
            {prDetail ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-bold text-[var(--color-text)]">#{prDetail.number} {prDetail.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-sub)]">
                    <span>{prDetail.user}</span>
                    {prDetailStateBadge(prDetail)}
                    <a href={prDetail.html_url} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline">🔗 GitHubで開く</a>
                  </div>
                </div>

                {/* 説明 */}
                {prDetail.body?.trim() && (
                  <div className="prose prose-sm max-w-none rounded-lg border border-[var(--color-border)] bg-white p-2 text-xs">
                    <ReactMarkdown remarkPlugins={MD_PLUGINS}>{prDetail.body}</ReactMarkdown>
                  </div>
                )}

                {/* 変更ファイル */}
                <div>
                  <div className="mb-1 text-xs font-semibold text-[var(--color-text)]">📝 変更ファイル {prDetail.files.length}件 <span className="ml-1 font-normal text-[10px] text-[var(--color-text-sub)]">展開して行の左の＋でレビュー</span></div>
                  <div className="space-y-2">
                    {prDetail.files.map((file) => (
                      <div key={file.filename} className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
                        <div className="flex w-full items-center gap-2 border-b border-[var(--color-border)] bg-gray-50 px-2 py-1 font-mono text-[11px] font-semibold text-[var(--color-text)]">
                          <button onClick={() => setExpandedFile((current) => (current === file.filename ? null : file.filename))}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left">
                            <span>{expandedFile === file.filename ? '▼' : '▶'}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-sans font-semibold ${FILE_STATUS_STYLE[file.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {FILE_STATUS_LABEL[file.status] ?? file.status}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                            <span className="shrink-0 font-sans text-[10px]">
                              <span className="text-emerald-600">+{file.additions}</span> <span className="text-red-600">-{file.deletions}</span>
                            </span>
                          </button>
                          {/* このファイルにレビューコメントを付ける（公開・即時POST） */}
                          <button onClick={() => { setFileCommentPath((cur) => (cur === file.filename ? null : file.filename)); setFileCommentDraft('') }}
                            title="このファイルにコメント" className="shrink-0 rounded bg-fuchsia-500 px-1.5 py-0.5 text-[10px] font-sans font-semibold text-white hover:bg-fuchsia-600">
                            ＋コメント
                          </button>
                        </div>
                        {fileCommentPath === file.filename && (
                          <div className="space-y-1.5 border-b border-[var(--color-border)] bg-fuchsia-50 p-2">
                            <textarea value={fileCommentDraft} onChange={(e) => setFileCommentDraft(e.target.value)}
                              rows={3} placeholder={`${file.filename} へのコメント（markdown可・GitHubに公開で投稿されます）`}
                              className="w-full rounded border border-fuchsia-300 px-2 py-1 text-xs" />
                            <div className="flex items-center gap-1">
                              <button onClick={() => submitFileComment(file.filename)}
                                disabled={busy === `file-comment-${file.filename}` || !fileCommentDraft.trim() || !prDetail.head_sha}
                                className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">
                                {busy === `file-comment-${file.filename}` ? '送信中…' : '💬 コメント'}
                              </button>
                              <button onClick={() => setFileCommentPath(null)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]">キャンセル</button>
                              {!prDetail.head_sha && <span className="text-[10px] text-red-500">このPRはコミット情報が取れないためコメントできません</span>}
                            </div>
                          </div>
                        )}
                        {expandedFile === file.filename && (
                          file.patch
                            ? renderPatch(file.filename, file.patch)
                            : <div className="p-2 text-[11px] text-[var(--color-text-sub)]">差分はありません（バイナリ or 大きすぎるファイル）</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* コメント */}
                <div>
                  <div className="mb-2 text-xs font-semibold text-[var(--color-text)]">💬 コメント {prDetail.comments.length}</div>
                  <div className="space-y-2">
                    {prDetail.comments.map((comment) => (
                      <div key={comment.id} className="rounded-lg border border-[var(--color-border)] bg-white p-2">
                        <div className="mb-1 text-[10px] text-[var(--color-text-sub)]">{comment.user} ・ {new Date(comment.created_at).toLocaleString('ja-JP')}</div>
                        <div className="prose prose-sm max-w-none text-xs"><ReactMarkdown remarkPlugins={MD_PLUGINS}>{comment.body}</ReactMarkdown></div>
                      </div>
                    ))}
                    {prDetail.comments.length === 0 && <div className="text-xs text-[var(--color-text-sub)]">まだコメントはありません</div>}
                  </div>
                  <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-white p-2">
                    <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} rows={3}
                      placeholder="PRにコメントする（markdown可）"
                      className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs" />
                    <div className="mt-1 flex justify-end">
                      <button onClick={submitComment} disabled={!!busy || !commentDraft.trim()}
                        className="rounded-lg bg-gradient-to-r from-sky-500 to-blue-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-50">
                        {busy === 'comment' ? '送信中…' : '💬 GitHubへ送信'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              !busy && !prDetailError && <div className="py-10 text-center text-xs text-[var(--color-text-sub)]">左の一覧からPRを選択してください</div>
            )}
          </div>
        </div>
      )}

      {/* レビュー下書き一覧 + 一斉送信 */}
      {drafts.length > 0 && (
        <div className="glass sticky bottom-2 rounded-2xl border border-amber-200 p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text)]">📝 レビュー下書き {drafts.length}件</span>
            <button onClick={submitDrafts} disabled={!!busy || !reviewTarget}
              title={reviewTarget ? `PR #${reviewTarget} に1コメントへ結合して投稿` : 'PR一覧からPRを開いてください'}
              className="ml-auto rounded-lg bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'submit-review' ? '送信中…' : `🚀 一斉送信${reviewTarget ? `（PR #${reviewTarget}）` : ''}`}
            </button>
          </div>
          <div className="max-h-40 space-y-1 overflow-auto">
            {drafts.map((d) => (
              <div key={`${d.path}:${d.line}`} className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-[11px]">
                <span className="shrink-0 font-mono text-fuchsia-600">{d.path}:{d.line}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{d.body}</span>
                <button onClick={() => { setDraftBody(d.body); setDraftCode(d.code); setEditingDraftKey(`${d.path}:${d.line}`) }} className="text-[var(--color-text-sub)] hover:text-fuchsia-600" title="編集">✏️</button>
                <button onClick={() => removeDraft(d)} className="text-gray-400 hover:text-red-500" title="削除">🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
