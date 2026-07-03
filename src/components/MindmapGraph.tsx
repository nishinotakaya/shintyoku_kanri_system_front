import { useEffect, useMemo, useRef, useState } from 'react'

// マインドマップの「線で繋ぐ」グラフ表示（横向きツリー＋曲線コネクタ）。
// 見やすさ強化版: 枝ごとの色分け / 子ブランチの折りたたみ / ズーム / 3行表示 / 凡例。
// 操作は従来どおり: クリック=読み上げ+拡大、ダブルクリック=編集、動画モードは1つずつ順に展開。
export type GraphNode = {
  id: number
  parent_id: number | null
  kind: 'root' | 'question' | 'answer' | 'keyword' | 'followup'
  text: string
  position: number
}

type Props = {
  nodes: GraphNode[]
  videoMode?: boolean
  onSpeak?: (node: GraphNode) => void
  onEditText?: (node: GraphNode, text: string) => void | Promise<void>
  /** ノードの「＋」ボタンで AI 展開（子ノード生成）。渡さなければボタン非表示 */
  onExpand?: (node: GraphNode) => void | Promise<void>
}

const KIND_STYLE: Record<string, string> = {
  root: 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white border-transparent',
  question: 'bg-sky-50 border-sky-300 text-sky-900',
  followup: 'bg-indigo-50 border-indigo-300 text-indigo-900',
  answer: 'bg-white border-[var(--color-border)] text-[var(--color-text)]',
}

// 第1階層の枝ごとに割り当てる色（エッジと左アクセントで枝を追いやすくする）
const BRANCH_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#f97316', '#6366f1']

