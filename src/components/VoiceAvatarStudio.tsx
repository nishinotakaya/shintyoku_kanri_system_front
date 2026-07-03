import { useRef, useState } from 'react'
import { api } from '../lib/api'

// 勤怠アプリ内で「自分の声(クローン)」と「自分の顔(アバター)」を作るスタジオ。
// 声: ブラウザ録音 or 音声ファイル → HeyGen voice clone
// 顔: カメラ撮影 or 画像ファイル → HeyGen talking photo

export type HeygenAsset = { id: number; kind: 'voice' | 'photo_avatar'; ref_id: string; name: string; status: string; preview_url?: string | null }
type Subtitle = { text: string; emphasis?: string | null; start?: number; end?: number }
type Vid = { id: number; title: string; script: string; script_kana?: string | null; status: string; video_url?: string | null; voice_id?: string | null; talking_photo_id?: string | null; subtitles?: Subtitle[] }

// 約2分(650〜850字)の声クローン用テンプレ。数字・金額・英語・疑問・感嘆・間・短長文を含み抑揚を学習させる。
// HeyGen公式推奨(最低30秒/精度重視90〜120秒・会話のように自然に)に準拠。本番の喋り方でハキハキ読む。
const VOICE_TEMPLATE =
  'こんにちは。今日は、エンジニア目線で「AIツールを仕事に入れるとき、どこから始めるべきか」について話します。\n\n' +
  '結論から言うと、いきなり全部を自動化しようとしないことです。まずは、毎日10分かかっている作業を、3分に縮める。ここを狙うのが一番現実的です。\n\n' +
  'たとえば、議事録の整理、コードレビュー前のチェック、GitHubのIssue作成、API仕様のたたき台。このあたりは、かなり相性がいいです。逆に、売上に直結する判断や、セキュリティまわりを丸投げするのは、まだ怖いですね。\n\n' +
  '「じゃあ、具体的に何を見ればいいの？」という話なんですが、僕は3つ見ます。1つ目は、失敗したときに戻せるか。2つ目は、月額1,980円でも元が取れるか。3つ目は、チームの人が普通に使い続けられるか。この3つです。\n\n' +
  'ここ、けっこう大事です！AIって、デモを見るとすごく見えるんですけど、実務に入れると、プロンプトの書き方、権限管理、レビューの流れで、意外と詰まります。なので最初は、小さく試して、ログを残して、うまくいった部分だけ広げる。これで十分です。\n\n' +
  '僕ならまず、1週間だけ試します。月曜に作業を1つ決めて、水曜に一回見直して、金曜に「何分減ったか」を数字で確認する。もし30分以上減っていたら継続。減っていなければ、やめる。シンプルですよね。\n\n' +
  '最後にもう一つ。AIを使う目的は、人を減らすことではなくて、人が考える時間を増やすことです。面倒な下準備を減らして、設計、検証、ユーザー理解に時間を使う。そのほうが、プロダクトはちゃんと良くなります。\n\n' +
  'ということで、まずは明日、自分の作業をひとつだけ選んでみてください。小さく試す。数字で見る。よければ続ける。これが、現場で一番強いAI活用です。'

