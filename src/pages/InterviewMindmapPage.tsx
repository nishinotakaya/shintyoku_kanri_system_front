import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import ThumbnailStudio from '../components/ThumbnailStudio'
import MindmapGraph from '../components/mindmap/MindmapGraph'
import KanpeCueSheet from '../components/mindmap/KanpeCueSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import SearchableSelect from '../components/SearchableSelect'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import { breakBySentence } from '../lib/sentenceBreak'

type MindNode = {
  id: number
  parent_id: number | null
  kind: 'root' | 'question' | 'answer' | 'keyword' | 'followup'
  text: string
  position: number
  checked: boolean
  expanded: boolean
}
type MindMode = 'interview' | 'youtube' | 'mote'
type Mindmap = { id: number; user_id: number; title: string; mode?: MindMode; spreadsheet_url?: string | null; nodes: MindNode[]; kanpe_script?: string | null; kanpe_style?: 'sales' | 'app_build'; user?: { id: number; display_name: string } }
type Target = { id: number; display_name: string; email: string }

// マインドマップの表示サイズ(%)。選択は localStorage に保存して次回も維持する
const ZOOM_LEVELS = [70, 80, 90, 100, 120, 150, 200]
const ZOOM_STORAGE_KEY = 'mindmapZoomPercent'

const KIND_STYLE: Record<string, { label: string; cls: string }> = {
  root: { label: '起点', cls: 'bg-gray-100 text-gray-700' },
  question: { label: 'Q', cls: 'bg-fuchsia-100 text-fuchsia-700' },
  answer: { label: 'A', cls: 'bg-emerald-100 text-emerald-700' },
  keyword: { label: '🔑', cls: 'bg-amber-100 text-amber-700' },
  followup: { label: '↳Q', cls: 'bg-indigo-100 text-indigo-700' },
}

function speak(text: string) {
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'
    window.speechSynthesis.speak(u)
  } catch { /* 非対応ブラウザは無視 */ }
}

