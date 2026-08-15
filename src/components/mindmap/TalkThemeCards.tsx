import { useMemo, useState } from 'react'

// 合コンの席でスマホを出して全員で見る「トークテーマトランプ」。
// 取り込んだ質問ノード(「♥7｜お題」形式)を山札にして、本物のトランプのように 1 枚ずつめくる。
// レイアウトは 2 種類 ── めくり(山札から1枚) と ドーナツ(円に伏せた札から好きな1枚を引く)。

type MindNode = {
  id: number
  parent_id: number | null
  kind: string
  text: string
}

type Card = {
  id: number
  suit: string        // ♥ ♦ ♣ ♠ / 🃏
  rank: string        // A 2〜10 J Q K / ①②
  theme: string       // お題
  back: string        // 予備のお題・振り方・盛り上げ・NG
  depth: 'light' | 'mid' | 'deep'
}

const SUITS = ['♥', '♦', '♣', '♠'] as const
const DEPTH_LABEL: Record<Card['depth'], string> = { light: 'ゆるっと', mid: 'ふつう', deep: 'ふかい' }
const DEPTH_EMOJI: Record<Card['depth'], string> = { light: '🍬', mid: '🌸', deep: '💗' }

// ランクを踏み込む深さに変換する。A〜5=軽い / 6〜9=ふつう / 10〜K=深い。
const depthOf = (rank: string): Card['depth'] => {
  if (['J', 'Q', 'K', '10'].includes(rank)) return 'deep'
  const num = rank === 'A' ? 1 : Number(rank)
  if (!Number.isFinite(num)) return 'light'
  return num <= 5 ? 'light' : 'mid'
}

