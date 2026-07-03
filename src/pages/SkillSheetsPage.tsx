import { useEffect, useMemo, useRef, useState } from 'react'
import { api, SKILL_SHEET_PHASES } from '../lib/api'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import DescriptionSections from '../components/DescriptionSections'
import ProjectTechTabs from '../components/ProjectTechTabs'
import ReviewItemsTable from '../components/ReviewItemsTable'
import type { SkillSheetReviewItem } from '../lib/api'
import type { Me, SkillSheet, SkillSheetComment, SkillSheetProject, SkillSheetTarget, SkillSheetTech } from '../lib/api'

// 技術スタックの表示順 (集計サービスの category と対応)
const TECH_CATEGORY_ORDER = ['language', 'framework', 'db', 'server_os', 'tool'] as const

const EMPTY_PROJECT: SkillSheetProject = {
  period_from: '', period_to: '', title: '', description: '', role_scale: '',
  languages: '', db: '', server_os: '', tools: '',
  phases: Object.fromEntries(SKILL_SHEET_PHASES.map((p) => [p, false])),
}

// AI 添削の指示プリセット
const REVIEW_PRESETS = [
  '雇う側が雇いたくなるような文章にして',
  'できるだけ端的に',
  '成果を定量的に強調して',
  '誤字脱字と表記ゆれだけ直して',
]