export default function InterviewMindmapPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [userId, setUserId] = useState<number | null>(null)
  const [map, setMap] = useState<Mindmap | null>(null)
  const [maps, setMaps] = useState<Mindmap[]>([]) // YouTube はタイトルごとに複数マップを切替
  const [newMapTitle, setNewMapTitle] = useState('')
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]) // AIタイトル提案の候補
  const [showDeleteMap, setShowDeleteMap] = useState(false)
  // 一番上のコントロール部のアコーディオン。スマホは初期折りたたみでマップをすぐ見られるように
  const [showControls, setShowControls] = useState(() => window.innerWidth >= 640)
  const [showMap, setShowMap] = useState(true)       // マインドマップ表示カードの開閉
  const [mapView, setMapView] = useState<'list' | 'graph' | 'kanpe'>('list') // 現在の表示(list) / 線で繋ぐグラフ(graph) / カンペ(kanpe)
  const [graphVideo, setGraphVideo] = useState(false) // グラフの動画用モード(大きめ＋順に展開)
  const [showThumb, setShowThumb] = useState(true)   // サムネ生成スタジオの開閉
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editId, setEditId] = useState<number | null>(null) // 編集中ノード
  const [draft, setDraft] = useState('')
  const [aiDraftFor, setAiDraftFor] = useState<number | null>(null) // AI添削案を編集欄に出しているノード
  const [localHover, setLocalHover] = useState<number | null>(null) // 自分がホバー中のノード(即時赤)
  const [othersHover, setOthersHover] = useState<Set<number>>(new Set()) // 他者がホバー中(ポーリング)
  const [showReset, setShowReset] = useState(false)
  const [showBankReset, setShowBankReset] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('')
  const [mode, setMode] = useState<MindMode>('interview') // 面談 / YouTube / モテ
  const [zoomPercent, setZoomPercent] = useState(() => {
    const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY))
    return ZOOM_LEVELS.includes(saved) ? saved : 100
  })
  const canYoutube = !!(me?.admin || me?.can_use_youtube_mindmap)
  const canMote = !!(me?.admin || me?.can_use_mote_mindmap)
  const isYoutube = mode === 'youtube'
  const isMote = mode === 'mote'
  const useTts = mode !== 'interview' // YouTube/モテ は高品質音声で読み上げ

  useEffect(() => { setSheetUrl(map?.spreadsheet_url ?? '') }, [map?.id, map?.spreadsheet_url])

  // カンペは YouTube モード専用。モードを離れたらカンペビューのままにしない
  useEffect(() => {
    if (!isYoutube) setMapView((currentView) => (currentView === 'kanpe' ? 'list' : currentView))
  }, [isYoutube])

  const changeZoom = (percent: number) => {
    setZoomPercent(percent)
    localStorage.setItem(ZOOM_STORAGE_KEY, String(percent))
  }

  useEffect(() => {
    api.get('/me').then((r) => setMe(r.data as Me))
    api.get<Target[]>('/skill_sheets/targets').then((r) => {
      setTargets(r.data)
      if (r.data.length) setUserId(r.data[0].id)
    }).catch(() => { /* 対象が取れなくても自分で操作 */ })
  }, [])

  // 共有ホバー: 他の人がカーソルを当てているノードを2.5秒ごとに取得して赤く表示
  useEffect(() => {
    if (!map) return
    const tick = async () => {
      try {
        const r = await api.get<{ node_id: number; user_id: number }[]>(`/interview_mindmaps/${map.id}/hovers`)
        setOthersHover(new Set(r.data.filter((h) => h.user_id !== me?.id).map((h) => h.node_id)))
      } catch { /* noop */ }
    }
    tick()
    const timer = setInterval(tick, 2500)
    return () => clearInterval(timer)
  }, [map?.id, me?.id])

  // 自分のホバーを非同期で共有(デバウンス)。mouseenter/leaveから呼ぶ。
  const hoverNode = (nodeId: number, hovering: boolean) => {
    if (!map) return
    setLocalHover((cur) => (hovering ? nodeId : (cur === nodeId ? null : cur)))
    api.patch(`/interview_mindmaps/${map.id}/nodes/${nodeId}/hover`, { hovering }).catch(() => { /* noop */ })
  }

  useEffect(() => {
    if (userId == null) return
    setMap(null); setMaps([]); setErr(null)
    api.get<Mindmap[]>('/interview_mindmaps', { params: { user_id: userId, mode } })
      .then((r) => { setMaps(r.data); if (r.data.length) setMap(r.data[0]) })
      .catch((e) => setErr(e?.response?.data?.error ?? '読み込みに失敗しました'))
  }, [userId, mode])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e: any) { setErr(e?.response?.data?.error ?? e?.message ?? '失敗しました') } finally { setBusy(null) }
  }

  // YouTube はタイトル指定で複数作成できる。他モードはデフォルトタイトルで1つ
  const createMap = (title?: string) => run('create', async () => {
    const r = await api.post<Mindmap>('/interview_mindmaps', { user_id: userId, mode, ...(title ? { title } : {}) })
    setMaps((prev) => [r.data, ...prev])
    setMap(r.data)
    setNewMapTitle('')
  })

  // onclass のリサーチ(高再生の傾向)+スキルシートから YouTube タイトル案を生成。
  // theme に入力中のタイトル文字列を渡すと、その切り口に寄せた案が出る。
  const suggestTitles = () => run('suggest-titles', async () => {
    if (userId == null) return
    const r = await api.post<{ titles: string[] }>('/interview_mindmaps/suggest_titles', { user_id: userId, theme: newMapTitle.trim() || undefined })
    setTitleSuggestions(r.data.titles ?? [])
  })

  // 切替時は一覧のスナップショットではなくサーバーから取り直す(展開・編集が反映済みの最新を表示)
  const selectMap = (id: number) => run('select', async () => {
    const r = await api.get<Mindmap>(`/interview_mindmaps/${id}`)
    setMap(r.data)
  })

  const deleteMap = () => run('deleteMap', async () => {
    if (!map) return
    await api.delete(`/interview_mindmaps/${map.id}`)
    const rest = maps.filter((m) => m.id !== map.id)
    setMaps(rest); setMap(rest[0] ?? null); setShowDeleteMap(false)
  })

  // 読み上げ: YouTube/モテは OpenAI TTS(人間っぽい高品質音声)、面談はブラウザ標準。
  const speakNode = (node: MindNode) => {
    if (!useTts || !map) { speak(node.text); return }
    run(`tts-${node.id}`, async () => {
      const r = await api.post(`/interview_mindmaps/${map.id}/nodes/${node.id}/speech`, {}, { responseType: 'blob' })
      const audioUrl = URL.createObjectURL(r.data as Blob)
      const audio = new Audio(audioUrl)
      audio.onended = () => URL.revokeObjectURL(audioUrl)
      await audio.play()
    })
  }

  const exportSheet = () => run('export', async () => {
    if (!map) return
    const r = await api.post<{ rows: number; spreadsheet_url: string }>(`/interview_mindmaps/${map.id}/export_sheet`, { spreadsheet_url: sheetUrl })
    setErr(null)
    setMap((m) => m ? { ...m, spreadsheet_url: r.data.spreadsheet_url } : m)
    alert(`スプレッドシートに書き出しました（${r.data.rows}行）`)
  })

  const resetMap = () => run('reset', async () => {
    if (!map) return
    const r = await api.post<Mindmap>(`/interview_mindmaps/${map.id}/reset`, {})
    setMap(r.data); setShowReset(false)
  })

  const importBank = () => run('bank', async () => {
    if (!map) return
    const r = await api.post<Mindmap & { imported: number }>(`/interview_mindmaps/${map.id}/import_bank`, {})
    setMap(r.data)
  })

  // 質問バンク取り込み分(source=bank)だけ削除（AI展開・手入力は残す）
  const resetBank = () => run('resetBank', async () => {
    if (!map) return
    const r = await api.post<Mindmap>(`/interview_mindmaps/${map.id}/reset_bank`, {})
    setMap(r.data); setShowBankReset(false)
  })

  // 展開(AI)とは別に、空のQ(質問)を子として追加し、すぐ編集モードにする
  const addChildQuestion = (parent: MindNode) => run(`addq-${parent.id}`, async () => {
    if (!map) return
    const r = await api.post<MindNode>(`/interview_mindmaps/${map.id}/nodes`, { parent_id: parent.id, kind: 'question', text: '' })
    setMap((m) => m ? { ...m, nodes: [...m.nodes, r.data] } : m)
    setEditId(r.data.id); setDraft('')
  })

  const expand = (node: MindNode) => run(`exp-${node.id}`, async () => {
    if (!map) return
    const r = await api.post<{ children: MindNode[] }>(`/interview_mindmaps/${map.id}/nodes/${node.id}/expand`, {})
    setMap((m) => m ? { ...m, nodes: [...m.nodes.map((n) => n.id === node.id ? { ...n, expanded: true } : n), ...r.data.children] } : m)
  })

  // AI添削: ノードのテキストを「人が話すように自然な文章」に整える。
  // 結果は自動保存せず、編集欄に差し込んで本人がレビュー→保存（非破壊）。
  const proofread = (node: MindNode) => run(`pf-${node.id}`, async () => {
    if (!map) return
    const r = await api.post<{ corrected_text: string }>(`/interview_mindmaps/${map.id}/nodes/${node.id}/proofread`, {})
    setEditId(node.id)
    setDraft(r.data.corrected_text)
    setAiDraftFor(node.id)
  })

  const startEdit = (node: MindNode) => { setEditId(node.id); setDraft(node.text); setAiDraftFor(null) }
  const cancelEdit = () => { setEditId(null); setAiDraftFor(null) }
  const saveText = (node: MindNode) => run(`save-${node.id}`, async () => {
    if (!map) return
    // YouTube の起点(root)を編集 → タイトルとして保存（root テキストもタイトルに追従）
    if (node.kind === 'root' && map.mode === 'youtube') {
      const r = await api.patch<Mindmap>(`/interview_mindmaps/${map.id}`, { title: draft })
      setMap(r.data); setMaps((prev) => prev.map((m) => m.id === r.data.id ? r.data : m)); cancelEdit()
      return
    }
    const r = await api.patch<MindNode>(`/interview_mindmaps/${map.id}/nodes/${node.id}`, { text: draft })
    setMap((m) => m ? { ...m, nodes: m.nodes.map((n) => n.id === node.id ? r.data : n) } : m)
    cancelEdit()
  })
  // グラフ表示からのダブルクリック編集用（draft 非依存）。root(YouTube)はタイトルに反映。
  const saveNodeText = async (node: MindNode, text: string) => {
    if (!map) return
    if (node.kind === 'root' && map.mode === 'youtube') {
      const r = await api.patch<Mindmap>(`/interview_mindmaps/${map.id}`, { title: text })
      setMap(r.data); setMaps((prev) => prev.map((m) => m.id === r.data.id ? r.data : m))
      return
    }
    const r = await api.patch<MindNode>(`/interview_mindmaps/${map.id}/nodes/${node.id}`, { text })
    setMap((m) => m ? { ...m, nodes: m.nodes.map((n) => n.id === node.id ? r.data : n) } : m)
  }

  const toggleCheck = (node: MindNode) => run(`chk-${node.id}`, async () => {
    if (!map) return
    const r = await api.patch<MindNode>(`/interview_mindmaps/${map.id}/nodes/${node.id}`, { checked: !node.checked })
    setMap((m) => m ? { ...m, nodes: m.nodes.map((n) => n.id === node.id ? r.data : n) } : m)
  })

  const removeNode = (node: MindNode) => run(`del-${node.id}`, async () => {
    if (!map) return
    await api.delete(`/interview_mindmaps/${map.id}/nodes/${node.id}`)
    // 削除ノードとその子孫をクライアントから除去
    const all = map.nodes
    const removed = new Set<number>()
    const collect = (id: number) => { removed.add(id); all.filter((n) => n.parent_id === id).forEach((c) => collect(c.id)) }
    collect(node.id)
    setMap((m) => m ? { ...m, nodes: m.nodes.filter((n) => !removed.has(n.id)) } : m)
  })

  const childrenOf = useMemo(() => {
    const byParent = new Map<number | null, MindNode[]>()
    ;(map?.nodes ?? []).forEach((n) => {
      const arr = byParent.get(n.parent_id) ?? []
      arr.push(n); byParent.set(n.parent_id, arr)
    })
    byParent.forEach((arr) => arr.sort((a, b) => a.position - b.position))
    return byParent
  }, [map])

  const progress = useMemo(() => {
    const qs = (map?.nodes ?? []).filter((n) => n.kind === 'question' || n.kind === 'followup')
    const done = qs.filter((n) => n.checked).length
    return { done, total: qs.length }
  }, [map])

  // 通常の再帰関数として描画する(コンポーネント化すると毎描画で再マウントされ、編集中のカーソルが飛ぶため)
  const renderNode = (node: MindNode, depth: number): React.ReactNode => {
    if (node.kind === 'keyword') return null // キーワード(黄色)ノードは表示しない
    const kids = (childrenOf.get(node.id) ?? []).filter((c) => c.kind !== 'keyword')
    const st = KIND_STYLE[node.kind] ?? KIND_STYLE.question
    // answer も展開可: A(回答)から深掘りQ(モテは言い回しバリエーション)を生成できる
    const canExpand = node.kind === 'root' || node.kind === 'question' || node.kind === 'followup' || node.kind === 'answer'
    const expandTitle = node.kind === 'answer' ? (isMote ? 'AIで言い回しバリエーションを生成' : 'AIで深掘り質問を生成') : 'AIで展開'
    return (
      // インデントはスマホで浅く(8px)、PCで通常(16px)。深い階層でも右に寄りすぎない
      <div key={node.id} className={`mt-1 ${depth === 0 ? '' : 'ml-2 sm:ml-4'}`}>
        {/* 狭い画面では操作ボタン群がまとめて下の行に折り返し、本文の幅を潰さない */}
        {/* カーソルを当てると赤く。他PC/ブラウザの人がホバー中のノードも赤く見える(共有) */}
        <div
          onMouseEnter={() => hoverNode(node.id, true)}
          onMouseLeave={() => hoverNode(node.id, false)}
          className={`flex flex-wrap items-start gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${(localHover === node.id || othersHover.has(node.id)) ? 'border-red-400 bg-red-50' : 'border-[var(--color-border)] bg-white'}`}>
          <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
          {(node.kind === 'question' || node.kind === 'followup') && (
            <input type="checkbox" className="mt-1" checked={node.checked} onChange={() => toggleCheck(node)} title="答えられた/暗記済み" />
          )}
          {editId === node.id ? (
            <span className="min-w-[180px] flex-1">
              {aiDraftFor === node.id && (
                <span className="mb-1 block rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">✨ AIの添削案です。確認・修正して「保存」で反映されます。</span>
              )}
              {/* 内容に合わせて自動で伸びる(3行固定だと長文が切れるため) */}
              <AutoGrowTextarea value={draft} autoFocus minRows={3} onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded border border-fuchsia-300 px-2 py-1 text-xs leading-relaxed" />
              <span className="mt-1 flex gap-1">
                <button onClick={() => saveText(node)} disabled={!!busy}
                  className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">{busy === `save-${node.id}` ? '保存中…' : '保存'}</button>
                <button onClick={cancelEdit} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]">キャンセル</button>
              </span>
            </span>
          ) : (
            <span
              className="min-w-[160px] flex-1 cursor-text whitespace-pre-wrap break-words text-xs text-[var(--color-text)]"
              title={node.kind === 'root' && isYoutube ? 'ダブルクリックでタイトルを編集' : 'ダブルクリックで編集'}
              onDoubleClick={() => startEdit(node)}
            >{breakBySentence(node.text)}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {editId !== node.id && (
              <button onClick={() => startEdit(node)} title={node.kind === 'root' && isYoutube ? 'タイトルを編集' : '編集'} className="text-[11px] text-[var(--color-text-sub)] hover:text-fuchsia-600">✏️</button>
            )}
            {node.kind !== 'root' && editId !== node.id && node.text.trim() !== '' && (
              <button onClick={() => proofread(node)} disabled={busy === `pf-${node.id}`}
                title="AIで添削（人が話すように自然な文章にまとめる）"
                className="text-[11px] text-[var(--color-text-sub)] hover:text-violet-600 disabled:opacity-50">{busy === `pf-${node.id}` ? '⏳' : '✨'}</button>
            )}
            <button onClick={() => speakNode(node)} disabled={busy === `tts-${node.id}`} title={useTts ? '読み上げ(高品質音声)' : '読み上げ'} className="text-[11px] text-[var(--color-text-sub)] hover:text-fuchsia-600 disabled:opacity-50">{busy === `tts-${node.id}` ? '⏳' : '🔊'}</button>
            {canExpand && (
              <button onClick={() => addChildQuestion(node)} disabled={!!busy} title="空のQを追加（手入力）"
                className="rounded border border-sky-300 px-1.5 py-0.5 text-[10px] text-sky-600 disabled:opacity-50">
                {busy === `addq-${node.id}` ? '…' : '＋Q'}
              </button>
            )}
            {canExpand && (
              <button onClick={() => expand(node)} disabled={!!busy} title={expandTitle}
                className="rounded border border-fuchsia-300 px-1.5 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">
                {busy === `exp-${node.id}` ? '…' : (node.expanded ? '再展開' : '＋展開')}
              </button>
            )}
            {node.kind !== 'root' && (
              <button onClick={() => removeNode(node)} title="削除" className="text-[11px] text-gray-400 hover:text-red-500">🗑</button>
            )}
          </span>
        </div>
        {kids.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  const roots = childrenOf.get(null) ?? []

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl shadow-md p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setShowControls((value) => !value)} title={showControls ? '折りたたむ' : '開く'}
            className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
            <span className="text-[10px] text-[var(--color-text-sub)]">{showControls ? '▼' : '▶'}</span>
            <span>{isYoutube ? '🎬 YouTubeインタビューマインドマップ' : isMote ? '💬 モテ会話マインドマップ' : '🧠 面談対策マインドマップ'}</span>
          </button>
          {(canYoutube || canMote) && (
            <div className="flex items-center gap-1">
              <button onClick={() => setMode('interview')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${mode === 'interview' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>面談</button>
              {canYoutube && (
                <button onClick={() => setMode('youtube')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold ${isYoutube ? 'bg-red-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>▶ YouTube</button>
              )}
              {canMote && (
                <button onClick={() => setMode('mote')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold ${isMote ? 'bg-pink-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>💬 モテ</button>
              )}
            </div>
          )}
        </div>
        {showControls && <>
        <div className="text-[11px] text-[var(--color-text-sub)]">{isYoutube ? '起点（＝動画タイトル。ダブルクリックで編集）とYouTube用プロフィール(自己PR)をもとに、固定の質問バンク(12問)で展開。回答は本人の語り口で端的にAI生成、🔊は高品質音声で読み上げ。' : isMote ? '相手のセリフ→盛り上がる返し＋合コンのつかみゲーム集。「📋 会話＆合コンネタを取込」で一覧化、各セリフの「＋展開」でAIが別の返しを生成。🔊で読み上げ。' : 'スキルシートから想定質問を予測し、AIで枝分かれ展開。質問は声に出して練習、覚えたらチェック。'}</div>
        <div className="flex flex-wrap items-center gap-2">
          {me?.admin && (
            <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
              {targets.map((t) => <option key={t.id} value={t.id}>{t.display_name || t.email}</option>)}
            </select>
          )}
          {!map && userId != null && !isYoutube && (
            <button onClick={() => createMap()} disabled={!!busy}
              className="rounded-lg bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'create' ? '作成中…' : '＋ マインドマップを作成'}
            </button>
          )}
          {map && (
            <button onClick={importBank} disabled={!!busy}
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-50">
              {busy === 'bank' ? '取込中…' : (isYoutube ? '📋 質問バンク取込（YouTube12問）' : isMote ? '📋 会話＆合コンネタを取込' : '📋 質問バンク取込')}
            </button>
          )}
          {map && (
            <button onClick={() => setShowBankReset(true)} disabled={!!busy}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-50">
              {busy === 'resetBank' ? '削除中…' : '🧹 質問バンクのみリセット'}
            </button>
          )}
          {map && (
            <button onClick={() => setShowReset(true)} disabled={!!busy}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50">↺ リセット</button>
          )}
          {map && <span className="text-[11px] text-[var(--color-text-sub)]">暗記進捗 {progress.done}/{progress.total}</span>}
        </div>
        {isYoutube && userId != null && (
          <div className="flex flex-wrap items-center gap-2">
            {maps.length > 0 && (
              <SearchableSelect options={maps.map((m) => ({ value: m.id, label: m.title }))}
                value={map?.id ?? null} onChange={selectMap} disabled={!!busy}
                title="動画タイトルでマインドマップを切替（検索できます）" placeholder="タイトルを検索…"
                className="max-w-[280px]" />
            )}
            <input value={newMapTitle} onChange={(e) => setNewMapTitle(e.target.value)} placeholder="新しい動画タイトルを入力（またはAI提案）"
              className="min-w-[200px] flex-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
            <button onClick={suggestTitles} disabled={!!busy}
              title="onclassのYouTubeリサーチ（高再生の傾向）とスキルシートからタイトル案を生成"
              className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-600 disabled:opacity-50">
              {busy === 'suggest-titles' ? '提案中…' : '🪄 AIタイトル提案'}
            </button>
            <button onClick={() => createMap(newMapTitle.trim())} disabled={!!busy || !newMapTitle.trim()}
              className="rounded-lg bg-gradient-to-r from-red-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'create' ? '作成中…' : '＋ この動画タイトルで作成'}
            </button>
            {map && (
              <button onClick={() => setShowDeleteMap(true)} disabled={!!busy} title="表示中のマインドマップを削除"
                className="rounded-lg border border-red-300 px-2 py-1.5 text-xs text-red-500 disabled:opacity-50">🗑</button>
            )}
            {titleSuggestions.length > 0 && (
              <div className="mt-1 w-full rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-fuchsia-700">リサーチをもとにしたタイトル案（クリックで入力）</span>
                  <button onClick={() => setTitleSuggestions([])} className="text-[11px] text-[var(--color-text-sub)] hover:text-fuchsia-600">✕ 閉じる</button>
                </div>
                <div className="flex flex-col gap-1">
                  {titleSuggestions.map((t, i) => (
                    <button key={i} onClick={() => setNewMapTitle(t)}
                      className="rounded-md border border-fuchsia-200 bg-white px-2 py-1 text-left text-xs text-[var(--color-text)] hover:border-fuchsia-400 hover:bg-fuchsia-100">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {map && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="書き出し先スプレッドシートURL"
              className="min-w-[240px] flex-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs" />
            <button onClick={exportSheet} disabled={!!busy || !sheetUrl}
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {busy === 'export' ? '書き出し中…' : '📤 スプレッドシートへ書き出し'}
            </button>
          </div>
        )}
        </>}
        {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}
      </div>

      {map && (
        <div className="glass rounded-2xl shadow-md p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setShowMap((value) => !value)} title={showMap ? '折りたたむ' : '開く'}
              className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-sub)]">
              <span className="text-[10px]">{showMap ? '▼' : '▶'}</span>
              <span>{map.title}</span>
            </button>
            {showMap && (
              <div className="flex flex-wrap items-center gap-2">
                {/* 表示切替: 現在のリスト ↔ 線で繋ぐマインドマップ */}
                <div className="flex items-center gap-1">
                  <button onClick={() => setMapView('list')}
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${mapView === 'list' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>📋 リスト</button>
                  <button onClick={() => setMapView('graph')}
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${mapView === 'graph' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>🕸 マインドマップ</button>
                  {/* カンペは西野式YouTubeセールステンプレ専用なので YouTube モードだけに出す */}
                  {isYoutube && (
                    <button onClick={() => setMapView('kanpe')}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${mapView === 'kanpe' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>📝 カンペ</button>
                  )}
                  {mapView === 'graph' && (
                    <button onClick={() => setGraphVideo((v) => !v)} title="文字を大きく・1問ずつ順に展開"
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${graphVideo ? 'bg-red-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>🎬 動画用</button>
                  )}
                </div>
                {(mapView === 'list' || mapView === 'kanpe') && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-[var(--color-text-sub)]">🔍 表示サイズ</span>
                    {ZOOM_LEVELS.map((percent) => (
                      <button key={percent} onClick={() => changeZoom(percent)} title={`表示サイズ ${percent}%`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${zoomPercent === percent ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)] hover:text-fuchsia-600'}`}>
                        {percent}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {showMap && <>
          {mapView !== 'kanpe' && roots.length === 0 && <div className="text-xs text-[var(--color-text-sub)]">ノードがありません</div>}
          {mapView === 'list' ? (
            <>
              <div style={{ zoom: zoomPercent / 100 }}>
                {roots.map((n) => renderNode(n, 0))}
              </div>
              <div className="mt-2 text-[10px] text-[var(--color-text-sub)]">「起点」の「＋展開」でAIが想定質問を生成。「📋 質問バンク取込」で用意した質問と模範回答も取り込めます。各質問を展開すると端的回答・深掘り質問が出ます。</div>
            </>
          ) : mapView === 'graph' ? (
            <>
              <MindmapGraph nodes={map.nodes} videoMode={graphVideo}
                onEditText={(n, text) => saveNodeText({ checked: false, expanded: false, ...n }, text)}
                onExpand={(n) => expand({ checked: false, expanded: false, ...n })} />
              <div className="mt-2 text-[10px] text-[var(--color-text-sub)]">ノード右上の<b>＋でAI展開</b>（子ノードを生成）、右端の−/＋Nで枝の開閉。<b>ダブルクリックで文言を編集</b>、カーソルを当てている間だけ拡大表示。⛶で全画面、Ctrl(⌘)+スクロールでズーム。「🎬 動画用」で大きく＆1問ずつ順に展開。</div>
            </>
          ) : (
            <div style={{ zoom: zoomPercent / 100 }}>
              <KanpeCueSheet mindmapId={map.id} kanpeScript={map.kanpe_script ?? null}
                kanpeStyle={map.kanpe_style ?? 'sales'}
                onStyleChange={(kanpeStyle) => {
                  setMap((current) => current ? { ...current, kanpe_style: kanpeStyle } : current)
                  setMaps((prev) => prev.map((m) => m.id === map.id ? { ...m, kanpe_style: kanpeStyle } : m))
                }}
                onSaved={(kanpeScript) => {
                  setMap((current) => current ? { ...current, kanpe_script: kanpeScript } : current)
                  setMaps((prev) => prev.map((m) => m.id === map.id ? { ...m, kanpe_script: kanpeScript } : m))
                }} />
            </div>
          )}
          </>}
        </div>
      )}

      {/* YouTube モード: タイトル+内容から自動でサムネを生成(アコーディオン) */}
      {map && isYoutube && (
        <div className="glass rounded-2xl shadow-md p-4">
          <button onClick={() => setShowThumb((value) => !value)} title={showThumb ? '折りたたむ' : '開く'}
            className="flex w-full items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
            <span className="text-[10px] text-[var(--color-text-sub)]">{showThumb ? '▼' : '▶'}</span>
            <span>🖼 サムネ生成スタジオ</span>
          </button>
          {showThumb && <div className="mt-3"><ThumbnailStudio mindmapId={map.id} title={map.title} /></div>}
        </div>
      )}

      {showReset && (
        <ConfirmDialog
          title="マインドマップをリセット"
          message={<>生成・取り込んだ質問と回答がすべて削除され、起点だけの状態に戻ります。<br />この操作は取り消せません。よろしいですか？</>}
          confirmLabel="リセットする" busyLabel="リセット中…" busy={busy === 'reset'} disabled={!!busy}
          onConfirm={resetMap} onClose={() => setShowReset(false)} />
      )}

      {showDeleteMap && map && (
        <ConfirmDialog
          title="マインドマップを削除"
          message={<>「{map.title}」を質問・回答ごと削除します。<br />この操作は取り消せません。よろしいですか？</>}
          confirmLabel="削除する" busyLabel="削除中…" busy={busy === 'deleteMap'} disabled={!!busy}
          onConfirm={deleteMap} onClose={() => setShowDeleteMap(false)} />
      )}

      {showBankReset && (
        <ConfirmDialog
          title="質問バンクのみリセット"
          message={<>「📋 質問バンク取込」で取り込んだ質問と回答だけを削除します。<br />AIで展開した質問・手入力で追加した質問は残ります。よろしいですか？</>}
          confirmLabel="質問バンクを削除" busyLabel="削除中…" busy={busy === 'resetBank'} disabled={!!busy} tone="warning"
          onConfirm={resetBank} onClose={() => setShowBankReset(false)} />
      )}
    </div>
  )
}
