import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

// HeyGen で「本人が喋るインタビュー動画」を作るパネル。
// 台本AI生成 → 写真/アバター選択 → 動画生成 → プレビュー(字幕オーバーレイ) → テロップ編集。

export type Subtitle = { text: string; emphasis?: string | null; start?: number; end?: number }
export type InterviewVideo = {
  id: number
  user_id: number
  interview_mindmap_id: number | null
  title: string
  script: string
  script_kana?: string | null
  subtitles: Subtitle[]
  avatar_kind: 'avatar' | 'talking_photo'
  avatar_id: string | null
  talking_photo_id: string | null
  photo_url: string | null
  voice_id: string | null
  status: 'draft' | 'processing' | 'completed' | 'failed'
  video_url: string | null
  duration: number | null
  error: string | null
}
type Avatar = { avatar_id: string; name: string; preview?: string; gender?: string }
type Voice = { voice_id: string; name: string; gender?: string }
type PhotoAvatar = { talking_photo_id: string; name: string; preview?: string | null }

export default function InterviewVideoPanel({ userId, mindmapId, mindmapTitle }: { userId: number; mindmapId: number | null; mindmapTitle?: string }) {
  const [videos, setVideos] = useState<InterviewVideo[]>([])
  const [video, setVideo] = useState<InterviewVideo | null>(null)
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [myPhotoAvatars, setMyPhotoAvatars] = useState<PhotoAvatar[]>([])
  const [quota, setQuota] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [targetMinutes, setTargetMinutes] = useState<'5' | '10' | 'random'>('random') // 動画の長さ(デフォルト=ランダム)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e: any) { setErr(e?.response?.data?.error ?? e?.message ?? '失敗しました') } finally { setBusy(null) }
  }

  // 既存動画一覧を読み込み
  useEffect(() => {
    api.get<InterviewVideo[]>('/interview_videos', { params: { user_id: userId, interview_mindmap_id: mindmapId } })
      .then((r) => { setVideos(r.data); setVideo(r.data[0] ?? null) })
      .catch(() => { /* 権限なし等は無視 */ })
  }, [userId, mindmapId])

  // アバター/ボイス/残高(初回のみ)
  const loadOptions = () => run('options', async () => {
    const r = await api.get<{ remaining_quota: number | null; avatars: Avatar[]; voices: Voice[]; my_photo_avatars: PhotoAvatar[] }>('/interview_videos/options', { params: { user_id: userId } })
    setAvatars(r.data.avatars); setVoices(r.data.voices); setMyPhotoAvatars(r.data.my_photo_avatars ?? []); setQuota(r.data.remaining_quota); setOptionsLoaded(true)
  })

  const createVideo = () => run('create', async () => {
    const r = await api.post<InterviewVideo>('/interview_videos', {
      user_id: userId, interview_mindmap_id: mindmapId, title: mindmapTitle || 'インタビュー動画',
      avatar_kind: 'avatar', avatar_id: avatars[0]?.avatar_id, voice_id: voices[0]?.voice_id,
    })
    setVideos((p) => [r.data, ...p]); setVideo(r.data)
  })

  const patchVideo = (patch: Partial<InterviewVideo>) => run('patch', async () => {
    if (!video) return
    const r = await api.patch<InterviewVideo>(`/interview_videos/${video.id}`, patch)
    setVideo(r.data); setVideos((p) => p.map((v) => v.id === r.data.id ? r.data : v))
  })

  const genScript = () => run('script', async () => {
    if (!video) return
    const body: Record<string, unknown> = { topic: video.title || mindmapTitle }
    if (targetMinutes !== 'random') body.target_minutes = targetMinutes
    const r = await api.post<InterviewVideo>(`/interview_videos/${video.id}/generate_script`, body)
    setVideo(r.data)
  })

  const genKana = () => run('kana', async () => {
    if (!video) return
    const r = await api.post<InterviewVideo>(`/interview_videos/${video.id}/generate_kana`, {})
    setVideo(r.data)
  })

  const genSubtitles = () => run('subs', async () => {
    if (!video) return
    const r = await api.post<InterviewVideo>(`/interview_videos/${video.id}/generate_subtitles`, {})
    setVideo(r.data)
  })

  const uploadPhoto = (file: File) => run('photo', async () => {
    if (!video) return
    const form = new FormData(); form.append('photo', file)
    const r = await api.post<InterviewVideo>(`/interview_videos/${video.id}/photo`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    setVideo(r.data)
  })

  const renderVideo = () => run('render', async () => {
    if (!video) return
    const r = await api.post<InterviewVideo>(`/interview_videos/${video.id}/render`, {})
    setVideo(r.data)
  })

  const deleteVideo = () => run('delete', async () => {
    if (!video) return
    await api.delete(`/interview_videos/${video.id}`)
    const rest = videos.filter((v) => v.id !== video.id)
    setVideos(rest); setVideo(rest[0] ?? null)
  })

  // 生成中はポーリングして完成を取りに行く
  useEffect(() => {
    if (video?.status !== 'processing') return
    const timer = setInterval(async () => {
      try {
        const r = await api.get<InterviewVideo>(`/interview_videos/${video.id}`)
        setVideo(r.data)
        if (r.data.status !== 'processing') { setVideos((p) => p.map((v) => v.id === r.data.id ? r.data : v)) }
      } catch { /* 一時的なエラーは無視して次のtickで再取得 */ }
    }, 6000)
    return () => clearInterval(timer)
  }, [video?.status, video?.id])

  const editSubtitle = (idx: number, patch: Partial<Subtitle>) => {
    if (!video) return
    const next = video.subtitles.map((s, i) => i === idx ? { ...s, ...patch } : s)
    setVideo({ ...video, subtitles: next })
  }
  const saveSubtitles = () => patchVideo({ subtitles: video?.subtitles })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text)]">🎥 喋るインタビュー動画</span>
        {quota != null && (
          <span className="text-[10px] text-[var(--color-text-sub)]">
            残高 {quota} credits（5分≈316 / 10分≈633）
            {quota < 320 && <span className="ml-1 font-semibold text-red-500">⚠ 5分以上は不足ぎみ</span>}
          </span>
        )}
        <a href="https://app.heygen.com/developers/api" target="_blank" rel="noreferrer"
          className="text-[10px] text-fuchsia-600 underline">↗ HeyGenでキー取得・クレジット購入</a>
        {!optionsLoaded && (
          <button onClick={loadOptions} disabled={!!busy}
            className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-50">
            {busy === 'options' ? '読込中…' : 'アバター/ボイスを読み込む'}
          </button>
        )}
      </div>

      {optionsLoaded && (
        <div className="flex flex-wrap items-center gap-2">
          {videos.length > 0 && (
            <select value={video?.id ?? ''} onChange={(e) => setVideo(videos.find((v) => v.id === Number(e.target.value)) ?? null)}
              className="max-w-[240px] rounded-md border border-[var(--color-border)] px-2 py-1 text-xs">
              {videos.map((v) => <option key={v.id} value={v.id}>{v.title}（{statusLabel(v.status)}）</option>)}
            </select>
          )}
          <button onClick={createVideo} disabled={!!busy}
            className="rounded-lg bg-gradient-to-r from-red-500 to-rose-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
            {busy === 'create' ? '作成中…' : '＋ 新しい動画'}
          </button>
          {video && (
            <button onClick={deleteVideo} disabled={!!busy} title="この動画を削除"
              className="rounded-lg border border-red-300 px-2 py-1.5 text-xs text-red-500 disabled:opacity-50">🗑</button>
          )}
        </div>
      )}

      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

      {video && (
        <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-3">
          {/* タイトル/テーマ */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--color-text-sub)]">動画タイトル / テーマ</label>
            <input value={video.title} onChange={(e) => setVideo({ ...video, title: e.target.value })} onBlur={() => patchVideo({ title: video.title })}
              placeholder="例) 未経験から最短でエンジニア転職する方法"
              className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
          </div>
          {/* 台本 */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <label className="text-xs font-semibold text-[var(--color-text-sub)]">台本（喋る内容・テンプレ構成）</label>
              <div className="flex items-center gap-1">
                <select value={targetMinutes} onChange={(e) => setTargetMinutes(e.target.value as '5' | '10' | 'random')}
                  title="動画の長さ" className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]">
                  <option value="random">長さ:ランダム</option>
                  <option value="5">5分</option>
                  <option value="10">10分</option>
                </select>
                <button onClick={genScript} disabled={!!busy || !video.title?.trim()}
                  className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">
                  {busy === 'script' ? 'AI生成中…' : '🤖 タイトルから台本を書く'}
                </button>
              </div>
            </div>
            <textarea value={video.script} rows={4} onChange={(e) => setVideo({ ...video, script: e.target.value })} onBlur={() => patchVideo({ script: video.script })}
              placeholder="アバターに喋らせる内容。AIで自動生成もできます。"
              className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
          </div>

          {/* 読み仮名(読み上げ用) — TTSの誤読を防ぐ。生成すると読み上げはこちらを使う */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--color-text-sub)]">読み調整（誤読対策・任意）</label>
              <button onClick={genKana} disabled={!!busy || !video.script?.trim()}
                className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">
                {busy === 'kana' ? '調整中…' : '🤖 読みを調整'}
              </button>
            </div>
            <textarea value={video.script_kana ?? ''} rows={3} onChange={(e) => setVideo({ ...video, script_kana: e.target.value })} onBlur={() => patchVideo({ script_kana: video.script_kana })}
              placeholder="漢字は残したまま、誤読しやすい語（名前・数字・難読語）だけ読みを直した版。生成すると読み上げはこちらを使います（抑揚は自然なまま・字幕は上の台本）。"
              className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
          </div>

          {/* アバター / 写真 + ボイス */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[var(--color-text-sub)]">登場人物</label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px]">
                  <input type="radio" checked={video.avatar_kind === 'avatar'} onChange={() => patchVideo({ avatar_kind: 'avatar' })} />アバター
                </label>
                <label className="flex items-center gap-1 text-[11px]">
                  <input type="radio" checked={video.avatar_kind === 'talking_photo'} onChange={() => patchVideo({ avatar_kind: 'talking_photo' })} />自分の写真
                </label>
              </div>
              {video.avatar_kind === 'avatar' ? (
                <select value={video.avatar_id ?? ''} onChange={(e) => patchVideo({ avatar_id: e.target.value })}
                  className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs">
                  {avatars.map((a) => <option key={a.avatar_id} value={a.avatar_id}>{a.name}</option>)}
                </select>
              ) : (
                <div className="space-y-1">
                  {myPhotoAvatars.length > 0 && (
                    <select value={video.talking_photo_id ?? ''} onChange={(e) => patchVideo({ talking_photo_id: e.target.value })}
                      className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs">
                      <option value="">スタジオで作った顔を選択</option>
                      {myPhotoAvatars.map((a) => <option key={a.talking_photo_id} value={a.talking_photo_id}>{a.name}</option>)}
                    </select>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }}
                    className="block w-full text-[11px] file:mr-2 file:rounded file:border-0 file:bg-fuchsia-500 file:px-2 file:py-1 file:text-[10px] file:text-white" />
                  <div className="text-[10px] text-[var(--color-text-sub)]">
                    {busy === 'photo' ? 'アップロード中…' : video.talking_photo_id ? '✅ 顔アバター準備OK' : '上のスタジオで作るか、ここで写真をアップ'}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[var(--color-text-sub)]">声（日本語）</label>
              <select value={video.voice_id ?? ''} onChange={(e) => patchVideo({ voice_id: e.target.value })}
                className="w-full rounded border border-[var(--color-border)] px-2 py-1 text-xs">
                <option value="">選択してください</option>
                {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}（{v.gender}）</option>)}
              </select>
            </div>
          </div>

          {/* 生成ボタン + ステータス */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={renderVideo} disabled={!!busy || video.status === 'processing' || !video.script?.trim() || !video.voice_id}
              className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
              {video.status === 'processing' ? '⏳ 生成中…' : (busy === 'render' ? '依頼中…' : '🎬 動画を生成')}
            </button>
            <span className="text-[11px] text-[var(--color-text-sub)]">状態: {statusLabel(video.status)}</span>
            {video.status === 'failed' && video.error && <span className="text-[11px] text-red-500">{video.error}</span>}
          </div>

          {/* プレビュー(字幕オーバーレイ) */}
          {video.status === 'completed' && video.video_url && (
            <VideoPreview src={video.video_url} subtitles={video.subtitles} />
          )}

          {/* テロップ編集 */}
          {video.subtitles?.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[var(--color-text-sub)]">テロップ（字幕・強調）</label>
                <div className="flex gap-1">
                  <button onClick={genSubtitles} disabled={!!busy}
                    className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">
                    {busy === 'subs' ? 'AI生成中…' : '🤖 AIで作り直す'}
                  </button>
                  <button onClick={saveSubtitles} disabled={!!busy}
                    className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">保存</button>
                </div>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {video.subtitles.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1">
                    <span className="w-10 shrink-0 text-[10px] text-[var(--color-text-sub)]">{s.start != null ? `${s.start}s` : i + 1}</span>
                    <input value={s.text} onChange={(e) => editSubtitle(i, { text: e.target.value })}
                      className="min-w-[140px] flex-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs" />
                    <input value={s.emphasis ?? ''} onChange={(e) => editSubtitle(i, { emphasis: e.target.value })} placeholder="強調語"
                      className="w-24 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px]" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {video.subtitles?.length === 0 && video.script?.trim() && (
            <button onClick={genSubtitles} disabled={!!busy}
              className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">
              {busy === 'subs' ? 'AI生成中…' : '🤖 テロップをAI生成（強調つき）'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function statusLabel(status: string) {
  return { draft: '下書き', processing: '生成中', completed: '完成', failed: '失敗' }[status] ?? status
}

// 動画 + 再生位置に同期したテロップオーバーレイ
function VideoPreview({ src, subtitles }: { src: string; subtitles: Subtitle[] }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const current = subtitles.find((s) => s.start != null && s.end != null && t >= (s.start as number) && t < (s.end as number))
  return (
    <div className="space-y-1">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={ref} src={src} controls playsInline onTimeUpdate={() => setT(ref.current?.currentTime ?? 0)}
          className="mx-auto block max-h-[60vh] w-full" />
        {current && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
            <span className="rounded bg-black/70 px-3 py-1 text-center text-base font-bold text-white sm:text-lg">
              {renderEmphasis(current.text, current.emphasis)}
            </span>
          </div>
        )}
      </div>
      <a href={src} target="_blank" rel="noreferrer" className="text-[11px] text-fuchsia-600 underline">↗ 別タブで開く / ダウンロード</a>
    </div>
  )
}

// 強調語を黄色ハイライトにして表示
function renderEmphasis(text: string, emphasis?: string | null) {
  if (!emphasis || !text.includes(emphasis)) return text
  const [before, after] = text.split(emphasis)
  return <>{before}<span className="text-yellow-300">{emphasis}</span>{after}</>
}
