import { useEffect, useState } from 'react'
import { fetchMe } from './auth'
import type { Me } from './api'

// /me を 1 回だけ取得してモジュールキャッシュ。複数コンポーネントから共有する。
let cached: Me | null = null
let inflight: Promise<Me | null> | null = null

export function useMe() {
  const [me, setMe] = useState<Me | null>(cached)
  const [loading, setLoading] = useState(cached === null)

  useEffect(() => {
    if (cached) { setLoading(false); return }
    inflight ||= fetchMe()
    let alive = true
    inflight.then((m) => {
      cached = m
      if (alive) { setMe(m); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  return { me, loading }
}

// ログアウト時などにキャッシュを破棄
export function clearMeCache() {
  cached = null
  inflight = null
}