export default function VoiceAvatarStudio({ userId, onChange }: { userId: number; onChange?: (assets: HeygenAsset[]) => void }) {
  const [assets, setAssets] = useState<HeygenAsset[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [persona, setPersona] = useState('')
  const [personaSaved, setPersonaSaved] = useState(false)
  // 動画を作る
  const [title, setTitle] = useState('')
  const [targetMinutes, setTargetMinutes] = useState<'5' | '10' | 'random' | 'test' | 'short30' | 'short60'>('test')
  const [genVoiceId, setGenVoiceId] = useState('')
  const [genFaceId, setGenFaceId] = useState('')
  const [script, setScript] = useState('')
  const [scriptKana, setScriptKana] = useState('')
  const [curId, setCurId] = useState<number | null>(null)
  const [genStatus, setGenStatus] = useState<string | null>(null)
  const [genVideoUrl, setGenVideoUrl] = useState<string | null>(null)
  const [genSubs, setGenSubs] = useState<Subtitle[]>([])
  const [savedVideos, setSavedVideos] = useState<Vid[]>([])
  // AI添削モーダル
  type Proof = { issues: string[]; questions: { key: string; question: string; options: string[] }[]; corrected_script: string }
  const [proof, setProof] = useState<Proof | null>(null)
  const [proofAnswers, setProofAnswers] = useState<Record<string, string>>({})
  const [quota, setQuota] = useState<number | null>(null)
  // 保存動画のアコーディオン編集
  const [openVidId, setOpenVidId] = useState<number | null>(null)
  const [vidSubs, setVidSubs] = useState<Subtitle[]>([])
  const [vidUrl, setVidUrl] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e: any) { setErr(e?.response?.data?.error ?? e?.message ?? '失敗しました') } finally { setBusy(null) }
  }

  const load = () => run('load', async () => {
    const r = await api.get<HeygenAsset[]>('/heygen_assets', { params: { user_id: userId } })
    setAssets(r.data); setLoaded(true); onChange?.(r.data)
    // 声/顔の初期選択
    const v0 = r.data.find((a) => a.kind === 'voice'); if (v0) setGenVoiceId(v0.ref_id)
    const f0 = r.data.find((a) => a.kind === 'photo_avatar'); if (f0) setGenFaceId(f0.ref_id)
    try { const me = await api.get('/me'); setPersona(me.data.video_script_context ?? '') } catch { /* noop */ }
    try { const o = await api.get<{ remaining_quota: number | null }>('/interview_videos/options', { params: { user_id: userId } }); setQuota(o.data.remaining_quota) } catch { /* noop */ }
    await loadSaved()
  })

  const loadSaved = async () => {
    try {
      const r = await api.get<Vid[]>('/interview_videos', { params: { user_id: userId } })
      setSavedVideos(r.data)
      // 生成中の動画があれば、リロード後でも自動で完成を拾いに行く
      const proc = r.data.find((v) => v.status === 'processing')
      if (proc && busy !== 'gen') resumePoll(proc.id)
    } catch { /* noop */ }
  }

  // 指定動画の完成をポーリングしてプレビューに出す(リロード復帰用)
  const resumePoll = (id: number) => run('gen', async () => {
    setCurId(id); setGenVideoUrl(null); setGenSubs([]); setGenStatus('生成中…（数分かかります。閉じても裏で進みます）')
    for (let i = 0; i < 120; i++) {
      await new Promise((res) => setTimeout(res, 6000))
      const s = await api.get<Vid>(`/interview_videos/${id}`)
      if (s.data.status === 'completed') { setGenVideoUrl(s.data.video_url ?? null); setGenSubs(s.data.subtitles ?? []); setGenStatus(null); loadSaved(); return }
      if (s.data.status === 'failed') { setGenStatus('生成に失敗しました（残高不足の可能性）'); return }
    }
    setGenStatus('まだ生成中です。少し待って「保存した動画」を確認してください')
  })

  const savePersona = () => run('persona', async () => {
    await api.patch('/me', { user: { video_script_context: persona } })
    setPersonaSaved(true); setTimeout(() => setPersonaSaved(false), 2000)
  })

  // 1回の動画録画から「顔アバター」と「声クローン」を同時に作る
  const fromVideo = (audioBlob: Blob, audioExt: string, frame: File) => run('video', async () => {
    const avatarForm = new FormData(); avatarForm.append('photo', frame); avatarForm.append('user_id', String(userId))
    const a1 = await api.post<HeygenAsset>('/heygen_assets/create_avatar', avatarForm, { headers: { 'Content-Type': 'multipart/form-data' } })
    const voiceForm = new FormData(); voiceForm.append('audio', audioBlob, `voice.${audioExt}`); voiceForm.append('user_id', String(userId))
    const a2 = await api.post<HeygenAsset>('/heygen_assets/clone_voice', voiceForm, { headers: { 'Content-Type': 'multipart/form-data' } })
    const next = [a2.data, a1.data, ...assets]; setAssets(next); onChange?.(next)
  })

  const afterCreate = (a: HeygenAsset) => { const next = [a, ...assets]; setAssets(next); onChange?.(next) }

  const cloneVoice = (blob: Blob, ext: string) => run('voice', async () => {
    const form = new FormData()
    form.append('audio', blob, `voice.${ext}`)
    form.append('user_id', String(userId))
    const r = await api.post<HeygenAsset>('/heygen_assets/clone_voice', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    afterCreate(r.data)
  })

  const createAvatar = (file: File) => run('avatar', async () => {
    const form = new FormData()
    form.append('photo', file)
    form.append('user_id', String(userId))
    const r = await api.post<HeygenAsset>('/heygen_assets/create_avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    afterCreate(r.data)
  })

  const remove = (a: HeygenAsset) => run(`del-${a.id}`, async () => {
    await api.delete(`/heygen_assets/${a.id}`)
    const next = assets.filter((x) => x.id !== a.id); setAssets(next); onChange?.(next)
  })

  // 現在の下書き動画を用意(なければ作成)。声/顔/タイトルを反映。
  const ensureDraft = async (): Promise<number> => {
    if (curId) {
      await api.patch(`/interview_videos/${curId}`, { title: title || 'インタビュー動画', voice_id: genVoiceId, talking_photo_id: genFaceId, avatar_kind: genFaceId ? 'talking_photo' : 'avatar' })
      return curId
    }
    const r = await api.post<Vid>('/interview_videos', { user_id: userId, title: title || 'インタビュー動画', voice_id: genVoiceId, avatar_kind: genFaceId ? 'talking_photo' : 'avatar' })
    if (genFaceId) await api.patch(`/interview_videos/${r.data.id}`, { talking_photo_id: genFaceId })
    setCurId(r.data.id)
    return r.data.id
  }

  // AI台本(テンプレ構成・長さ指定)
  const genScript = () => run('script', async () => {
    const id = await ensureDraft()
    const body: Record<string, unknown> = { topic: title }
    if (targetMinutes === '5' || targetMinutes === '10') body.target_minutes = targetMinutes
    const r = await api.post<Vid>(`/interview_videos/${id}/generate_script`, body)
    setScript(r.data.script); setScriptKana(r.data.script_kana ?? '')
  })

  // 読み調整(mode: optimize=漢字キープ＋誤読語だけ / full=全部ひらがな)
  const genKana = (mode: 'optimize' | 'full') => run(mode === 'full' ? 'kanaFull' : 'kana', async () => {
    if (!curId) return
    await api.patch(`/interview_videos/${curId}`, { script })
    const r = await api.post<Vid>(`/interview_videos/${curId}/generate_kana`, { mode })
    setScriptKana(r.data.script_kana ?? '')
  })

  // 動画を生成(テスト=短文 / 5分 / 10分 / ランダム)
  const generate = () => run('gen', async () => {
    setGenVideoUrl(null); setGenSubs([]); setGenStatus('準備中…')
    const id = await ensureDraft()
    if (targetMinutes === 'test') {
      await api.patch(`/interview_videos/${id}`, { script: 'これは私の声と顔のテストです。きちんと本人の声と顔で自然に喋れているか確認します。' })
    } else {
      await api.patch(`/interview_videos/${id}`, { script, script_kana: scriptKana })
      // 字幕(！→赤強調)を生成。render完了時に尺へ自動割当される
      try { await api.post(`/interview_videos/${id}/generate_subtitles`, {}) } catch { /* 字幕は任意 */ }
    }
    await api.post(`/interview_videos/${id}/render`, {})
    setGenStatus('生成中…（数分かかります）')
    for (let i = 0; i < 120; i++) {
      await new Promise((res) => setTimeout(res, 6000))
      const s = await api.get<Vid>(`/interview_videos/${id}`)
      if (s.data.status === 'completed') { setGenVideoUrl(s.data.video_url ?? null); setGenSubs(s.data.subtitles ?? []); setGenStatus(null); loadSaved(); return }
      if (s.data.status === 'failed') { setGenStatus('生成に失敗しました（残高不足の可能性）'); return }
    }
    setGenStatus('タイムアウトしました')
  })

  const saveSubs = () => run('savesubs', async () => {
    if (!curId) return
    await api.patch(`/interview_videos/${curId}`, { subtitles: genSubs })
  })
  const editSub = (i: number, patch: Partial<Subtitle>) => setGenSubs((p) => p.map((s, idx) => idx === i ? { ...s, ...patch } : s))

  // AI添削: まず台本を解析して問題点・確認質問を出す
  const openProofread = () => run('proof', async () => {
    const id = await ensureDraft()
    await api.patch(`/interview_videos/${id}`, { script })
    const r = await api.post<Proof>(`/interview_videos/${id}/proofread`, {})
    setProofAnswers({}); setProof(r.data)
  })
  // 質問への回答を確定して最終版を反映
  const applyProofread = () => run('proofApply', async () => {
    if (!curId) return
    const r = await api.post<Proof>(`/interview_videos/${curId}/proofread`, { answers: proofAnswers })
    if (r.data.corrected_script) { setScript(r.data.corrected_script); setScriptKana('') }
    setProof(null)
  })

  const newVideo = () => { setCurId(null); setTitle(''); setScript(''); setScriptKana(''); setGenVideoUrl(null); setGenStatus(null) }

  // 保存動画をアコーディオンで開く→字幕を読み込んで編集
  const toggleVid = (id: number) => {
    if (openVidId === id) { setOpenVidId(null); return }
    setOpenVidId(id)
    run(`openv-${id}`, async () => {
      const r = await api.get<Vid>(`/interview_videos/${id}`)
      setVidSubs(r.data.subtitles ?? []); setVidUrl(r.data.video_url ?? null)
    })
  }
  const editVidSub = (i: number, patch: Partial<Subtitle>) => setVidSubs((p) => p.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const saveVidSubs = (id: number) => run(`savev-${id}`, async () => {
    await api.patch(`/interview_videos/${id}`, { subtitles: vidSubs })
  })

  const removeVideo = (id: number) => run(`delv-${id}`, async () => {
    await api.delete(`/interview_videos/${id}`)
    setSavedVideos((p) => p.filter((v) => v.id !== id))
    if (curId === id) newVideo()
  })

  if (!loaded) {
    return (
      <button onClick={load} disabled={!!busy}
        className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
        {busy === 'load' ? '読込中…' : '🎙 自分の声・顔を作る（スタジオを開く）'}
      </button>
    )
  }

  const voices = assets.filter((a) => a.kind === 'voice')
  const avatars = assets.filter((a) => a.kind === 'photo_avatar')

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text)]">🎙 自分の声・顔スタジオ</span>
        {quota != null && (
          <span className="text-[10px] text-[var(--color-text-sub)]">残高 {quota} credits（5分≈316 / 10分≈633）{quota < 320 && <span className="ml-1 font-semibold text-red-500">⚠ 5分以上は不足ぎみ</span>}</span>
        )}
        <a href="https://app.heygen.com/developers/api" target="_blank" rel="noreferrer" className="text-[10px] text-fuchsia-600 underline">↗ HeyGenでクレジット購入</a>
      </div>
      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

      {/* 0. 15秒ビデオ録画 → 顔と声を一括作成 */}
      <div className="space-y-1 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-2">
        <div className="text-xs font-semibold text-[var(--color-text-sub)]">★ おすすめ：1〜2分の動画を撮ると、顔アバターと声クローンを一度に作成（声は長いほど自然に）</div>
        <VideoRecorder busy={busy === 'video'} onComplete={fromVideo} />
        <details className="text-[11px] text-[var(--color-text-sub)]">
          <summary className="cursor-pointer">📋 読み上げ台本（約2分・抑揚豊か）</summary>
          <p className="mt-1 rounded bg-white p-2 leading-relaxed">{VOICE_TEMPLATE}</p>
        </details>
      </div>

      {/* ペルソナ・事業内容 (AI台本の素材) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[var(--color-text-sub)]">📝 ペルソナ・プロフィール・事業内容（AIが台本を書くときに読む）</label>
          <button onClick={savePersona} disabled={!!busy}
            className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">
            {busy === 'persona' ? '保存中…' : personaSaved ? '✅ 保存済み' : '保存'}
          </button>
        </div>
        <textarea value={persona} onChange={(e) => setPersona(e.target.value)} rows={4}
          placeholder="例) Fラン大卒・元介護士(月収13万)→未経験からエンジニアに転身し月収70万。プロアカ(プログラミング副業アカデミー)を運営。受講生は…。動画では未経験者の不安に寄り添い、再現性のある手順を語る。"
          className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 声 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--color-text-sub)]">① 自分の声を作る（録音 1〜2分推奨）</div>
          <VoiceRecorder busy={busy === 'voice'} onRecorded={cloneVoice} />
          <details className="text-[11px] text-[var(--color-text-sub)]">
            <summary className="cursor-pointer">📋 読み上げ台本（タップで表示）</summary>
            <p className="mt-1 rounded bg-gray-50 p-2 leading-relaxed">{VOICE_TEMPLATE}</p>
          </details>
          <div className="space-y-1">
            {voices.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs">
                <span>🎙 {a.name}</span>
                <button onClick={() => remove(a)} disabled={!!busy} className="text-gray-400 hover:text-red-500">🗑</button>
              </div>
            ))}
            {voices.length === 0 && <div className="text-[11px] text-[var(--color-text-sub)]">まだ声がありません</div>}
          </div>
        </div>

        {/* 顔 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--color-text-sub)]">② 自分の顔アバターを作る（撮影 or 画像）</div>
          <PhotoCapture busy={busy === 'avatar'} onCaptured={createAvatar} />
          <div className="space-y-1">
            {avatars.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-[var(--color-border)] px-2 py-1 text-xs">
                <span className="flex items-center gap-1">
                  {a.preview_url && <img src={a.preview_url} alt="" className="h-6 w-6 rounded-full object-cover" />}
                  🧑 {a.name}
                </span>
                <button onClick={() => remove(a)} disabled={!!busy} className="text-gray-400 hover:text-red-500">🗑</button>
              </div>
            ))}
            {avatars.length === 0 && <div className="text-[11px] text-[var(--color-text-sub)]">まだ顔がありません</div>}
          </div>
        </div>
      </div>
      {/* ③ 動画を作る */}
      <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--color-text-sub)]">③ 動画を作る</div>
          {curId && <button onClick={newVideo} className="text-[10px] text-[var(--color-text-sub)] underline">＋ 新しい動画</button>}
        </div>
        {/* テーマ/タイトル */}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="動画タイトル/テーマ（例: 未経験から最短でエンジニア転職する方法）"
          className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
        {/* 声・顔・長さ */}
        <div className="flex flex-wrap items-center gap-1">
          <select value={genVoiceId} onChange={(e) => setGenVoiceId(e.target.value)} className="rounded border border-[var(--color-border)] px-1.5 py-1 text-[11px]">
            <option value="">声を選択</option>
            {voices.map((a) => <option key={a.id} value={a.ref_id}>🎙 {a.name}</option>)}
          </select>
          <select value={genFaceId} onChange={(e) => setGenFaceId(e.target.value)} className="rounded border border-[var(--color-border)] px-1.5 py-1 text-[11px]">
            <option value="">顔を選択</option>
            {avatars.map((a) => <option key={a.id} value={a.ref_id}>🧑 {a.name}</option>)}
          </select>
          <select value={targetMinutes} onChange={(e) => setTargetMinutes(e.target.value as typeof targetMinutes)} title="長さ" className="rounded border border-[var(--color-border)] px-1.5 py-1 text-[11px]">
            <option value="test">テスト(約10秒)</option>
            <option value="random">本番:ランダム(5/10分)</option>
            <option value="5">本番:5分</option>
            <option value="10">本番:10分</option>
          </select>
        </div>
        {/* AI台本(テスト以外) */}
        {targetMinutes !== 'test' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--color-text-sub)]">台本（テンプレ構成）</span>
              <div className="flex gap-1">
                <button onClick={genScript} disabled={!!busy || !title.trim()} className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">{busy === 'script' ? '生成中…' : '🤖 AI台本'}</button>
                <button onClick={openProofread} disabled={!!busy || !script.trim()} className="rounded border border-indigo-300 px-2 py-0.5 text-[10px] text-indigo-600 disabled:opacity-50">{busy === 'proof' ? '添削中…' : '✍️ AI添削'}</button>
                <button onClick={() => genKana('optimize')} disabled={!!busy || !script.trim()} title="漢字を残し誤読語だけ仮名（抑揚自然）" className="rounded border border-fuchsia-300 px-2 py-0.5 text-[10px] text-fuchsia-600 disabled:opacity-50">{busy === 'kana' ? '調整中…' : '読み調整'}</button>
                <button onClick={() => genKana('full')} disabled={!!busy || !script.trim()} title="全部ひらがな（誤読ゼロ優先）" className="rounded border border-amber-300 px-2 py-0.5 text-[10px] text-amber-600 disabled:opacity-50">{busy === 'kanaFull' ? '変換中…' : '全ひらがな'}</button>
              </div>
            </div>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} placeholder="タイトルを入れて「AI台本」。ペルソナとテンプレ構成で生成します。"
              className="w-full rounded border border-[var(--color-border)] px-2 py-1.5 text-xs" />
            {scriptKana && (
              <textarea value={scriptKana} onChange={(e) => setScriptKana(e.target.value)} rows={3}
                className="w-full rounded border border-amber-200 bg-amber-50/40 px-2 py-1.5 text-[11px]" />
            )}
          </div>
        )}
        <button onClick={generate} disabled={!!busy || !genVoiceId || (targetMinutes !== 'test' && !script.trim())}
          className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50">
          {busy === 'gen' ? '生成中…' : targetMinutes === 'test' ? '▶ テスト生成（約10秒）' : '🎬 動画を生成'}
        </button>
        {genStatus && <span className="ml-2 text-[10px] text-[var(--color-text-sub)]">{genStatus}</span>}
        {genVideoUrl && <SubtitledVideo src={genVideoUrl} subtitles={genSubs} />}
        {genSubs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--color-text-sub)]">字幕（青=通常 / 赤=強調。編集できます）</span>
              <button onClick={saveSubs} disabled={!!busy} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">{busy === 'savesubs' ? '保存中…' : '字幕を保存'}</button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {genSubs.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-1">
                  <input value={s.text} onChange={(e) => editSub(i, { text: e.target.value })} className="min-w-[140px] flex-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs" />
                  <input value={s.emphasis ?? ''} onChange={(e) => editSub(i, { emphasis: e.target.value })} placeholder="強調(赤)" className="w-24 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px]" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 保存した動画（アプリ内で再生） */}
      <div className="space-y-1">
        <div className="text-xs font-semibold text-[var(--color-text-sub)]">📁 保存した動画</div>
        {savedVideos.filter((v) => v.status === 'completed' && v.video_url).length === 0 && (
          <div className="text-[11px] text-[var(--color-text-sub)]">まだ完成した動画がありません</div>
        )}
        <div className="space-y-1">
          {savedVideos.filter((v) => v.status === 'completed' && v.video_url).map((v) => (
            <div key={v.id} className="rounded border border-[var(--color-border)]">
              {/* ヘッダ: クリックでアコーディオン開閉 */}
              <div className="flex items-center justify-between px-2 py-1.5">
                <button onClick={() => toggleVid(v.id)} className="flex flex-1 items-center gap-2 text-left">
                  <span className="text-[10px] text-[var(--color-text-sub)]">{openVidId === v.id ? '▼' : '▶'}</span>
                  {/* YouTube風の動く小さいプレビュー(ミュート・ループ自動再生) */}
                  <video src={v.video_url ?? ''} muted loop playsInline autoPlay preload="metadata"
                    className="h-9 w-16 shrink-0 rounded bg-black object-cover" />
                  <span className="truncate text-xs font-semibold">{v.title}</span>
                </button>
                <button onClick={() => removeVideo(v.id)} disabled={!!busy} className="ml-2 text-gray-400 hover:text-red-500">🗑</button>
              </div>
              {/* 本体: 動画プレビュー + 字幕編集 */}
              {openVidId === v.id && (
                <div className="space-y-2 border-t border-[var(--color-border)] p-2">
                  {busy === `openv-${v.id}` ? <div className="text-[11px] text-[var(--color-text-sub)]">読込中…</div> : (
                    <>
                      <SubtitledVideo src={vidUrl ?? v.video_url ?? ''} subtitles={vidSubs} />
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[var(--color-text-sub)]">字幕（青=通常 / 赤=強調）</span>
                        <button onClick={() => saveVidSubs(v.id)} disabled={!!busy} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">{busy === `savev-${v.id}` ? '保存中…' : '字幕を保存'}</button>
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto">
                        {vidSubs.map((s, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-1">
                            <span className="w-10 shrink-0 text-[10px] text-[var(--color-text-sub)]">{s.start != null ? `${s.start}s` : i + 1}</span>
                            <input value={s.text} onChange={(e) => editVidSub(i, { text: e.target.value })} className="min-w-[140px] flex-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs" />
                            <input value={s.emphasis ?? ''} onChange={(e) => editVidSub(i, { emphasis: e.target.value })} placeholder="強調(赤)" className="w-24 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px]" />
                          </div>
                        ))}
                        {vidSubs.length === 0 && <div className="text-[11px] text-[var(--color-text-sub)]">字幕はありません</div>}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-sub)]">✂️ 動画のカット（トリミング）は近日対応予定（ffmpeg処理を追加中）</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-[var(--color-text-sub)]">HeyGen が裏で処理します（外部サイトへのログイン不要）。生成にはクレジットを消費します（5分≈316 / 10分≈633）。</div>

      {/* AI添削モーダル */}
      {proof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setProof(null)}>
          <div className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-[var(--color-text)]">✍️ AI添削</div>
            {proof.issues?.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-[var(--color-text-sub)]">見つかった点</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[var(--color-text-sub)]">
                  {proof.issues.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {proof.questions?.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-indigo-600">確認させてください（どちらが正しいですか？）</div>
                {proof.questions.map((q) => (
                  <div key={q.key} className="space-y-1 rounded border border-[var(--color-border)] p-2">
                    <div className="text-xs">{q.question}</div>
                    <div className="flex flex-wrap gap-1">
                      {q.options.map((opt) => (
                        <button key={opt} onClick={() => setProofAnswers((p) => ({ ...p, [q.key]: opt }))}
                          className={`rounded px-2 py-1 text-[11px] ${proofAnswers[q.key] === opt ? 'bg-indigo-500 text-white' : 'border border-[var(--color-border)]'}`}>{opt}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-emerald-600">矛盾は見つかりませんでした。添削後の内容を反映できます。</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setProof(null)} className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs">キャンセル</button>
              <button onClick={applyProofread} disabled={!!busy || (proof.questions?.length > 0 && proof.questions.some((q) => !proofAnswers[q.key]))}
                className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {busy === 'proofApply' ? '反映中…' : '添削を台本に反映'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 動画 + 再生位置に同期した字幕オーバーレイ(青字・強調は赤)
function SubtitledVideo({ src, subtitles }: { src: string; subtitles: Subtitle[] }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const cur = subtitles.find((s) => s.start != null && s.end != null && t >= (s.start as number) && t < (s.end as number))
  const renderText = (text: string, emphasis?: string | null) => {
    if (!emphasis || !text.includes(emphasis)) return <span style={{ color: '#3b82f6' }}>{text}</span> // 青
    const [before, after] = text.split(emphasis)
    return <span style={{ color: '#3b82f6' }}>{before}<span style={{ color: '#ef4444' }}>{emphasis}</span>{after}</span> // 強調=赤
  }
  return (
    <div className="relative overflow-hidden rounded bg-black">
      <video ref={ref} src={src} controls playsInline onTimeUpdate={() => setT(ref.current?.currentTime ?? 0)}
        className="mx-auto block w-full" style={{ maxHeight: '50vh' }} />
      {cur && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
          <span className="rounded bg-black/70 px-3 py-1 text-center text-base font-bold sm:text-lg" style={{ textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>
            {renderText(cur.text, cur.emphasis)}
          </span>
        </div>
      )}
    </div>
  )
}

// 15秒ビデオ録画 → 顔フレーム + 音声を取り出して一括作成
function VideoRecorder({ busy, onComplete }: { busy: boolean; onComplete: (audioBlob: Blob, audioExt: string, frame: File) => void }) {
  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRecRef = useRef<MediaRecorder | null>(null)
  const audioChunks = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [result, setResult] = useState<{ videoUrl: string; audioBlob: Blob; audioExt: string; frame: File } | null>(null)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
      streamRef.current = stream
      if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.muted = true; liveRef.current.play() }
      // 音声のみを別レコーダーで録る(声クローン用)
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const arec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: mime })
      audioChunks.current = []
      arec.ondataavailable = (e) => { if (e.data.size) audioChunks.current.push(e.data) }
      arec.start(); audioRecRef.current = arec
      setRecording(true); setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((s) => {
        if (s + 1 >= 150) { stop() } // 最大150秒(声クローンは90〜120秒が精度ベスト)
        return s + 1
      }), 1000)
    } catch { alert('カメラ/マイクにアクセスできませんでした。ブラウザの許可を確認してください。') }
  }

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    const v = liveRef.current
    // 停止前にフレームを1枚キャプチャ(顔アバター用)
    let frame: File | null = null
    if (v && v.videoWidth) {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth; canvas.height = v.videoHeight
      canvas.getContext('2d')?.drawImage(v, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const bin = atob(dataUrl.split(',')[1]); const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      frame = new File([arr], 'face.jpg', { type: 'image/jpeg' })
    }
    const arec = audioRecRef.current
    const mime = arec?.mimeType || 'audio/webm'
    if (arec) {
      arec.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: mime })
        const ext = mime.includes('webm') ? 'webm' : 'mp4'
        const videoUrl = frame ? URL.createObjectURL(audioBlob) : ''
        streamRef.current?.getTracks().forEach((t) => t.stop())
        if (frame) setResult({ videoUrl, audioBlob, audioExt: ext, frame })
      }
      arec.stop()
    }
    setRecording(false)
  }

  return (
    <div className="space-y-1">
      <video ref={liveRef} playsInline muted className={`w-full rounded bg-black ${recording || result ? '' : 'hidden'}`} style={{ maxHeight: '40vh' }} />
      {!recording ? (
        <button onClick={start} disabled={busy}
          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">● 動画を録画（1〜2分）</button>
      ) : (
        <button onClick={stop} className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white">■ 停止（{seconds}秒 / 推奨90〜120秒）</button>
      )}
      {result && (
        <div className="space-y-1">
          <div className="text-[11px] text-emerald-600">録画できました。この内容で顔と声を作ります。</div>
          <audio src={result.videoUrl} controls className="h-8 w-full" />
          <button onClick={() => onComplete(result.audioBlob, result.audioExt, result.frame)} disabled={busy}
            className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy ? '顔と声を作成中…' : '✅ この録画から顔アバターと声を作る'}
          </button>
        </div>
      )}
    </div>
  )
}

// ブラウザ録音 + 音声ファイルアップロード
function VoiceRecorder({ busy, onRecorded }: { busy: boolean; onRecorded: (blob: Blob, ext: string) => void }) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [preview, setPreview] = useState<{ url: string; blob: Blob; ext: string } | null>(null)
  const timerRef = useRef<number | null>(null)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mime })
        const ext = mime.includes('webm') ? 'webm' : 'mp4'
        setPreview({ url: URL.createObjectURL(blob), blob, ext })
      }
      rec.start(); recorderRef.current = rec; setRecording(true); setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch { alert('マイクにアクセスできませんでした。ブラウザのマイク許可を確認してください。') }
  }
  const stop = () => {
    recorderRef.current?.stop(); setRecording(false)
    if (timerRef.current) window.clearInterval(timerRef.current)
  }

  return (
    <div className="space-y-1">
      {!recording ? (
        <button onClick={start} disabled={busy}
          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">● 録音開始</button>
      ) : (
        <button onClick={stop}
          className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white">■ 停止（{seconds}秒）</button>
      )}
      {preview && (
        <div className="space-y-1">
          <audio src={preview.url} controls className="h-8 w-full" />
          <button onClick={() => onRecorded(preview.blob, preview.ext)} disabled={busy}
            className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy ? '声を作成中…' : '✅ この音声で声を作る'}
          </button>
        </div>
      )}
      <label className="block text-[10px] text-[var(--color-text-sub)]">
        または音声ファイル:
        <input type="file" accept="audio/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onRecorded(f, f.name.split('.').pop() || 'mp3') }}
          className="mt-0.5 block w-full text-[10px] file:mr-2 file:rounded file:border-0 file:bg-gray-200 file:px-2 file:py-0.5" />
      </label>
    </div>
  )
}

