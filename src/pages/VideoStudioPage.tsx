import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Me } from '../lib/api'
import VoiceAvatarStudio from '../components/VoiceAvatarStudio'

type Target = { id: number; display_name: string; email: string }

// 「動画スタジオ」専用ページ。サイドバーから直接アクセス。
// 自分の声・顔を作る → AI台本 → 喋るインタビュー動画を生成（マインドマップに紐づかない単体動画）。
export default function VideoStudioPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [userId, setUserId] = useState<number | null>(null)

  useEffect(() => {
    api.get('/me').then((r) => { setMe(r.data as Me); if (!r.data.admin) setUserId(r.data.id) })
    api.get<Target[]>('/skill_sheets/targets').then((r) => {
      setTargets(r.data)
      if (r.data.length) setUserId((prev) => prev ?? r.data[0].id)
    }).catch(() => { /* 対象が取れなくても自分で操作 */ })
  }, [])

  return (
    <div className="space-y-3">
      <div className="glass rounded-2xl shadow-md p-4 space-y-2">
        <div className="text-sm font-semibold text-[var(--color-text)]">🎬 動画スタジオ</div>
        <div className="text-[11px] text-[var(--color-text-sub)]">
          自分の声と顔を登録して、AIが作った台本を「自分」が喋るインタビュー動画を生成します。HeyGen が裏で処理するので、外部サイトへのログインは不要です。
        </div>
        {me?.admin && targets.length > 0 && (
          <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-sm">
            {targets.map((t) => <option key={t.id} value={t.id}>{t.display_name || t.email}</option>)}
          </select>
        )}
      </div>

      {userId != null && (
        <div className="glass rounded-2xl shadow-md p-4">
          <VoiceAvatarStudio userId={userId} />
        </div>
      )}
    </div>
  )
}
