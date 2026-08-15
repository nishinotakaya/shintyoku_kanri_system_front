import { useMemo, useState } from 'react'

// 合コンの席でスマホを出して全員で見る前提の「トークテーマトランプ」。
// 取り込んだ質問ノード(「♥7｜お題」形式)を山札にして、タップで1枚ずつめくる。
// 暗い店内でも読めるように黒背景＋白いカード、文字は大きめに振ってある。

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
const DEPTH_LABEL: Record<Card['depth'], string> = { light: '軽い', mid: 'ふつう', deep: '深い' }
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

// Fisher-Yates。引くたびに新しい順番になるよう、シャッフルのたびに作り直す。
function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

type Props = {
  nodes: MindNode[]
  onClose: () => void
  onImport: () => Promise<void>
  importing: boolean
}

export default function TalkThemeCards({ nodes, onClose, onImport, importing }: Props) {
  const [suitFilter, setSuitFilter] = useState<string | null>(null)
  const [depthFilter, setDepthFilter] = useState<Card['depth'] | null>(null)
  const [drawn, setDrawn] = useState(0)      // 何枚めくったか
  const [showBack, setShowBack] = useState(false)
  const [seed, setSeed] = useState(0)        // シャッフルするたびに増やして山札を組み直す

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
    // seed はシャッフルボタン用。値そのものは使わないが、変わると山札を組み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards, suitFilter, depthFilter, seed])

  const card = deck[drawn] ?? null
  const remaining = Math.max(deck.length - drawn - 1, 0)

  const reset = () => { setDrawn(0); setShowBack(false) }
  const next = () => {
    setShowBack(false)
    setDrawn((current) => (current + 1 >= deck.length ? 0 : current + 1))
  }
  const changeFilter = (apply: () => void) => { apply(); reset() }

  const isRed = card?.suit === '♥' || card?.suit === '♦'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#141018] text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-wide text-white/70">🃏 トークテーマトランプ</span>
        <button onClick={onClose} aria-label="閉じる"
          className="rounded-full border border-white/25 px-3 py-1 text-sm text-white/80 hover:bg-white/10">✕ 閉じる</button>
      </div>

      {allCards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-base text-white/70">まだカードがありません。54枚のデッキを取り込みます。</p>
          <button onClick={() => { void onImport() }} disabled={importing}
            className="rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 px-6 py-3 text-base font-bold text-white shadow-lg disabled:opacity-50">
            {importing ? '準備中…' : '🃏 カードを準備する'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 items-center justify-center px-4 pb-2">
            {card ? (
              <button onClick={() => (showBack ? next() : setShowBack(true))}
                className="flex h-full max-h-[68vh] w-full max-w-md flex-col rounded-3xl bg-white px-6 py-7 text-left text-[#1b1620] shadow-2xl active:scale-[0.99]">
                <div className={`flex items-baseline justify-between ${isRed ? 'text-rose-600' : 'text-[#1b1620]'}`}>
                  <span className="text-4xl font-black leading-none">{card.suit}{card.suit !== '🃏' && card.rank}</span>
                  <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold text-black/50">{DEPTH_LABEL[card.depth]}</span>
                </div>

                {!showBack ? (
                  <div className="flex flex-1 items-center justify-center">
                    <p className="text-center text-[26px] font-bold leading-snug">{card.theme}</p>
                  </div>
                ) : (
                  <div className="mt-4 flex-1 overflow-y-auto">
                    <p className="mb-3 text-base font-bold leading-snug text-black/80">{card.theme}</p>
                    <div className="space-y-2 text-[15px] leading-relaxed text-black/75">
                      {card.back.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                    </div>
                  </div>
                )}

                <p className={`mt-4 text-center text-xs ${isRed ? 'text-rose-400' : 'text-black/40'}`}>
                  {showBack ? 'タップで次のカードへ' : 'タップで振り方・盛り上げ方を見る'}
                </p>
              </button>
            ) : (
              <p className="text-white/60">この条件のカードがありません</p>
            )}
          </div>

          <div className="space-y-3 px-4 pb-6">
            <div className="flex items-center justify-center gap-3">
              <button onClick={next}
                className="rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 px-8 py-3 text-base font-bold text-white shadow-lg">
                次のカード
              </button>
              <button onClick={() => { setSeed((value) => value + 1); reset() }}
                className="rounded-xl border border-white/25 px-4 py-3 text-sm font-semibold text-white/80 hover:bg-white/10">
                🔀 シャッフル
              </button>
            </div>
            <p className="text-center text-xs text-white/45">残り {remaining} 枚 / 全 {deck.length} 枚</p>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <FilterChip active={suitFilter === null} onClick={() => changeFilter(() => setSuitFilter(null))}>全部</FilterChip>
              {SUITS.map((suit) => (
                <FilterChip key={suit} active={suitFilter === suit} onClick={() => changeFilter(() => setSuitFilter(suit))}>
                  <span className={suit === '♥' || suit === '♦' ? 'text-rose-400' : ''}>{suit}</span>
                </FilterChip>
              ))}
              <span className="mx-1 text-white/20">|</span>
              <FilterChip active={depthFilter === null} onClick={() => changeFilter(() => setDepthFilter(null))}>深さ自由</FilterChip>
              {(['light', 'mid', 'deep'] as const).map((depth) => (
                <FilterChip key={depth} active={depthFilter === depth} onClick={() => changeFilter(() => setDepthFilter(depth))}>
                  {DEPTH_LABEL[depth]}
                </FilterChip>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-white text-[#141018]' : 'border border-white/25 text-white/70 hover:bg-white/10'}`}>
      {children}
    </button>
  )
}
