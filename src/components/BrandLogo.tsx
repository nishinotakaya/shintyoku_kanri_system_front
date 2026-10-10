import { useId } from 'react'
import { APP_NAME } from '../lib/brand'

// ロゴマーク: 右肩上がりの 4 本のバー(仕事のリズム = Tempo と進捗)。箱は付けず、バー自体をブランドのグラデーションで塗る。
function BrandMark({ className }: { className: string }) {
  const gradientId = useId()
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 drop-shadow-[0_2px_4px_rgba(108,92,231,0.35)] ${className}`} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-primary-light)" />
          <stop offset="55%" stopColor="var(--color-primary)" />
          <stop offset="100%" stopColor="#c56cf0" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <rect x="1.5" y="14" width="4" height="9" rx="2" />
        <rect x="7.5" y="9.5" width="4" height="13.5" rx="2" />
        <rect x="13.5" y="5" width="4" height="18" rx="2" />
        <rect x="19.5" y="1" width="4" height="22" rx="2" />
      </g>
    </svg>
  )
}

// 「Work」+ グラデーションの「Tempo」。APP_NAME を変えたときは素直に 1 色で表示する。
function Wordmark({ className }: { className: string }) {
  const accentStart = APP_NAME.indexOf('Tempo')
  return (
    <span className={`whitespace-nowrap font-[Outfit,var(--font-sans)] font-bold tracking-tight text-[var(--color-text)] ${className}`}>
      {accentStart > 0 ? (
        <>
          {APP_NAME.slice(0, accentStart)}
          <span className="bg-gradient-to-r from-[var(--color-primary)] to-[#c56cf0] bg-clip-text text-transparent">
            {APP_NAME.slice(accentStart)}
          </span>
        </>
      ) : (
        APP_NAME
      )}
    </span>
  )
}

// variant="sidebar": サイドバー上部(マーク大きめ + キャッチ)。
// variant="compact": ヘッダー用(サイドバーを閉じている時・スマホ)。キャッチは出さない。
export default function BrandLogo({ variant }: { variant: 'sidebar' | 'compact' }) {
  if (variant === 'compact') {
    return (
      <span className="flex items-center gap-2">
        <BrandMark className="h-6 w-6 sm:h-7 sm:w-7" />
        {/* スマホ幅はヘッダーのボタンが詰まるのでマークだけ。sm 以上で文字も出す */}
        <Wordmark className="hidden text-xl leading-none sm:inline" />
      </span>
    )
  }
  return (
    <span className="flex items-center gap-3">
      <BrandMark className="h-8 w-8 md:h-9 md:w-9" />
      <span className="flex flex-col gap-1">
        <Wordmark className="text-[22px] leading-none md:text-2xl" />
        <span className="text-[10px] font-medium tracking-[0.18em] text-[var(--color-text-sub)]">勤怠・請求・進捗</span>
      </span>
    </span>
  )
}
