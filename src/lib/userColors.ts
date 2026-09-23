// カレンダーで複数メンバーの稼働を重ねて表示するときの色。
// ユーザーIDから決めるので、誰をチェックしても同じ人は毎回同じ色になる。
// Tailwind の動的クラスは JIT に拾われないため、値は hex で持ち inline style で当てる。
export type UserColor = {
  /** ドット・チェックボックスの色 */
  base: string
  /** 日セルのチップ背景 */
  soft: string
  /** チップの文字色 */
  text: string
}

/** 自分（マイカレンダー）の色。ほかのメンバーには使わない */
export const SELF_COLOR: UserColor = { base: '#059669', soft: '#d1fae5', text: '#065f46' }

const MEMBER_COLORS: UserColor[] = [
  { base: '#0284c7', soft: '#e0f2fe', text: '#075985' },
  { base: '#d97706', soft: '#fef3c7', text: '#92400e' },
  { base: '#7c3aed', soft: '#ede9fe', text: '#5b21b6' },
  { base: '#e11d48', soft: '#ffe4e6', text: '#9f1239' },
  { base: '#0d9488', soft: '#ccfbf1', text: '#115e59' },
  { base: '#4f46e5', soft: '#e0e7ff', text: '#3730a3' },
  { base: '#ea580c', soft: '#ffedd5', text: '#9a3412' },
  { base: '#0891b2', soft: '#cffafe', text: '#155e75' },
]

/** 自分以外のメンバーの色。ユーザーIDで決まるので一覧の並び順が変わってもブレない */
export function colorForUser(userId: number): UserColor {
  return MEMBER_COLORS[Math.abs(userId) % MEMBER_COLORS.length]
}
