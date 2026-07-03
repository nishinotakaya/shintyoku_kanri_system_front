// 技術欄の値(改行/スラッシュ/カンマ/中黒/スペース等で連結されうる)を個別タグに分割する共通ロジック。
// 表示(TagSelectField)とカウント(ProjectTechTabs)で同じ結果になるよう一本化する。
//   - 強い区切り(改行 / ／ 、 ， ; ； ・)で分ける
//   - 残ったスペース区切りは、候補にある複数語名(Ruby on Rails / Tailwind CSS)を優先して結合
//   - バージョンらしいトークン(18.2 / 7.0.8.1 / (3.3.0))は直前の技術名に結合する
const isVersionLike = (token: string) =>
  /^[v]?[0-9][0-9.]*$/i.test(token) || /^[（(].*[）)]$/.test(token)

export function splitTags(value: string | null | undefined, candidates: string[] = []): string[] {
  if (!value) return []
  const known = new Set(candidates.map((c) => c.toLowerCase()))
  const chunks = value
    .replace(/[／/、，;；・]+/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const out: string[] = []
  for (const chunk of chunks) {
    if (!/\s/.test(chunk)) { out.push(chunk); continue }
    const tokens = chunk.split(/\s+/)
    let i = 0
    while (i < tokens.length) {
      // 候補にある複数語名を貪欲に結合
      let merged = ''
      let len = 1
      for (let j = tokens.length; j > i; j--) {
        const cand = tokens.slice(i, j).join(' ')
        if (known.has(cand.toLowerCase())) { merged = cand; len = j - i; break }
      }
      const token = merged || tokens[i]
      // バージョン番号/括弧補足は直前の技術名へ結合
      if (!merged && out.length && isVersionLike(token)) {
        out[out.length - 1] = `${out[out.length - 1]} ${token}`
      } else {
        out.push(token)
      }
      i += len
    }
  }
  return out.map((t) => t.trim()).filter(Boolean).filter((t, idx, arr) => arr.indexOf(t) === idx)
}