// カメラ撮影 + 画像ファイルアップロード
function PhotoCapture({ busy, onCaptured }: { busy: boolean; onCaptured: (file: File) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream; setLive(true)
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() } })
    } catch { alert('カメラにアクセスできませんでした。') }
  }
  const snap = () => {
    const v = videoRef.current; if (!v) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      onCaptured(new File([blob], 'face.jpg', { type: 'image/jpeg' }))
      streamRef.current?.getTracks().forEach((t) => t.stop()); setLive(false)
    }, 'image/jpeg', 0.92)
  }

  return (
    <div className="space-y-1">
      {live ? (
        <div className="space-y-1">
          <video ref={videoRef} playsInline muted className="w-full rounded bg-black" />
          <button onClick={snap} disabled={busy} className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy ? '作成中…' : '📸 撮影して顔を作る'}
          </button>
        </div>
      ) : (
        <button onClick={openCamera} disabled={busy}
          className="rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">📷 カメラで撮影</button>
      )}
      <label className="block text-[10px] text-[var(--color-text-sub)]">
        または画像ファイル:
        <input type="file" accept="image/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onCaptured(f) }}
          className="mt-0.5 block w-full text-[10px] file:mr-2 file:rounded file:border-0 file:bg-gray-200 file:px-2 file:py-0.5" />
      </label>
    </div>
  )
}