export default function MindmapGraph({ nodes, videoMode = false, onSpeak, onEditText, onExpand }: Props) {
  // ダブルクリックで文言編集。1クリック=読み上げ(タイマーで dblclick と切り分け)。
  const [editId, setEditId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [focusId, setFocusId] = useState<number | null>(null) // クリックで拡大＝全文表示・強調するノード
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set()) // 折りたたんだ枝
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false) // 全画面表示（オーバーレイ）
  const [expandingId, setExpandingId] = useState<number | null>(null) // ＋(AI展開)実行中のノード
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const clickTimer = useRef<number | null>(null)
  // Ctrl/⌘ + ホイールでズーム（トラックパッドのピンチにも反応）
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.min(2, Math.max(0.4, Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fullscreen])
  // 全画面中は Esc で閉じる
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])
  const runExpand = async (n: GraphNode) => {
    if (!onExpand || expandingId != null) return
    setExpandingId(n.id)
    try { await onExpand(n) } finally { setExpandingId(null) }
  }
  // 背景を押したままドラッグでパン（手のひらツール）。ノード/ボタン上では発動しない。
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const onPanStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-node],button,textarea')) return
    const el = canvasRef.current
    if (!el) return
    e.preventDefault()
    panRef.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
    setPanning(true)
    const move = (ev: MouseEvent) => {
      const p = panRef.current; const c = canvasRef.current
      if (!p || !c) return
      c.scrollLeft = p.scrollLeft - (ev.clientX - p.x)
      c.scrollTop = p.scrollTop - (ev.clientY - p.y)
    }
    const up = () => {
      panRef.current = null
      setPanning(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const openEdit = (n: GraphNode) => { setEditId(n.id); setEditVal(n.text) }
  const commitEdit = async (n: GraphNode) => {
    const v = editVal
    setEditId(null)
    if (onEditText && v !== n.text) await onEditText(n, v)
  }
  const handleClick = (n: GraphNode) => {
    if (editId === n.id) return
    // クリックで拡大トグル（同じノードを再クリックで戻す）＋読み上げ
    setFocusId((c) => (c === n.id ? null : n.id))
    if (clickTimer.current) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => { clickTimer.current = null; onSpeak?.(n) }, 250)
  }
  const handleDouble = (n: GraphNode) => {
    if (clickTimer.current) { window.clearTimeout(clickTimer.current); clickTimer.current = null }
    if (onEditText) openEdit(n)
  }
  useEffect(() => () => { if (clickTimer.current) window.clearTimeout(clickTimer.current) }, [])
  // keyword はリスト表示同様グラフでも省く
  const visibleNodes = useMemo(() => nodes.filter((n) => n.kind !== 'keyword'), [nodes])

  const childrenOf = useMemo(() => {
    const byParent = new Map<number | null, GraphNode[]>()
    visibleNodes.forEach((n) => {
      const arr = byParent.get(n.parent_id) ?? []
      arr.push(n); byParent.set(n.parent_id, arr)
    })
    byParent.forEach((arr) => arr.sort((a, b) => a.position - b.position || a.id - b.id))
    return byParent
  }, [visibleNodes])

  // 子孫ノード数（折りたたみバッジの「+N」表示用）
  const descendantCount = useMemo(() => {
    const memo = new Map<number, number>()
    const count = (id: number): number => {
      if (memo.has(id)) return memo.get(id)!
      const kids = childrenOf.get(id) ?? []
      const total = kids.reduce((acc, k) => acc + 1 + count(k.id), 0)
      memo.set(id, total)
      return total
    }
    visibleNodes.forEach((n) => count(n.id))
    return memo
  }, [childrenOf, visibleNodes])

  // 寸法（動画用は大きめ＆余白広め）。通常も3行入る高さ・広めの行間で読みやすく。
  const colW = videoMode ? 300 : 250
  const rowH = videoMode ? 104 : 76
  const boxW = colW - (videoMode ? 64 : 46)
  const boxH = videoMode ? 72 : 58
  const padX = 24
  const padY = 24

  // 横向きツリー配置: x=深さ, y=葉の並び順。親yは子の中点。折りたたんだ枝の子孫は配置しない。
  const { pos, width, height, order, branchOf } = useMemo(() => {
    const pos = new Map<number, { x: number; y: number; depth: number }>()
    const branchOf = new Map<number, number>() // 第1階層の枝 index（色分け用）
    const order: number[] = [] // 展開アニメ用の表示順(DFS)
    let leafRow = 0
    let maxDepth = 0
    const layout = (node: GraphNode, depth: number, branch: number): number => {
      maxDepth = Math.max(maxDepth, depth)
      order.push(node.id)
      branchOf.set(node.id, branch)
      const kids = collapsedIds.has(node.id) ? [] : (childrenOf.get(node.id) ?? [])
      const x = padX + depth * colW
      if (kids.length === 0) {
        const y = padY + leafRow * rowH
        leafRow++
        pos.set(node.id, { x, y, depth })
        return y
      }
      const ys = kids.map((k, i) => layout(k, depth + 1, depth === 0 ? i : branch))
      const y = (ys[0] + ys[ys.length - 1]) / 2
      pos.set(node.id, { x, y, depth })
      return y
    }
    const roots = childrenOf.get(null) ?? []
    roots.forEach((r, i) => layout(r, 0, i))
    const width = padX * 2 + (maxDepth + 1) * colW
    const height = padY * 2 + Math.max(1, leafRow) * rowH
    return { pos, width, height, order, branchOf }
  }, [childrenOf, collapsedIds, colW, rowH])

  const branchColor = (id: number) => BRANCH_COLORS[(branchOf.get(id) ?? 0) % BRANCH_COLORS.length]

  // 動画用: 1クリックごとに1つずつ表示（録画しながら手動で展開）。通常モードは全表示。
  const [revealCount, setRevealCount] = useState(order.length)
  useEffect(() => {
    setRevealCount(videoMode ? 0 : order.length)
  }, [videoMode, order.length])
  const revealNext = () => setRevealCount((c) => Math.min(order.length, c + 1))
  const shown = (id: number) => !videoMode || order.indexOf(id) < revealCount

  const edges = useMemo(() => {
    const list: { id: string; d: string; child: number }[] = []
    visibleNodes.forEach((n) => {
      if (n.parent_id == null) return
      const p = pos.get(n.parent_id); const c = pos.get(n.id)
      if (!p || !c) return
      const x1 = p.x + boxW, y1 = p.y + boxH / 2
      const x2 = c.x, y2 = c.y + boxH / 2
      const mx = (x1 + x2) / 2
      list.push({ id: `${n.parent_id}-${n.id}`, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, child: n.id })
    })
    return list
  }, [visibleNodes, pos, boxW, boxH])

  const toggleCollapse = (id: number) => setCollapsedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // 全折りたたみ: 第2階層以降の「子持ち」を畳む（第1階層の枝までは見せる）
  const collapseAll = () => {
    const next = new Set<number>()
    const roots = childrenOf.get(null) ?? []
    const walk = (n: GraphNode, depth: number) => {
      const kids = childrenOf.get(n.id) ?? []
      if (depth >= 1 && kids.length > 0) next.add(n.id)
      kids.forEach((k) => walk(k, depth + 1))
    }
    roots.forEach((r) => walk(r, 0))
    setCollapsedIds(next)
  }

  if (visibleNodes.length === 0) {
    return <div className="text-xs text-[var(--color-text-sub)]">ノードがありません</div>
  }

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-white p-3' : ''}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {videoMode && (
          <>
            <button onClick={revealNext} disabled={revealCount >= order.length}
              className="rounded-lg bg-gradient-to-r from-red-500 to-rose-500 px-3 py-1 text-xs font-semibold text-white shadow disabled:opacity-40">▶ 次を1つ表示</button>
            <button onClick={() => setRevealCount(0)} className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-sub)]">最初から</button>
            <button onClick={() => setRevealCount(order.length)} className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-sub)]">全部表示</button>
            <span className="text-[10px] text-[var(--color-text-sub)]">{Math.min(revealCount, order.length)}/{order.length}</span>
            <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
          </>
        )}
        {/* ズーム */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white px-1 py-0.5">
          <button onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))} className="px-1.5 text-sm text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="縮小">−</button>
          <button onClick={() => setZoom(1)} className="px-1 text-[10px] tabular-nums text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="100%に戻す">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} className="px-1.5 text-sm text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="拡大">＋</button>
        </div>
        {/* 折りたたみ */}
        <button onClick={() => setCollapsedIds(new Set())} className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">⊞ 全て展開</button>
        <button onClick={collapseAll} className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">⊟ 枝まで畳む</button>
        {/* 全画面 */}
        <button onClick={() => setFullscreen((v) => !v)} title={fullscreen ? '全画面を終了 (Esc)' : '全画面で表示'}
          className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">
          {fullscreen ? '✕ 全画面を終了' : '⛶ 全画面'}
        </button>
        {/* 凡例 */}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--color-text-sub)]">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-sky-300 bg-sky-50" />質問</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-indigo-300 bg-indigo-50" />深掘り</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-[var(--color-border)] bg-white" />回答</span>
          <span className="hidden sm:inline">クリック=読み上げ・拡大 / ダブルクリック=編集</span>
        </span>
      </div>
      <div className={`relative ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
      {/* マップ右上のフローティング全画面ボタン（ツールバーの ⛶ と同機能） */}
      <button onClick={() => setFullscreen((v) => !v)} title={fullscreen ? '全画面を終了 (Esc)' : '全画面で表示'}
        className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-lg border border-[var(--color-border)] bg-white/90 text-sm text-[var(--color-text-sub)] shadow hover:bg-white hover:text-[var(--color-text)]">
        {fullscreen ? '✕' : '⛶'}
      </button>
      <div ref={canvasRef} onMouseDown={onPanStart}
        className={`overflow-auto rounded-xl border border-[var(--color-border)] ${fullscreen ? 'h-full' : ''}`}
        style={{ maxHeight: fullscreen ? undefined : '70vh', cursor: panning ? 'grabbing' : 'grab', background: 'radial-gradient(circle, rgba(148,163,184,.22) 1px, transparent 1px) 0 0/22px 22px, var(--color-bg)' }}>
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="relative" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <svg className="absolute inset-0" width={width} height={height} style={{ pointerEvents: 'none' }}>
              {edges.map((e) => (
                <path key={e.id} d={e.d} fill="none" stroke={branchColor(e.child)} strokeOpacity={0.5}
                  strokeWidth={videoMode ? 3 : 2.5} strokeLinecap="round"
                  style={{ opacity: shown(e.child) ? 1 : 0, transition: 'opacity .4s' }} />
              ))}
            </svg>
            {visibleNodes.map((n) => {
              const p = pos.get(n.id); if (!p) return null
              const editing = editId === n.id
              const focused = focusId === n.id
              const full = editing || focused // 全文表示（クリックで拡大 or 編集中）
              const kids = childrenOf.get(n.id) ?? []
              const collapsed = collapsedIds.has(n.id)
              const accent = n.kind === 'root' ? undefined : branchColor(n.id)
              return (
                <div key={n.id}
                  data-node
                  onClick={() => handleClick(n)}
                  onDoubleClick={() => handleDouble(n)}
                  title={n.text || undefined}
                  className={`absolute rounded-xl border px-3 shadow-sm ${KIND_STYLE[n.kind] || KIND_STYLE.answer} ${(onSpeak || onEditText) ? 'cursor-pointer hover:shadow-md' : ''} ${editing ? 'ring-2 ring-fuchsia-400' : focused ? 'ring-2 ring-amber-400 shadow-lg' : ''}`}
                  style={{
                    left: p.x, top: p.y, width: boxW, minHeight: boxH,
                    display: 'flex', alignItems: 'center',
                    fontSize: videoMode ? 16 : 12, lineHeight: 1.35, paddingTop: 6, paddingBottom: 6,
                    borderLeftWidth: accent ? 4 : undefined,
                    borderLeftColor: accent,
                    overflow: full ? 'visible' : 'hidden',
                    opacity: shown(n.id) ? 1 : 0,
                    transform: !shown(n.id) ? 'translateY(6px)' : (focused ? 'scale(1.35)' : 'none'),
                    transformOrigin: 'left center',
                    transition: 'opacity .4s, transform .25s',
                    zIndex: editing ? 30 : focused ? 25 : 1,
                  }}>
                  {editing ? (
                    <textarea autoFocus value={editVal}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(n)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(n) }
                        if (e.key === 'Escape') { e.preventDefault(); setEditId(null) }
                      }}
                      className="w-full resize-none bg-transparent outline-none"
                      style={{ color: 'inherit', fontSize: 'inherit', lineHeight: 1.35, minHeight: boxH - 12 }}
                      rows={Math.max(1, editVal.split('\n').length)} />
                  ) : (
                    <span className={full ? 'break-words' : 'line-clamp-3 break-words'}>{n.text || (n.kind === 'root' ? '起点' : '（空）')}</span>
                  )}
                  {/* 折りたたみバッジ（子持ちノードのみ）。クリックで枝の開閉、読み上げには反応させない */}
                  {kids.length > 0 && !editing && !videoMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(n.id) }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title={collapsed ? `枝を開く（+${descendantCount.get(n.id) ?? kids.length}）` : '枝を折りたたむ'}
                      className="absolute -right-2.5 top-1/2 -translate-y-1/2 grid h-5 min-w-5 place-items-center rounded-full border bg-white px-0.5 text-[9px] font-bold shadow"
                      style={{ borderColor: accent ?? '#d946ef', color: accent ?? '#d946ef', zIndex: 5 }}
                    >
                      {collapsed ? `+${descendantCount.get(n.id) ?? kids.length}` : '−'}
                    </button>
                  )}
                  {/* ＋(AI展開): このノードから子ノードをAI生成。右上に配置、読み上げには反応させない */}
                  {onExpand && !editing && !videoMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void runExpand(n) }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      disabled={expandingId != null}
                      title={n.kind === 'answer' ? 'AIで深掘り質問を生成' : 'AIで展開（子ノードを生成）'}
                      className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-[11px] font-bold text-white shadow hover:scale-110 transition disabled:opacity-40"
                      style={{ zIndex: 6 }}
                    >
                      {expandingId === n.id ? '…' : '＋'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