// 「♥7｜今までで一番きゅんとした瞬間」→ suit/rank/theme に分解する。形式が違う行は山札に入れない。
function parseCard(node: MindNode, back: string): Card | null {
  const matched = node.text.match(/^([♥♦♣♠])(A|K|Q|J|10|[2-9])｜(.+)$/)
  if (matched) {
    const [, suit, rank, theme] = matched
    return { id: node.id, suit, rank, theme: theme.trim(), back, depth: depthOf(rank) }
  }
  const joker = node.text.match(/^🃏\s*ジョーカー(.)｜(.+)$/)
  if (joker) return { id: node.id, suit: '🃏', rank: joker[1], theme: joker[2].trim(), back, depth: 'light' }
  return null
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const isRedSuit = (suit: string) => suit === '♥' || suit === '♦'

type Props = {
  nodes: MindNode[]
  onClose: () => void
  onImport: () => Promise<void>
  importing: boolean
}

export default function TalkThemeCards({ nodes, onClose, onImport, importing }: Props) {
  const [suitFilter, setSuitFilter] = useState<string | null>(null)
  const [depthFilter, setDepthFilter] = useState<Card['depth'] | null>(null)
  const [layout, setLayout] = useState<'flip' | 'donut'>('flip')
  const [drawn, setDrawn] = useState(0)       // 山札の何枚目か
  const [flipped, setFlipped] = useState(false)
  const [showBack, setShowBack] = useState(false) // 振り方・盛り上げ方の面
  const [seed, setSeed] = useState(0)

  const allCards = useMemo(() => {
    const answerOf = new Map<number, string>()
    nodes.forEach((node) => {
      if (node.kind === 'answer' && node.parent_id != null && !answerOf.has(node.parent_id)) {
        answerOf.set(node.parent_id, node.text)
      }
    })
    return nodes
      .filter((node) => node.kind === 'question')
      .map((node) => parseCard(node, answerOf.get(node.id) ?? ''))
      .filter((card): card is Card => card !== null)
  }, [nodes])

  const deck = useMemo(() => {
    const filtered = allCards.filter((card) => {
      if (suitFilter && card.suit !== suitFilter) return false
      if (depthFilter && card.depth !== depthFilter) return false
      return true
    })
    return shuffled(filtered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards, suitFilter, depthFilter, seed])

  const card = deck[drawn] ?? null
  const remaining = Math.max(deck.length - drawn - 1, 0)

  const reset = () => { setDrawn(0); setFlipped(false); setShowBack(false) }
  const drawAt = (index: number) => {
    setShowBack(false)
    setFlipped(false)
    setDrawn(index)
    // 一度伏せてから回す。すぐ true にすると回転が始まらない
    window.setTimeout(() => setFlipped(true), 60)
  }
  const next = () => drawAt(drawn + 1 >= deck.length ? 0 : drawn + 1)
  const changeFilter = (apply: () => void) => { apply(); reset() }

  // ドーナツに並べる伏せ札(多すぎると潰れるので12枚まで)
  const ringSize = Math.min(deck.length, 12)
  const ring = Array.from({ length: ringSize }, (_, index) => index)

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: 'radial-gradient(120% 90% at 50% 0%, #ffe6f3 0%, #ffd9ec 35%, #efd9ff 70%, #e3dbff 100%)' }}>
      <style>{`
        @keyframes ttc-float { 0%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-14px) rotate(8deg)} 100%{transform:translateY(0) rotate(0deg)} }
        @keyframes ttc-pop { 0%{transform:scale(.86);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes ttc-sparkle { 0%,100%{opacity:.35;transform:scale(.9)} 50%{opacity:1;transform:scale(1.15)} }
        .ttc-float{animation:ttc-float 5s ease-in-out infinite}
        .ttc-pop{animation:ttc-pop .35s cubic-bezier(.34,1.56,.64,1) both}
        .ttc-sparkle{animation:ttc-sparkle 2.4s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){ .ttc-float,.ttc-pop,.ttc-sparkle{animation:none!important} .ttc-inner{transition:none!important} }
      `}</style>

      {/* ふわふわ浮かぶ背景の飾り */}
      <div aria-hidden className="pointer-events-none absolute inset-0 select-none">
        {['💕', '✨', '🌸', '💗', '🎀', '⭐️', '🩷', '🫧'].map((emoji, index) => (
          <span key={index} className="ttc-float absolute text-2xl opacity-60"
            style={{
              left: `${[8, 82, 20, 70, 45, 90, 12, 60][index]}%`,
              top: `${[14, 10, 74, 66, 6, 44, 40, 86][index]}%`,
              animationDelay: `${index * 0.6}s`,
            }}>{emoji}</span>
        ))}
      </div>

      <div className="relative flex items-center justify-between px-4 py-3">
        <span className="text-sm font-black tracking-wide text-[#c2438a] drop-shadow-sm">🃏 トークテーマトランプ</span>
        <button onClick={onClose} aria-label="閉じる"
          className="rounded-full border-2 border-white/80 bg-white/70 px-3 py-1 text-sm font-bold text-[#c2438a] shadow-sm backdrop-blur hover:bg-white">
          ✕ とじる
        </button>
      </div>

      {allCards.length === 0 ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-base font-bold text-[#a8437c]">まだカードがありません。54枚のデッキをご用意します 🎀</p>
          <button onClick={() => { void onImport() }} disabled={importing}
            className="rounded-full bg-gradient-to-r from-pink-400 to-fuchsia-500 px-8 py-3 text-base font-black text-white shadow-lg shadow-pink-300/50 disabled:opacity-50">
            {importing ? '準備中…' : '🃏 カードを配る'}
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex flex-1 items-center justify-center px-4">
            {layout === 'donut' && (
              <DonutRing ring={ring} onPick={drawAt} activeIndex={flipped ? drawn : -1} />
            )}
            {card ? (
              <PlayingCard card={card} flipped={flipped} showBack={showBack}
                onTap={() => {
                  if (!flipped) { setFlipped(true); return }
                  if (!showBack) { setShowBack(true); return }
                  next()
                }} />
            ) : (
              <p className="font-bold text-[#a8437c]">この条件のカードがありません</p>
            )}
          </div>

          <div className="relative space-y-3 px-4 pb-6 pt-2">
            <div className="flex items-center justify-center gap-2">
              <button onClick={next}
                className="rounded-full bg-gradient-to-r from-pink-400 to-fuchsia-500 px-8 py-3 text-base font-black text-white shadow-lg shadow-pink-300/50 active:scale-95">
                つぎのカード 💫
              </button>
              <button onClick={() => { setSeed((value) => value + 1); reset() }}
                className="rounded-full border-2 border-white/80 bg-white/70 px-4 py-3 text-sm font-bold text-[#c2438a] shadow-sm backdrop-blur">
                🔀 まぜる
              </button>
            </div>

            <div className="flex items-center justify-center gap-2">
              <LayoutTab active={layout === 'flip'} onClick={() => { setLayout('flip'); reset() }}>🂠 めくり</LayoutTab>
              <LayoutTab active={layout === 'donut'} onClick={() => { setLayout('donut'); reset() }}>🍩 ドーナツ</LayoutTab>
              <span className="ml-1 text-xs font-bold text-[#b4568f]">のこり {remaining} まい</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <Chip active={suitFilter === null} onClick={() => changeFilter(() => setSuitFilter(null))}>ぜんぶ</Chip>
              {SUITS.map((suit) => (
                <Chip key={suit} active={suitFilter === suit} onClick={() => changeFilter(() => setSuitFilter(suit))}>
                  <span className={isRedSuit(suit) ? 'text-rose-500' : 'text-slate-700'}>{suit}</span>
                </Chip>
              ))}
              <span className="mx-1 text-[#e3a9c8]">|</span>
              <Chip active={depthFilter === null} onClick={() => changeFilter(() => setDepthFilter(null))}>ふかさ自由</Chip>
              {(['light', 'mid', 'deep'] as const).map((depth) => (
                <Chip key={depth} active={depthFilter === depth} onClick={() => changeFilter(() => setDepthFilter(depth))}>
                  {DEPTH_EMOJI[depth]} {DEPTH_LABEL[depth]}
                </Chip>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 本物のトランプに寄せた 1 枚。タップで Y 軸に 3D 回転して表になる。
function PlayingCard({ card, flipped, showBack, onTap }:
  { card: Card; flipped: boolean; showBack: boolean; onTap: () => void }) {
  const red = isRedSuit(card.suit)
  const ink = red ? '#e0407a' : '#4b3f72'

  return (
    <button onClick={onTap} aria-label="カードをめくる"
      className="relative z-10 h-[62vh] max-h-[520px] w-[76vw] max-w-[340px] active:scale-[0.98]"
      style={{ perspective: '1400px' }}>
      <div className="ttc-inner relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform .7s cubic-bezier(.4,.2,.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}>

        {/* 裏面：ハート柄の背模様 */}
        <div className="absolute inset-0 overflow-hidden rounded-[22px] border-[6px] border-white shadow-2xl shadow-pink-400/40"
          style={{
            backfaceVisibility: 'hidden',
            background: 'repeating-linear-gradient(45deg,#ff9ec7 0 12px,#ffb3d6 12px 24px)',
          }}>
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/90 bg-white/35 text-4xl backdrop-blur-sm">
              💗
            </div>
          </div>
        </div>

        {/* 表面：四隅のインデックス＋中央のお題 */}
        <div className="absolute inset-0 flex flex-col rounded-[22px] border-[6px] border-white bg-white px-4 py-3 shadow-2xl shadow-pink-400/40"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CornerIndex card={card} color={ink} />

          <div className="flex flex-1 items-center justify-center overflow-hidden px-1">
            {!showBack ? (
              <div className="ttc-pop flex flex-col items-center gap-3 text-center">
                <span className="ttc-sparkle text-3xl">{DEPTH_EMOJI[card.depth]}</span>
                <p className="text-[25px] font-black leading-snug text-[#3a2f4d]">{card.theme}</p>
                <span className="rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{ background: red ? '#ffe4ef' : '#eae6ff', color: ink }}>
                  {DEPTH_LABEL[card.depth]}
                </span>
              </div>
            ) : (
              <div className="h-full w-full overflow-y-auto pt-1">
                <p className="mb-2 text-center text-[15px] font-black text-[#3a2f4d]">{card.theme}</p>
                <div className="space-y-1.5 text-[14px] leading-relaxed text-[#544a66]">
                  {card.back.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                </div>
              </div>
            )}
          </div>

          <CornerIndex card={card} color={ink} bottom />
          <p className="mt-1 text-center text-[10px] font-bold" style={{ color: red ? '#f0a8c4' : '#b6aede' }}>
            {showBack ? 'タップでつぎのカードへ 💫' : 'タップで振り方・盛り上げ方 🎀'}
          </p>
        </div>
      </div>
    </button>
  )
}

// 四隅のランク＋スート。下側は本物と同じく180度回す。
function CornerIndex({ card, color, bottom }: { card: Card; color: string; bottom?: boolean }) {
  return (
    <div className={`flex ${bottom ? 'justify-end' : 'justify-start'}`}
      style={bottom ? { transform: 'rotate(180deg)' } : undefined}>
      <div className="flex flex-col items-center leading-none" style={{ color }}>
        <span className="text-xl font-black">{card.suit === '🃏' ? '🃏' : card.rank}</span>
        <span className="text-lg">{card.suit === '🃏' ? '' : card.suit}</span>
      </div>
    </div>
  )
}

// 伏せた札を円形に並べる。好きな1枚をタップすると、そのカードが中央で開く。
function DonutRing({ ring, onPick, activeIndex }:
  { ring: number[]; onPick: (index: number) => void; activeIndex: number }) {
  return (
    <div aria-hidden={false} className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative h-[min(84vw,380px)] w-[min(84vw,380px)]">
        {ring.map((index) => {
          const angle = (360 / ring.length) * index
          return (
            <button key={index} onClick={() => onPick(index)} aria-label={`${index + 1}枚目を引く`}
              className="pointer-events-auto absolute left-1/2 top-1/2 h-16 w-11 rounded-lg border-[3px] border-white shadow-lg transition-transform hover:scale-110"
              style={{
                background: index === activeIndex
                  ? 'linear-gradient(160deg,#fff 0%,#ffe9f3 100%)'
                  : 'repeating-linear-gradient(45deg,#ff9ec7 0 6px,#ffb3d6 6px 12px)',
                transform: `translate(-50%,-50%) rotate(${angle}deg) translateY(calc(-1 * min(38vw, 168px))) rotate(${-angle}deg)`,
              }}>
              <span className="text-lg">{index === activeIndex ? '💗' : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LayoutTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-black shadow-sm ${active ? 'bg-white text-[#c2438a]' : 'border-2 border-white/70 bg-white/40 text-[#b4568f] backdrop-blur'}`}>
      {children}
    </button>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold ${active ? 'bg-white text-[#c2438a] shadow-sm' : 'border-2 border-white/60 bg-white/35 text-[#a8437c] backdrop-blur'}`}>
      {children}
    </button>
  )
}
