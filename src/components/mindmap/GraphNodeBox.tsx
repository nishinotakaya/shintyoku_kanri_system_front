import { useState } from 'react'
import AutoGrowTextarea from '../AutoGrowTextarea'
import { breakBySentence } from '../../lib/sentenceBreak'
import { KIND_STYLE } from './types'
import type { GraphNode } from './types'

// グラフ表示のノード1個の描画（本文 / 編集textarea / 折りたたみ・AI展開バッジ）。
// 編集中の下書きテキストは NodeEditArea 内で持つ（親は「どのノードが編集中か」だけ管理）。

// 編集欄。編集開始時にマウントされ、その時点のテキストで下書きを初期化する。
// 内容に合わせて自動で伸びる（折り返しでも切れない）。Shift+Enter=改行 / Enter=保存 / Esc=キャンセル。
function NodeEditArea({ initialText, onCommit, onCancel }: {
  initialText: string
  onCommit: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialText)
  return (
    <AutoGrowTextarea autoFocus value={draft} minRows={4}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onCommit(draft) }
        if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      }}
      className="w-full bg-transparent outline-none"
      style={{ color: 'inherit', fontSize: 'inherit', lineHeight: 1.5, minHeight: 100 }} />
  )
}

type Props = {
  node: GraphNode
  x: number
  y: number
  boxW: number
  boxH: number
  videoMode: boolean
  /** 枝色（root は undefined = アクセントなし） */
  accent?: string
  editing: boolean
  focused: boolean
  /** 動画モードの順次表示で表示済みか */
  visible: boolean
  kidsCount: number
  descendantTotal: number
  collapsed: boolean
  /** どこかのノードでAI展開実行中（全ノードの＋を無効化） */
  expandDisabled: boolean
  expandingThis: boolean
  showExpandButton: boolean
  onClick: () => void
  onDoubleClick: () => void
  onCommitEdit: (text: string) => void
  onCancelEdit: () => void
  onToggleCollapse: () => void
  onExpand: () => void
}

export default function GraphNodeBox({
  node, x, y, boxW, boxH, videoMode, accent,
  editing, focused, visible, kidsCount, descendantTotal, collapsed,
  expandDisabled, expandingThis, showExpandButton,
  onClick, onDoubleClick, onCommitEdit, onCancelEdit, onToggleCollapse, onExpand,
}: Props) {
  // カーソルを当てるだけで拡大（全文表示＋ズーム）。クリックで固定（スマホ用）、ダブルクリックで編集。
  const [hovered, setHovered] = useState(false)
  const full = editing || focused || hovered // 全文表示（ホバー/クリック固定/編集中）
  const enlarged = !editing && (focused || hovered)

  return (
    <div
      data-node
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={node.text || undefined}
      className={`absolute rounded-xl border px-3 shadow-sm cursor-pointer hover:shadow-md ${KIND_STYLE[node.kind] || KIND_STYLE.answer} ${editing ? 'ring-2 ring-fuchsia-400' : focused ? 'ring-2 ring-amber-400 shadow-lg' : hovered ? 'ring-2 ring-amber-300 shadow-lg' : ''}`}
      style={{
        // 編集中はテキストエリアが広く使えるようにボックス自体を大きくする
        left: x, top: y, width: editing ? Math.max(boxW * 1.8, 360) : boxW, minHeight: editing ? 150 : boxH,
        display: 'flex', alignItems: 'center',
        fontSize: videoMode ? 16 : 12, lineHeight: 1.35, paddingTop: 6, paddingBottom: 6,
        borderLeftWidth: accent ? 4 : undefined,
        borderLeftColor: accent,
        overflow: full ? 'visible' : 'hidden',
        opacity: visible ? 1 : 0,
        transform: !visible ? 'translateY(6px)' : (enlarged ? 'scale(1.35)' : 'none'),
        transformOrigin: 'left center',
        transition: 'opacity .4s, transform .25s',
        zIndex: editing ? 30 : focused ? 25 : hovered ? 20 : 1,
      }}>
      {editing ? (
        <NodeEditArea initialText={node.text} onCommit={onCommitEdit} onCancel={onCancelEdit} />
      ) : (
        <span className={`whitespace-pre-wrap break-words ${full ? '' : 'line-clamp-3'}`}>{node.text ? breakBySentence(node.text) : (node.kind === 'root' ? '起点' : '（空）')}</span>
      )}
      {/* 折りたたみバッジ（子持ちノードのみ）。クリックで枝の開閉、ノードクリックには反応させない */}
      {kidsCount > 0 && !editing && !videoMode && (
        <button
          onClick={(event) => { event.stopPropagation(); onToggleCollapse() }}
          onDoubleClick={(event) => event.stopPropagation()}
          title={collapsed ? `枝を開く（+${descendantTotal}）` : '枝を折りたたむ'}
          className="absolute -right-2.5 top-1/2 -translate-y-1/2 grid h-5 min-w-5 place-items-center rounded-full border bg-white px-0.5 text-[9px] font-bold shadow"
          style={{ borderColor: accent ?? '#d946ef', color: accent ?? '#d946ef', zIndex: 5 }}
        >
          {collapsed ? `+${descendantTotal}` : '−'}
        </button>
      )}
      {/* ＋(AI展開): このノードから子ノードをAI生成。右上に配置、ノードクリックには反応させない */}
      {showExpandButton && !editing && (
        <button
          onClick={(event) => { event.stopPropagation(); onExpand() }}
          onDoubleClick={(event) => event.stopPropagation()}
          disabled={expandDisabled}
          title={node.kind === 'answer' ? 'AIで深掘り質問を生成' : 'AIで展開（子ノードを生成）'}
          className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 text-[11px] font-bold text-white shadow hover:scale-110 transition disabled:opacity-40"
          style={{ zIndex: 6 }}
        >
          {expandingThis ? '…' : '＋'}
        </button>
      )}
    </div>
  )
}
