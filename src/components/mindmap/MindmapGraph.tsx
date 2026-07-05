import { useEffect, useRef, useState } from 'react'
import { useGraphLayout } from './useGraphLayout'
import GraphNodeBox from './GraphNodeBox'
import type { GraphNode } from './types'

export type { GraphNode } from './types'

// マインドマップの「線で繋ぐ」グラフ表示（横向きツリー＋曲線コネクタ）の指揮者。
// 配置計算は useGraphLayout、ノード1個の描画は GraphNodeBox に分離。
// 操作: ホバー中だけ拡大、ダブルクリック=編集(保存/キャンセルボタン付き)、動画モードは1つずつ順に展開。

type Props = {
  nodes: GraphNode[]
  videoMode?: boolean
  onEditText?: (node: GraphNode, text: string) => void | Promise<void>
  /** ノードの「＋」ボタンで AI 展開（子ノード生成）。渡さなければボタン非表示 */
  onExpand?: (node: GraphNode) => void | Promise<void>
}

export default function MindmapGraph({ nodes, videoMode = false, onEditText, onExpand }: Props) {
  const [editId, setEditId] = useState<number | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set()) // 折りたたんだ枝
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false) // 全画面表示（オーバーレイ）
  const [expandingId, setExpandingId] = useState<number | null>(null) // ＋(AI展開)実行中のノード
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const { metrics, visibleNodes, childrenOf, descendantCount, pos, width, height, order, edges, branchColor } =
    useGraphLayout(nodes, collapsedIds, videoMode)

  // Ctrl/⌘ + ホイールでズーム（トラックパッドのピンチにも反応）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom((current) => Math.min(2, Math.max(0.4, Math.round((current + (event.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [fullscreen])

  // 全画面中は Esc で閉じる
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // 背景を押したままドラッグでパン（手のひらツール）。ノード/ボタン上では発動しない。
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const onPanStart = (event: React.MouseEvent) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-node],button,textarea')) return
    const canvas = canvasRef.current
    if (!canvas) return
    event.preventDefault()
    panRef.current = { x: event.clientX, y: event.clientY, scrollLeft: canvas.scrollLeft, scrollTop: canvas.scrollTop }
    setPanning(true)
    const move = (moveEvent: MouseEvent) => {
      const start = panRef.current
      const target = canvasRef.current
      if (!start || !target) return
      target.scrollLeft = start.scrollLeft - (moveEvent.clientX - start.x)
      target.scrollTop = start.scrollTop - (moveEvent.clientY - start.y)
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

  const runExpand = async (node: GraphNode) => {
    if (!onExpand || expandingId != null) return
    setExpandingId(node.id)
    try { await onExpand(node) } finally { setExpandingId(null) }
  }

  const commitEdit = async (node: GraphNode, text: string) => {
    setEditId(null)
    if (onEditText && text !== node.text) await onEditText(node, text)
  }

  // 動画用: 1クリックごとに1つずつ表示（録画しながら手動で展開）。通常モードは全表示。
  const [revealCount, setRevealCount] = useState(order.length)
  useEffect(() => {
    setRevealCount(videoMode ? 0 : order.length)
  }, [videoMode, order.length])
  const revealNext = () => setRevealCount((count) => Math.min(order.length, count + 1))
  const shown = (id: number) => !videoMode || order.indexOf(id) < revealCount

  const toggleCollapse = (id: number) => setCollapsedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // 全折りたたみ: 第2階層以降の「子持ち」を畳む（第1階層の枝までは見せる）
  const collapseAll = () => {
    const next = new Set<number>()
    const roots = childrenOf.get(null) ?? []
    const walk = (node: GraphNode, depth: number) => {
      const kids = childrenOf.get(node.id) ?? []
      if (depth >= 1 && kids.length > 0) next.add(node.id)
      kids.forEach((kid) => walk(kid, depth + 1))
    }
    roots.forEach((root) => walk(root, 0))
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
          <button onClick={() => setZoom((current) => Math.max(0.4, Math.round((current - 0.1) * 10) / 10))} className="px-1.5 text-sm text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="縮小">−</button>
          <button onClick={() => setZoom(1)} className="px-1 text-[10px] tabular-nums text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="100%に戻す">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((current) => Math.min(2, Math.round((current + 0.1) * 10) / 10))} className="px-1.5 text-sm text-[var(--color-text-sub)] hover:text-[var(--color-text)]" title="拡大">＋</button>
        </div>
        {/* 折りたたみ */}
        <button onClick={() => setCollapsedIds(new Set())} className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">⊞ 全て展開</button>
        <button onClick={collapseAll} className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">⊟ 枝まで畳む</button>
        {/* 全画面 */}
        <button onClick={() => setFullscreen((value) => !value)} title={fullscreen ? '全画面を終了 (Esc)' : '全画面で表示'}
          className="rounded-lg border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-[var(--color-text-sub)] hover:bg-gray-50">
          {fullscreen ? '✕ 全画面を終了' : '⛶ 全画面'}
        </button>
        {/* 凡例 */}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--color-text-sub)]">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-sky-300 bg-sky-50" />質問</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-indigo-300 bg-indigo-50" />深掘り</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded border border-[var(--color-border)] bg-white" />回答</span>
          <span className="hidden sm:inline">カーソルで拡大 / ダブルクリック=編集</span>
        </span>
      </div>
      <div className={`relative ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
        {/* マップ右上のフローティング全画面ボタン（ツールバーの ⛶ と同機能） */}
        <button onClick={() => setFullscreen((value) => !value)} title={fullscreen ? '全画面を終了 (Esc)' : '全画面で表示'}
          className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-lg border border-[var(--color-border)] bg-white/90 text-sm text-[var(--color-text-sub)] shadow hover:bg-white hover:text-[var(--color-text)]">
          {fullscreen ? '✕' : '⛶'}
        </button>
        <div ref={canvasRef} onMouseDown={onPanStart}
          className={`overflow-auto rounded-xl border border-[var(--color-border)] ${fullscreen ? 'h-full' : ''}`}
          style={{ maxHeight: fullscreen ? undefined : '70vh', cursor: panning ? 'grabbing' : 'grab', background: 'radial-gradient(circle, rgba(148,163,184,.22) 1px, transparent 1px) 0 0/22px 22px, var(--color-bg)' }}>
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div className="relative" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <svg className="absolute inset-0" width={width} height={height} style={{ pointerEvents: 'none' }}>
                {edges.map((edge) => (
                  <path key={edge.id} d={edge.d} fill="none" stroke={branchColor(edge.child)} strokeOpacity={0.5}
                    strokeWidth={videoMode ? 3 : 2.5} strokeLinecap="round"
                    style={{ opacity: shown(edge.child) ? 1 : 0, transition: 'opacity .4s' }} />
                ))}
              </svg>
              {visibleNodes.map((node) => {
                const position = pos.get(node.id)
                if (!position) return null
                const kids = childrenOf.get(node.id) ?? []
                return (
                  <GraphNodeBox key={node.id}
                    node={node}
                    x={position.x} y={position.y} boxW={metrics.boxW} boxH={metrics.boxH}
                    videoMode={videoMode}
                    accent={node.kind === 'root' ? undefined : branchColor(node.id)}
                    editing={editId === node.id}
                    visible={shown(node.id)}
                    kidsCount={kids.length}
                    descendantTotal={descendantCount.get(node.id) ?? kids.length}
                    collapsed={collapsedIds.has(node.id)}
                    expandDisabled={expandingId != null}
                    expandingThis={expandingId === node.id}
                    showExpandButton={!!onExpand && !videoMode}
                    onDoubleClick={() => { if (onEditText) setEditId(node.id) }}
                    onCommitEdit={(text) => void commitEdit(node, text)}
                    onCancelEdit={() => setEditId(null)}
                    onToggleCollapse={() => toggleCollapse(node.id)}
                    onExpand={() => void runExpand(node)}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