export default function SkillSheetsPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [targets, setTargets] = useState<SkillSheetTarget[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<SkillSheet | null>(null)
  const [url, setUrl] = useState('')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [commentTarget, setCommentTarget] = useState('')

  const canPickTarget = !!me?.admin || !!me?.sub_admin
  const [techCandidates, setTechCandidates] = useState<Record<string, string[]>>({})
  const [openProjects, setOpenProjects] = useState<Record<number, boolean>>({}) // 案件アコーディオンの開閉
  const dragIndex = useRef<number | null>(null) // 案件 DnD 並び替えのドラッグ元
  const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null) // 自動保存の最終時刻
  const [profileTab, setProfileTab] = useState<'normal' | 'youtube'>('normal') // 自己PR: 通常 / YouTube用 切替
  const lastSavedRef = useRef<string | null>(null) // 最後に保存した payload(JSON) — 自動保存の差分判定
  const lastSheetIdRef = useRef<number | null>(null) // 読み込んだシートID — 切替検知

  useEffect(() => {
    api.get('/me').then((r) => setMe(r.data as Me))
    api.get<SkillSheetTarget[]>('/skill_sheets/targets')
      .then((r) => {
        setTargets(r.data)
        if (r.data.length > 0) setSelectedUserId(r.data[0].id)
      })
      .catch((e) => setErr(e?.response?.data?.error ?? '対象の取得に失敗しました'))
    api.get<Record<string, string[]>>('/skill_sheets/tech_candidates')
      .then((r) => setTechCandidates(r.data))
      .catch(() => { /* 候補が取れなくても自由入力で追加できる */ })
  }, [])

  // 対象ユーザーが変わったら既存シートを読み込む
  useEffect(() => {
    if (selectedUserId == null) return
    setSheet(null); setMsg(null); setErr(null)
    api.get<SkillSheet[]>('/skill_sheets')
      .then((r) => {
        const found = r.data.find((s) => s.user_id === selectedUserId) ?? null
        setSheet(found ? normalize(found) : null)
        setUrl(found?.spreadsheet_url ?? '')
      })
      .catch(() => { /* noop */ })
  }, [selectedUserId])

  const review = sheet?.review_result ?? null
  const selectedTarget = targets.find((t) => t.id === selectedUserId) ?? null
  const canGenerate = !!selectedTarget?.can_generate
  // 添削指摘の「反映先」選択肢（日本語ラベル）
  const reviewFieldOptions = useMemo(() => {
    const base = [
      { value: 'self_pr', label: '自己PR' },
      { value: 'specialties', label: '得意分野' },
      { value: 'skills', label: '得意技術' },
      { value: 'duties', label: '得意業務' },
    ]
    const proj = (sheet?.projects ?? []).flatMap((_, i) => [
      { value: `project:${i}:title`, label: `案件${i + 1}のプロジェクト名` },
      { value: `project:${i}:description`, label: `案件${i + 1}の業務内容` },
    ])
    return [...base, ...proj]
  }, [sheet?.projects])

  // 期間文字列("2025年11月" / "2025-11" / "2025/11" 等) を <input type="month"> 用の "YYYY-MM" に変換。
  // "現在"/"即日"/空 など日付化できないものは "" を返す。
  const toMonthInput = (value: string | null) => {
    const m = (value ?? '').match(/(\d{4})\D*(\d{1,2})/)
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : ''
  }

  function normalize(s: SkillSheet): SkillSheet {
    return {
      ...s,
      review_items: s.review_items ?? [],
      projects: (s.projects ?? []).map((p) => ({
        ...p,
        phases: { ...Object.fromEntries(SKILL_SHEET_PHASES.map((k) => [k, false])), ...(p.phases ?? {}) },
      })),
    }
  }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key); setErr(null); setMsg(null)
    try {
      return await fn()
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? '失敗しました')
      return undefined
    } finally {
      setBusy(null)
    }
  }

  // 空シートを保証 (generate/review/export 前)
  async function ensureSheet(): Promise<SkillSheet | null> {
    if (sheet) return sheet
    const r = await api.post<SkillSheet>('/skill_sheets', { user_id: selectedUserId })
    const s = normalize(r.data)
    setSheet(s)
    return s
  }

  const doImport = () =>
    run('import', async () => {
      if (!window.confirm('スプレッドシートを読み込みます。現在アプリ上で編集中の内容はシートの内容で上書きされます。よろしいですか？')) return
      const r = await api.post<SkillSheet>('/skill_sheets/import', { user_id: selectedUserId, spreadsheet_url: url })
      setSheet(normalize(r.data))
      setMsg('スプレッドシートを読み込みました')
    })

  // 開発実績(Backlog/勤怠)から AI 下書き生成。実績データを持つ 西野・川村 のみ対象。
  // 初回クリック: 生成した案件を「追加」。2回目以降: 生成した案件範囲だけ「上書き」(手動案件・ヘッダは保持)。
  const generatedRangeRef = useRef<{ start: number; count: number } | null>(null)
  const doGenerate = () =>
    run('generate', async () => {
      const s = await ensureSheet()
      if (!s) return
      const r = await api.post<{ draft: Partial<SkillSheet> }>(`/skill_sheets/${s.id}/generate`)
      const d = r.data.draft
      const draftProjects = (d.projects ?? []).map((p) => ({
        ...EMPTY_PROJECT, ...p, phases: { ...EMPTY_PROJECT.phases, ...(p.phases ?? {}) },
        source: 'backlog', // Backlog実績から生成 → インポートで消さない
      }))
      setSheet((prev) => {
        if (!prev) return prev
        const range = generatedRangeRef.current
        if (range) {
          // 2回目以降: 生成済み範囲だけ差し替え（ヘッダ・手動案件は触らない）
          const projects = [...prev.projects]
          projects.splice(range.start, range.count, ...draftProjects)
          generatedRangeRef.current = { start: range.start, count: draftProjects.length }
          return { ...prev, projects }
        }
        // 初回: ヘッダを下書きで補完し、案件は末尾に追加
        generatedRangeRef.current = { start: prev.projects.length, count: draftProjects.length }
        return {
          ...prev,
          specialties: d.specialties ?? prev.specialties,
          skills: d.skills ?? prev.skills,
          duties: d.duties ?? prev.duties,
          self_pr: d.self_pr ?? prev.self_pr,
          projects: [...prev.projects, ...draftProjects],
        }
      })
      setMsg(generatedRangeRef.current && generatedRangeRef.current.start < s.projects.length
        ? '開発実績から生成した案件を上書きしました（確認して保存してください）'
        : '開発実績から案件を追加しました（確認して保存してください）')
    })


  const doSave = () =>
    run('save', async () => {
      const s = await ensureSheet()
      if (!s) return null
      const r = await api.patch<SkillSheet>(`/skill_sheets/${s.id}`, { skill_sheet: toPayload(s) })
      const saved = normalize(r.data)
      setSheet(saved)
      setMsg('保存しました')
      return saved
    })

  // Wantedly / 副業クラウド へ連携（platform 指定・position 指定で個別、未指定で一括）
  const syncExternal = (platform: 'wantedly' | 'anotherworks', position?: number) =>
    run(`sync-${platform}-${position ?? 'all'}`, async () => {
      const s = sheet?.id ? sheet : await doSaveSilently() // 未保存の編集を先に保存してから連携
      if (!s?.id) return
      const r = await api.post<any>(`/skill_sheets/${s.id}/sync_external`, { platform, project_position: position })
      if (r.data.projects) setSheet((prev) => prev ? { ...prev, projects: r.data.projects } : prev)
      const rows = (r.data[platform] ?? []) as { title: string; status: string }[]
      const label = platform === 'wantedly' ? 'Wantedly' : '副業クラウド'
      setMsg(`${label}連携: ` + rows.map((x) => `${x.title}=${x.status}`).join(' / '))
    })

  const doReview = () =>
    run('review', async () => {
      const saved = (await doSaveSilently()) ?? sheet
      if (!saved) return
      const r = await api.post<{ review_result: SkillSheet['review_result']; review_items: SkillSheetReviewItem[] }>(`/skill_sheets/${saved.id}/review`, { instruction })
      setSheet({ ...saved, review_result: r.data.review_result, review_items: r.data.review_items ?? [] })
      setMsg('AI 添削が完了しました')
    })

  // 指摘の改善版を field に応じて該当欄へ反映し、applied を立てる
  const applyReview = (item: SkillSheetReviewItem) => {
    const field = item.field ?? ''
    const text = item.suggestion ?? ''
    if (!field) return
    const projectMatch = field.match(/^project:(\d+):(title|description)$/)
    if (projectMatch) {
      setProj(Number(projectMatch[1]), projectMatch[2] as keyof SkillSheetProject, text)
    } else if (['self_pr', 'specialties', 'skills', 'duties'].includes(field)) {
      setField(field as 'self_pr' | 'specialties' | 'skills' | 'duties', text)
    } else {
      setErr(`未知の反映先 field: ${field}`); return
    }
    updateReviewItem(item.id, { applied: true })
    setMsg('改善版を該当欄へ反映しました（確認して「保存」してください）')
  }

  const updateReviewItem = (id: number, patch: Partial<SkillSheetReviewItem>) =>
    run('reviewitem', async () => {
      if (!sheet) return
      const r = await api.patch<SkillSheetReviewItem>(`/skill_sheets/${sheet.id}/review_items/${id}`, { review_item: patch })
      setSheet((prev) => prev ? { ...prev, review_items: prev.review_items.map((x) => x.id === id ? r.data : x) } : prev)
    })

  const deleteReviewItem = (id: number) =>
    run('reviewitem', async () => {
      if (!sheet) return
      await api.delete(`/skill_sheets/${sheet.id}/review_items/${id}`)
      setSheet((prev) => prev ? { ...prev, review_items: prev.review_items.filter((x) => x.id !== id) } : prev)
    })

  const addReviewItem = () =>
    run('reviewitem', async () => {
      const saved = await ensureSheet()
      if (!saved) return
      const r = await api.post<SkillSheetReviewItem>(`/skill_sheets/${saved.id}/review_items`, {
        review_item: { target: '新規指摘', field: 'self_pr', issues: '', suggestion: '' },
      })
      setSheet((prev) => prev ? { ...prev, review_items: [...prev.review_items, r.data] } : prev)
    })

  const doExport = () =>
    run('export', async () => {
      const saved = (await doSaveSilently()) ?? sheet
      if (!saved) return
      const r = await api.post<{ spreadsheet_id: string; gid: string }>(`/skill_sheets/${saved.id}/export`)
      setMsg('スプレッドシートに書き出しました（行の高さ・罫線も整形済み）')
      // 進捗管理と同様、書き出したスプレッドシートを新規タブで開く
      const sid = r.data?.spreadsheet_id ?? saved.spreadsheet_id
      const gid = r.data?.gid ?? saved.gid ?? '0'
      if (sid) window.open(`https://docs.google.com/spreadsheets/d/${sid}/edit#gid=${gid}`, '_blank')
    })

  // 「技術スタックを集計」: ①各案件の技術フリーテキストを AI でタグ整形(カテゴリ振り分け・バージョン結合・
  //   重複排除・経験スキル羅列の技術欄への振り分け) → ②保存 → ③横断集計。ボタン1つに統合。
  const doAnalyzeTech = () =>
    run('tech', async () => {
      let saved = (await doSaveSilently()) ?? sheet
      if (!saved) return
      const sg = await api.post<{ projects: { index: number; languages: string; db: string; server_os: string; tools: string; description: string }[] }>(`/skill_sheets/${saved.id}/suggest_techs`)
      const cleaned = {
        ...saved,
        projects: saved.projects.map((p, i) => {
          const x = sg.data.projects.find((y) => y.index === i)
          return x ? { ...p, languages: x.languages, db: x.db, server_os: x.server_os, tools: x.tools, description: x.description } : p
        }),
      }
      setSheet(cleaned)
      const r2 = await api.patch<SkillSheet>(`/skill_sheets/${saved.id}`, { skill_sheet: toPayload(cleaned) })
      saved = normalize(r2.data)
      const r = await api.post<{ techs: SkillSheetTech[] }>(`/skill_sheets/${saved.id}/analyze_tech`)
      setSheet({ ...saved, techs: r.data.techs })
      api.get<Record<string, string[]>>('/skill_sheets/tech_candidates')
        .then((res) => setTechCandidates(res.data)).catch(() => {})
      setMsg('技術を整形して集計しました（内容を確認して書き出してください）')
    })

  // 現在の内容を Before（添削前）として保存
  const setBefore = () =>
    run('before', async () => {
      const saved = await doSaveSilently()
      if (!saved) return
      const r = await api.post<{ before_snapshot: SkillSheet['before_snapshot'] }>(`/skill_sheets/${saved.id}/set_before`)
      setSheet({ ...saved, before_snapshot: r.data.before_snapshot })
      setMsg('現在の内容を Before（添削前）として保存しました')
    })

  const addComment = () =>
    run('comment', async () => {
      if (!sheet || !newComment.trim()) return
      const r = await api.post<SkillSheetComment>(`/skill_sheets/${sheet.id}/comments`, { body: newComment, target: commentTarget || null })
      setSheet({ ...sheet, comments: [...(sheet.comments ?? []), r.data] })
      setNewComment(''); setCommentTarget('')
    })

  const deleteComment = (cid: number) =>
    run('comment', async () => {
      if (!sheet) return
      await api.delete(`/skill_sheets/${sheet.id}/comments/${cid}`)
      setSheet({ ...sheet, comments: (sheet.comments ?? []).filter((c) => c.id !== cid) })
    })

  // 保存してシートを返す（メッセージは出さない・review/export 用）
  async function doSaveSilently(): Promise<SkillSheet | null> {
    const s = await ensureSheet()
    if (!s) return null
    const r = await api.patch<SkillSheet>(`/skill_sheets/${s.id}`, { skill_sheet: toPayload(s) })
    const saved = normalize(r.data)
    setSheet(saved)
    return saved
  }

  function toPayload(s: SkillSheet) {
    return {
      spreadsheet_url: url || s.spreadsheet_url,
      engineer_name: s.engineer_name, age: s.age, gender: s.gender,
      address: s.address, start_date: s.start_date, nearest_station: s.nearest_station,
      specialties: s.specialties, skills: s.skills, duties: s.duties, self_pr: s.self_pr,
      youtube_self_pr: s.youtube_self_pr,
      projects: s.projects.map((p) => ({
        period_from: p.period_from, period_to: p.period_to, title: p.title, description: p.description,
        role_scale: p.role_scale, languages: p.languages, db: p.db,
        server_os: p.server_os, tools: p.tools, phases: p.phases,
        source: p.source ?? 'import',
      })),
    }
  }

  // フォーム更新ヘルパー
  const setField = (k: keyof SkillSheet, v: string) => setSheet((s) => (s ? { ...s, [k]: v } : s))
  const setProj = (i: number, k: keyof SkillSheetProject, v: any) =>
    setSheet((s) => s ? { ...s, projects: s.projects.map((p, idx) => idx === i ? { ...p, [k]: v } : p) } : s)
  const togglePhase = (i: number, phase: string) =>
    setSheet((s) => s ? { ...s, projects: s.projects.map((p, idx) => idx === i ? { ...p, phases: { ...p.phases, [phase]: !p.phases[phase] } } : p) } : s)
  const addProject = () => setSheet((s) => s ? { ...s, projects: [...s.projects, { ...EMPTY_PROJECT, phases: { ...EMPTY_PROJECT.phases } }] } : s)
  const removeProject = (i: number) => setSheet((s) => s ? { ...s, projects: s.projects.filter((_, idx) => idx !== i) } : s)
  const toggleProjectOpen = (i: number) => setOpenProjects((o) => ({ ...o, [i]: !o[i] }))
  // 案件のドラッグ&ドロップ並び替え
  const moveProject = (from: number, to: number) => setSheet((s) => {
    if (!s || from === to || to < 0 || to >= s.projects.length) return s
    const projects = [...s.projects]
    const [moved] = projects.splice(from, 1)
    projects.splice(to, 0, moved)
    return { ...s, projects }
  })

  // スプレッドシートのような自動保存。編集が止まって 1.5 秒後に差分があれば PATCH する。
  // 取り込み/生成/添削/書き出し中(busy)はスキップ。無限ループ防止に payload の差分で判定。
  useEffect(() => {
    if (!sheet?.id) { lastSavedRef.current = null; lastSheetIdRef.current = null; return }
    const payload = JSON.stringify(toPayload(sheet))
    // 別シートを読み込んだ直後は基準値を置くだけ（保存しない）
    if (lastSheetIdRef.current !== sheet.id) {
      lastSheetIdRef.current = sheet.id
      lastSavedRef.current = payload
      return
    }
    if (busy) return
    if (payload === lastSavedRef.current) return
    const timer = setTimeout(async () => {
      try {
        await api.patch(`/skill_sheets/${sheet.id}`, { skill_sheet: toPayload(sheet) })
        lastSavedRef.current = payload
        setAutoSavedAt(new Date())
        setErr(null)
      } catch {
        /* 自動保存の失敗は黙る（手動「保存」で拾える） */
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [sheet, busy, url])

  const targetLabel = useMemo(() => {
    const t = targets.find((x) => x.id === selectedUserId)
    return t ? (t.display_name || t.email) : ''
  }, [targets, selectedUserId])

  // 技術スタックをカテゴリ別にまとめる（表示順は TECH_CATEGORY_ORDER）
  const techGroups = useMemo(() => {
    const techs = sheet?.techs ?? []
    return TECH_CATEGORY_ORDER
      .map((category) => ({
        category,
        label: techs.find((t) => t.category === category)?.category_label ?? category,
        items: techs.filter((t) => t.category === category),
      }))
      .filter((g) => g.items.length > 0)
  }, [sheet?.techs])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">スキルシート</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            スプレッドシートを読み込み → AI 添削・実績生成 → 編集 → 整形して書き戻し
          </div>
        </div>
        {canPickTarget && (
          <select
            value={selectedUserId ?? ''}
            onChange={(e) => setSelectedUserId(Number(e.target.value))}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm bg-white"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {(t.display_name || t.email)}{t.has_sheet ? '（作成済）' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* URL + アクション */}
      <div className="glass rounded-2xl shadow-md p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="GoogleスプレッドシートのURLを貼り付け"
            className="flex-1 min-w-[260px] rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button onClick={doImport} disabled={!url || !!busy}
            className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-50">
            {busy === 'import' ? '読み込み中…' : '📥 読み込み'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canGenerate && (
            <button onClick={doGenerate} disabled={!!busy}
              className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-700 disabled:opacity-50">
              {busy === 'generate' ? '生成中…' : '🤖 開発実績から生成'}
            </button>
          )}
          <button onClick={doSave} disabled={!!busy}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] disabled:opacity-50">
            {busy === 'save' ? '保存中…' : '💾 保存'}
          </button>
          <button onClick={doExport} disabled={!!busy}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {busy === 'export' ? '書き出し中…' : '📤 整形＆スプレッドシートへ書き出し'}
          </button>
          <button onClick={doAnalyzeTech} disabled={!!busy || !sheet}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-50">
            {busy === 'tech' ? '集計中…' : '🧱 技術スタックを集計'}
          </button>
          <button onClick={setBefore} disabled={!!busy || !sheet}
            className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] disabled:opacity-50">
            {busy === 'before' ? '保存中…' : '🅱 現在をBeforeに設定'}
          </button>
          <button onClick={() => setShowCompare((v) => !v)} disabled={!sheet?.before_snapshot}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-50">
            {showCompare ? '比較を閉じる' : '🔍 Before / After 比較'}
          </button>
        </div>
        {sheet?.id && (
          <div className="text-[10px] text-[var(--color-text-sub)]">
            {autoSavedAt ? `✓ 自動保存しました ${autoSavedAt.toLocaleTimeString('ja-JP')}` : '✎ 編集すると自動で保存されます'}
          </div>
        )}
        {msg && <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">{msg}</div>}
        {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

        {sheet?.id && (
          <div className="rounded-xl border border-[var(--color-border)] p-3 space-y-2">
            <div className="text-xs font-semibold text-[var(--color-text)]">🌐 外部連携（Wantedly / 副業クラウド）</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => syncExternal('wantedly')} disabled={!!busy}
                className="rounded-md bg-[#21bddb] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">{busy === 'sync-wantedly-all' ? '連携中…' : '🔗 Wantedlyへ一括連携'}</button>
              <button onClick={() => syncExternal('anotherworks')} disabled={!!busy}
                className="rounded-md bg-orange-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">{busy === 'sync-anotherworks-all' ? '連携中…' : '🔗 副業クラウドへ一括連携'}</button>
            </div>
            <div className="text-[10px] text-[var(--color-text-sub)]">
              一括＝自己PR＋全案件 / 各案件は下のカードの「W」「副」ボタンで個別連携。重複は自動でスキップします。
              <a href="https://www.wantedly.com/id/taka_nishino_a" target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold text-[#21bddb] hover:underline">Wantedlyプロフィール↗</a>
              <a href="https://talent.aw-anotherworks.com/mypage" target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold text-orange-600 hover:underline">副業クラウド↗</a>
            </div>
          </div>
        )}
      </div>

      {!sheet ? (
        <div className="glass rounded-2xl shadow-md p-8 text-center text-sm text-[var(--color-text-sub)]">
          {targetLabel && <span className="font-semibold">{targetLabel}</span>} のスキルシートはまだありません。<br />
          URL を読み込むか「開発実績から生成」で作成してください。
        </div>
      ) : (
       <>
        {/* Before / After 比較 (添削前スナップショット vs 現在) */}
        {showCompare && sheet.before_snapshot && (
          <div className="glass rounded-2xl shadow-md p-4 mb-4">
            <div className="text-sm font-semibold text-[var(--color-text)] mb-2">🔍 Before（添削前） / After（現在）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {([
                ['self_pr', '自己PR'], ['specialties', '得意分野'], ['skills', '得意技術'], ['duties', '得意業務'],
              ] as [keyof SkillSheet & string, string][]).map(([k, label]) => (
                <div key={k} className="contents">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <div className="text-[10px] font-bold text-gray-500 mb-1">Before — {label}</div>
                    <div className="whitespace-pre-wrap">{(sheet.before_snapshot as any)?.[k] || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                    <div className="text-[10px] font-bold text-emerald-600 mb-1">After — {label}</div>
                    <div className="whitespace-pre-wrap">{(sheet[k] as string) || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* 編集フォーム */}
          <div className="lg:col-span-2 glass rounded-2xl shadow-md p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['engineer_name', '技術者名'], ['age', '年齢'],
                ['gender', '性別'], ['address', '住所'],
                ['start_date', '稼動開始'], ['nearest_station', '最寄駅'],
              ] as [keyof SkillSheet, string][]).map(([k, label]) => (
                <label key={k} className="text-xs">
                  <span className="text-[var(--color-text-sub)]">{label}</span>
                  <input value={(sheet[k] as string) ?? ''} onChange={(e) => setField(k, e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-sm" />
                </label>
              ))}
            </div>
            {([
              ['specialties', '得意分野'], ['skills', '得意技術'], ['duties', '得意業務'],
            ] as [keyof SkillSheet, string][]).map(([k, label]) => (
              <label key={k} className="block text-xs">
                <span className="text-[var(--color-text-sub)]">{label}</span>
                <input value={(sheet[k] as string) ?? ''} onChange={(e) => setField(k, e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-sm" />
              </label>
            ))}
            <div className="block text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[var(--color-text-sub)]">自己PR</span>
                {(me?.admin || me?.can_use_youtube_mindmap) && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setProfileTab('normal')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${profileTab === 'normal' ? 'bg-[var(--color-text)] text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>通常</button>
                    <button type="button" onClick={() => setProfileTab('youtube')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${profileTab === 'youtube' ? 'bg-red-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>▶ YouTube用</button>
                  </div>
                )}
              </div>
              {profileTab === 'normal' ? (
                <AutoGrowTextarea value={sheet.self_pr ?? ''} onChange={(e) => setField('self_pr', e.target.value)} minRows={6}
                  className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-sm" />
              ) : (
                <>
                  <AutoGrowTextarea value={sheet.youtube_self_pr ?? ''} onChange={(e) => setField('youtube_self_pr', e.target.value)} minRows={6}
                    placeholder="YouTubeインタビュー用のプロフィール/自己紹介。空欄なら通常の自己PRを参考にAIが回答します。"
                    className="mt-0.5 w-full rounded-md border border-red-200 bg-red-50/40 px-2 py-1.5 text-sm" />
                  <div className="mt-0.5 text-[10px] text-[var(--color-text-sub)]">YouTubeマインドマップの回答生成はこの内容（無ければ通常の自己PR）を参考にします。</div>
                </>
              )}
            </div>

            {/* 職務経歴 */}
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--color-text)]">職務経歴</div>
              <button onClick={addProject} className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px]">＋ 案件を追加</button>
            </div>
            {sheet.projects.map((p, i) => {
              const isOpen = openProjects[i] !== false // デフォルト展開・false で折りたたみ
              return (
              <div key={i} className="rounded-xl border border-[var(--color-border)] p-3 space-y-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIndex.current !== null) moveProject(dragIndex.current, i); dragIndex.current = null }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span draggable onDragStart={() => { dragIndex.current = i }} onDragEnd={() => { dragIndex.current = null }}
                    title="ドラッグで並び替え"
                    className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing select-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] font-bold text-fuchsia-600 hover:bg-fuchsia-50">
                    <span className="text-sm leading-none text-[var(--color-text-sub)]">⠿</span>
                    案件 {i + 1}
                  </span>
                  <button type="button" onClick={() => toggleProjectOpen(i)} title={isOpen ? '詳細を閉じる' : '詳細を開く'}
                    className="text-[11px] text-[var(--color-text-sub)] hover:text-fuchsia-600">{isOpen ? '▼' : '▶'}</button>
                  <input type="month" value={toMonthInput(p.period_from)} onChange={(e) => setProj(i, 'period_from', e.target.value)}
                    className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
                  <span className="text-xs">〜</span>
                  {p.period_to === '現在' ? (
                    <span className="rounded-md border border-[var(--color-border)] bg-gray-50 px-2 py-1 text-xs">現在</span>
                  ) : (
                    <input type="month" value={toMonthInput(p.period_to)} onChange={(e) => setProj(i, 'period_to', e.target.value)}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
                  )}
                  <button type="button" onClick={() => setProj(i, 'period_to', p.period_to === '現在' ? '' : '現在')}
                    className={`rounded-md border px-2 py-1 text-[10px] ${p.period_to === '現在' ? 'border-fuchsia-400 bg-fuchsia-50 text-fuchsia-600' : 'border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
                    {p.period_to === '現在' ? '日付に戻す' : '現在(継続中)'}
                  </button>
                  <span className="ml-auto flex items-center gap-1">
                    {p.wantedly_work_experience_uuid && <span title="Wantedly連携済み" className="text-[10px] text-[#21bddb]">W✓</span>}
                    {p.anotherworks_resume_id && <span title="副業クラウド連携済み" className="text-[10px] text-orange-600">副✓</span>}
                    <button onClick={() => syncExternal('wantedly', i)} disabled={!!busy} title="この案件をWantedlyへ連携"
                      className="rounded border border-[#21bddb] px-1.5 py-0.5 text-[10px] text-[#21bddb] disabled:opacity-50">W</button>
                    <button onClick={() => syncExternal('anotherworks', i)} disabled={!!busy} title="この案件を副業クラウドへ連携"
                      className="rounded border border-orange-400 px-1.5 py-0.5 text-[10px] text-orange-600 disabled:opacity-50">副</button>
                    <button onClick={() => removeProject(i)} className="text-[11px] text-red-500">削除</button>
                  </span>
                </div>
                <label className="block text-[10px] text-[var(--color-text-sub)]">
                  プロジェクト名
                  <AutoGrowTextarea value={p.title ?? ''} onChange={(e) => setProj(i, 'title', e.target.value)} minRows={1}
                    placeholder="例: 企業向けオンライン学習SaaSの新規構築・機能追加"
                    className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text)]" />
                </label>
                {isOpen && (
                <>
                <div className="text-[10px] font-semibold text-[var(--color-text-sub)]">業務内容</div>
                <DescriptionSections value={p.description} onChange={(v) => setProj(i, 'description', v)} />
                <label className="block text-[10px] text-[var(--color-text-sub)]">
                  役割・規模
                  <AutoGrowTextarea value={p.role_scale ?? ''} onChange={(e) => setProj(i, 'role_scale', e.target.value)} minRows={2}
                    placeholder="役割・規模（例: PM兼PG 1人 / PG 3人）" className="mt-0.5 w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text)]" />
                </label>
                <ProjectTechTabs
                  values={{ languages: p.languages, db: p.db, server_os: p.server_os, tools: p.tools }}
                  candidates={techCandidates}
                  onChange={(field, v) => setProj(i, field, v)} />
                <div className="flex flex-wrap gap-2">
                  {SKILL_SHEET_PHASES.map((phase) => (
                    <label key={phase} className="flex items-center gap-1 text-[11px]">
                      <input type="checkbox" checked={!!p.phases[phase]} onChange={() => togglePhase(i, phase)} />
                      {phase}
                    </label>
                  ))}
                </div>
                </>
                )}
              </div>
              )
            })}
          </div>

          {/* AI 添削パネル */}
          <div className="glass rounded-2xl shadow-md p-4 space-y-3">
            <div className="text-sm font-semibold text-[var(--color-text)]">🤖 AI 添削</div>
            <div className="flex flex-wrap gap-1">
              {REVIEW_PRESETS.map((preset) => (
                <button key={preset} onClick={() => setInstruction(preset)}
                  className={`rounded-full px-2 py-1 text-[10px] border ${instruction === preset ? 'bg-fuchsia-500 text-white border-fuchsia-500' : 'border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
                  {preset}
                </button>
              ))}
            </div>
            <AutoGrowTextarea value={instruction} onChange={(e) => setInstruction(e.target.value)} minRows={2}
              placeholder="AIへの指示（任意）例: 雇いたくなる文章に、端的に" className="w-full rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs" />
            <button onClick={doReview} disabled={!!busy}
              className="w-full rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-sm font-semibold text-white shadow disabled:opacity-50">
              {busy === 'review' ? '添削中…' : 'AI で添削する'}
            </button>

            {review?.overall && (
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-2 text-xs whitespace-pre-wrap">{review.overall}</div>
            )}

            {sheet && (
              <ReviewItemsTable
                items={sheet.review_items ?? []}
                fieldOptions={reviewFieldOptions}
                onApply={applyReview}
                onUpdate={updateReviewItem}
                onDelete={deleteReviewItem}
                onAdd={addReviewItem}
                busy={!!busy}
              />
            )}

            {(review?.typos ?? []).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
                <div className="font-semibold text-amber-700">誤字・表記</div>
                <ul className="list-disc list-inside">{(review?.typos ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </div>
        </div>

        {/* 技術スタック (案件のフリーテキストから集計。バージョンはメジャーのみ・任意) */}
        <div className="glass rounded-2xl shadow-md p-4 mt-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold text-[var(--color-text)]">🧱 技術スタック</div>
              <div className="text-[11px] text-[var(--color-text-sub)]">
                職務経歴の使用言語・DB・サーバOS・ツールを横断集計（経験月数・最終使用・バージョン）
              </div>
            </div>
            <button onClick={doAnalyzeTech} disabled={!!busy}
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-50">
              {busy === 'tech' ? '集計中…' : '🔄 再集計'}
            </button>
          </div>

          {techGroups.length === 0 ? (
            <div className="text-xs text-[var(--color-text-sub)]">
              まだ集計されていません。「技術スタックを集計」を押すと、職務経歴から技術を抽出します。
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {techGroups.map((group) => (
                <div key={group.category} className="rounded-xl border border-[var(--color-border)] p-3">
                  <div className="text-[11px] font-bold text-sky-600 mb-2">{group.label}</div>
                  <div className="space-y-1">
                    {group.items.map((tech) => (
                      <div key={tech.id} className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-[var(--color-text)]">{tech.name}</span>
                        {tech.version && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">v{tech.version}</span>
                        )}
                        <span className="ml-auto text-[10px] text-[var(--color-text-sub)]">
                          {tech.experience_label && <span className="mr-2">{tech.experience_label}</span>}
                          {tech.last_used_on && <span>〜{tech.last_used_on}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* コメント (閲覧専用シートでもアプリ上でやり取りできる) */}
        <div className="glass rounded-2xl shadow-md p-4 mt-4 space-y-3">
          <div className="text-sm font-semibold text-[var(--color-text)]">💬 コメント</div>
          <div className="text-[11px] text-[var(--color-text-sub)]">
            スプレッドシートが閲覧権限のみで書き戻せない場合も、ここでコメントを残せます。
          </div>
          <div className="space-y-2">
            {(sheet.comments ?? []).length === 0 ? (
              <div className="text-xs text-[var(--color-text-sub)]">まだコメントはありません。</div>
            ) : (sheet.comments ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-[var(--color-border)] p-2 text-xs">
                <div className="flex items-center gap-2">
                  {c.target && <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] text-fuchsia-700">{c.target}</span>}
                  <span className="font-semibold">{c.author_name || '—'}</span>
                  <span className="text-[10px] text-[var(--color-text-sub)]">{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  <button onClick={() => deleteComment(c.id)} className="ml-auto text-[10px] text-red-500">削除</button>
                </div>
                <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={commentTarget} onChange={(e) => setCommentTarget(e.target.value)}
              placeholder="対象（任意）例: 自己PR" className="w-40 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs" />
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addComment() }}
              placeholder="コメントを入力" className="flex-1 min-w-[200px] rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs" />
            <button onClick={addComment} disabled={!newComment.trim() || !!busy}
              className="rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">追加</button>
          </div>
        </div>
       </>
      )}
    </div>
  )
}
