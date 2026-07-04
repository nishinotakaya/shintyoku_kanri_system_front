import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

// interview-mindmap(YouTubeモード)用サムネ生成スタジオ。
// 背景は gpt-image-1、文字はこのブラウザのCanvasで合成(日本語が崩れない)。
// スタイル選択 / 文言ドラッグ移動 / 保存済みの再編集・変種づくり / Canva仕上げ に対応。

type Props = { mindmapId: number; title: string }

type CopyData = { main_copy: string; highlight_word: string; sub_copy: string }
type Style = { key: string; label: string; template: string }
type TextStyle = {
  font_family: string; main_color: string; highlight_color: string
  stroke_color: string; sub_color: string; sub_bg_color: string
}
type Defaults = {
  background_template: string
  styles: Style[]
  default_style: string
  text_style: TextStyle
  canva: { configured: boolean; connected: boolean }
}
type Thumb = {
  id: number; title: string; source: string; image_url: string; prompt?: string
  copy?: CopyData & { panels?: string[] }; canva_edit_url?: string | null; created_at: string
  has_clean_background?: boolean; clean_background_url?: string | null
}

const W = 1280
const H = 720

export default function ThumbnailStudio({ mindmapId, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgImgRef = useRef<HTMLImageElement | null>(null)
  const autoLoadedRef = useRef(false) // 起動時に最新の保存済みサムネを一度だけ自動復元するためのフラグ

  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [styleKey, setStyleKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [copy, setCopy] = useState<CopyData>({ main_copy: '', highlight_word: '', sub_copy: '' })
  const [mainFont, setMainFont] = useState(72) // 既定を小さめに（自動で幅にも収める）
  const [panelFonts, setPanelFonts] = useState([48, 48, 48]) // 3コマ文字サイズ（左/中/右 別々）
  const [showArrows, setShowArrows] = useState(false) // コマ間の矢印（左→中→右）。既定OFF（必要なときだけONにする）
  const [subFont, setSubFont] = useState(40)
  const [mainPos, setMainPos] = useState({ x: 56, y: 110 })
  const [mainCentered, setMainCentered] = useState(true) // 背景画像が無い時だけ自動で中央寄せ。ドラッグしたら解除して手動配置
  const [subPos, setSubPos] = useState({ x: 56, y: H - 90 })
  const [ts, setTs] = useState<TextStyle | null>(null) // 編集可能な文字色
  const [bgColor, setBgColor] = useState('#000000') // 背景色（画像の1番後ろの下地）。既定=黒
  const [textBgOn, setTextBgOn] = useState(false) // 文字の背景ボックス（メイン/強調/3コマの後ろに塗り）
  const [textBgColor, setTextBgColor] = useState('#000000') // 文字背景ボックスの色
  const [usePanels, setUsePanels] = useState(true) // 3コマ毎に文字を入れる（デフォルトがアニメ3コマなので初期ON）
  const [panelTexts, setPanelTexts] = useState<string[]>(['', '', '']) // 左/中/右
  const [panelPos, setPanelPos] = useState([{ x: W / 6, y: H * 0.13 }, { x: W / 2, y: H * 0.13 }, { x: (W * 5) / 6, y: H * 0.13 }]) // 各コマ文字の中央上位置(ドラッグ可)
  const [hiFont, setHiFont] = useState(56) // 強調ワード（メインとは別の独立フレーズ）の文字サイズ
  const [hiPos, setHiPos] = useState({ x: 56, y: 40 }) // 強調ワードの位置（メインの上・ドラッグ可）
  const [arrowSize, setArrowSize] = useState(72) // コマ間矢印の大きさ
  const [arrowPos, setArrowPos] = useState([{ x: W / 3, y: H * 0.27 }, { x: (W * 2) / 3, y: H * 0.27 }]) // 矢印位置(左→中 / 中→右・ドラッグ可)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Thumb[]>([])
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({})

  // 初期化
  useEffect(() => {
    api.get<Defaults>('/thumbnails/defaults').then((r) => {
      setDefaults(r.data)
      setTs(r.data.text_style)
      const sk = r.data.default_style || r.data.styles?.[0]?.key || ''
      setStyleKey(sk)
      setUsePanels(sk === 'anime_journey')
      const tmpl = r.data.styles?.find((s) => s.key === sk)?.template || r.data.background_template
      setPrompt(buildPrompt(tmpl, title))
    }).catch(() => {})
    autoLoadedRef.current = false // マインドマップ切替時は自動復元をやり直す
    loadThumbs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mindmapId])

  // 起動時：保存済みがあれば最新(thumbs[0]=新しい順)を自動で復元してデフォルト表示にする（黒い初期状態の代わり）
  useEffect(() => {
    if (autoLoadedRef.current || thumbs.length === 0) return
    const latest = thumbs[0]
    // クリーン背景が無い旧データは、背景画像(blob)の準備が整うまで待つ
    if (!latest.has_clean_background && !thumbUrls[latest.id]) return
    autoLoadedRef.current = true
    editThumb(latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, thumbUrls])

  function buildPrompt(template: string, t: string) {
    return template.replace('%{title}', t).replace('%{summary}', '(マインドマップの要点から自動補完)')
  }

  function onChangeStyle(key: string) {
    setStyleKey(key)
    setUsePanels(key === 'anime_journey') // 3コマスタイルなら3コマ毎テキストを自動ON
    const tmpl = defaults?.styles?.find((s) => s.key === key)?.template
    if (tmpl) setPrompt(buildPrompt(tmpl, title))
  }

  function loadThumbs() {
    api.get<Thumb[]>(`/thumbnails?mindmap_id=${mindmapId}`).then((r) => setThumbs(r.data)).catch(() => {})
  }

  // 保存済みサムネ画像を JWT 付きで取得して blob 表示(<img> は認証ヘッダを送れないため)
  useEffect(() => {
    thumbs.forEach((t) => {
      if (thumbUrls[t.id]) return
      api.get(`/thumbnails/${t.id}/image`, { responseType: 'blob' })
        .then((r) => {
          const url = URL.createObjectURL(r.data as Blob)
          setThumbUrls((prev) => ({ ...prev, [t.id]: url }))
        }).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs])

  // 応答の copy を各フィールド（メイン/強調/サブ＋3コマ）に反映する共通処理
  function applyCopy(data: any) {
    setCopy({ main_copy: data.copy.main_copy ?? '', highlight_word: data.copy.highlight_word ?? '', sub_copy: data.copy.sub_copy ?? '' })
    const panels = data.copy.panels as string[] | undefined
    if (panels && panels.some((p) => (p ?? '').trim() !== '')) {
      setPanelTexts([panels[0] ?? '', panels[1] ?? '', panels[2] ?? ''])
      setUsePanels(true) // 3コマ欄を必ず表示して反映を見えるように
    }
    if (data.background_prompt) setPrompt(data.background_prompt)
  }

  // ---- 文言を自動生成（新規） ----
  async function genCopy() {
    setBusy('copy'); setErr(null)
    try {
      const r = await api.post('/thumbnails/copy', { mindmap_id: mindmapId, style: styleKey })
      applyCopy(r.data)
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'コピー生成に失敗しました')
    } finally { setBusy(null) }
  }

  // ---- AI添削（現在の文言の誤字脱字・表記ゆれだけを直す。文言・意図・長さは変えない） ----
  async function proofreadCopy() {
    setBusy('proof'); setErr(null)
    try {
      const r = await api.post('/thumbnails/copy', {
        mindmap_id: mindmapId, style: styleKey, proofread: true,
        current: { main_copy: copy.main_copy, highlight_word: copy.highlight_word, sub_copy: copy.sub_copy, panels: panelTexts },
      })
      applyCopy(r.data)
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'AI添削に失敗しました')
    } finally { setBusy(null) }
  }

  // ---- 背景を生成して Canvas に描画 ----
  async function genBackground() {
    setBusy('bg'); setErr(null)
    try {
      const r = await api.post('/thumbnails/background', { mindmap_id: mindmapId, prompt, style: styleKey })
      await loadBackground(r.data.image_base64)
    } catch (e: any) {
      setErr(e?.response?.data?.error || '背景生成に失敗しました')
    } finally { setBusy(null) }
  }

  // ---- 一括: 背景を生成 → そのあと文言を自動生成（背景の後に文字を入れる） ----
  async function genAll() {
    await genBackground()
    await genCopy()
  }

  function loadBackground(src: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { bgImgRef.current = img; draw(); resolve() }
      img.onerror = () => resolve()
      img.src = src
    })
  }

  // 文字を「(任意で背景ボックス)＋黒フチ＋影＋指定色」で1行描く共通ヘルパ（左/中央寄せ対応）
  function drawStrokedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, bg?: string) {
    if (bg && text) {
      const w = ctx.measureText(text).width
      const padX = size * 0.28, padY = size * 0.16
      const bx = ctx.textAlign === 'center' ? x - w / 2 - padX : x - padX
      const r = Math.min(18, size * 0.2)
      ctx.save()
      ctx.shadowColor = 'transparent'; ctx.fillStyle = bg
      ctx.beginPath()
      // 角丸長方形（roundRect 非対応環境でも動くよう手書き）
      const bw = w + padX * 2, bh = size * 1.15 + padY, by = y - padY * 0.5
      ctx.moveTo(bx + r, by)
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
      ctx.arcTo(bx, by + bh, bx, by, r)
      ctx.arcTo(bx, by, bx + bw, by, r)
      ctx.closePath(); ctx.fill()
      ctx.restore()
    }
    ctx.lineWidth = Math.max(6, size * 0.16)
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4
    ctx.strokeStyle = ts?.stroke_color || '#111'; ctx.strokeText(text, x, y)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = fill; ctx.fillText(text, x, y)
  }

  // ---- Canvas 描画 ----
  // z順(背面→前面): 背景 → 矢印 → 3コマ文字 → サブ帯 → 強調ワード → メイン(最前面=絶対に隠れない)
  function draw() {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    // 背景色を下地に敷く（画像が無い/消した時はこの色が背景になる）
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H)
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, W, H)

    const font = ts?.font_family || "'Noto Sans JP', sans-serif"
    ctx.lineJoin = 'round'

    // ① コマ間の矢印（最背面の装飾。ドラッグ可・サイズ可変）
    if (usePanels && showArrows) {
      arrowPos.forEach((p) => drawArrow(ctx, p.x, p.y, arrowSize, ts?.highlight_color || '#ffe600', ts?.stroke_color || '#111'))
    }

    // ② 3コマ毎の文字（左/中/右・各コマ中央上・サイズ別々・ドラッグ可）
    if (usePanels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      panelTexts.forEach((t, i) => {
        if (!t.trim()) return
        const psize = panelFonts[i]
        ctx.font = `900 ${psize}px ${font}`
        const cx = panelPos[i].x
        t.split('\n').forEach((ln, li) => drawStrokedText(ctx, ln, cx, panelPos[i].y + li * (psize * 1.12), psize, ts?.main_color || '#fff', textBgOn ? textBgColor : undefined))
      })
      ctx.textAlign = 'start'
    }

    // ③ サブコピー(帯つき・複数行対応)
    if (copy.sub_copy.trim()) {
      ctx.font = `700 ${subFont}px ${font}`
      const slines = copy.sub_copy.split('\n')
      const tw = Math.max(1, ...slines.map((l) => ctx.measureText(l).width))
      const padX = 20, padY = 12, slineH = subFont + 8
      const barH = slines.length * slineH + padY * 2
      ctx.fillStyle = ts?.sub_bg_color || '#e60012'
      ctx.fillRect(subPos.x - 4, subPos.y, tw + padX * 2, barH)
      ctx.fillStyle = ts?.sub_color || '#fff'
      ctx.textBaseline = 'top'
      slines.forEach((l, i) => ctx.fillText(l, subPos.x - 4 + padX, subPos.y + padY + i * slineH))
    }

    // ④ 強調ワード（メインとは別の独立フレーズ。強調色・改行可・ドラッグ可）
    if (copy.highlight_word.trim()) {
      ctx.textAlign = 'start'; ctx.textBaseline = 'top'
      ctx.font = `900 ${hiFont}px ${font}`
      copy.highlight_word.split('\n').forEach((ln, li) =>
        drawStrokedText(ctx, ln, hiPos.x, hiPos.y + li * (hiFont * 1.15), hiFont, ts?.highlight_color || '#ffe600', textBgOn ? textBgColor : undefined))
    }

    // ⑤ メインコピー（最前面＝絶対に隠れない・複数行・幅に自動フィット）
    const lines = (copy.main_copy || '').split('\n')
    ctx.textAlign = 'start'; ctx.textBaseline = 'top'
    ctx.font = `900 ${mainFont}px ${font}`
    const rawMax = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
    const effMain = rawMax > W * 0.92 ? Math.floor(mainFont * (W * 0.92) / rawMax) : mainFont
    ctx.font = `900 ${effMain}px ${font}`
    const lineH = effMain * 1.15
    // 背景画像が無い（色のみ）かつ未ドラッグ時だけ中央に自動配置（寂しくならないように）。
    // 一度ドラッグしたら mainCentered=false になり mainPos を尊重する（＝メインも動かせる）。
    const auto = !bgImgRef.current && mainCentered
    const startY = auto ? Math.max(40, (H - lines.length * lineH) / 2 - 30) : mainPos.y
    lines.forEach((line, i) => {
      if (!line) return
      const y = startY + i * lineH
      const x = auto ? Math.max(20, (W - ctx.measureText(line).width) / 2) : mainPos.x
      drawStrokedText(ctx, line, x, y, effMain, ts?.main_color || '#fff', textBgOn ? textBgColor : undefined)
    })
  }

  // コマ間の右向き矢印
  function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, fill: string, stroke: string) {
    const w = size, h = size * 0.72
    ctx.save()
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(4, size * 0.1)
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, cy - h * 0.2)
    ctx.lineTo(cx + w * 0.08, cy - h * 0.2)
    ctx.lineTo(cx + w * 0.08, cy - h * 0.5)
    ctx.lineTo(cx + w / 2, cy)
    ctx.lineTo(cx + w * 0.08, cy + h * 0.5)
    ctx.lineTo(cx + w * 0.08, cy + h * 0.2)
    ctx.lineTo(cx - w / 2, cy + h * 0.2)
    ctx.closePath()
    ctx.strokeStyle = stroke; ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = fill; ctx.fill()
    ctx.restore()
  }

  useEffect(() => { draw() }, [copy, mainFont, subFont, mainPos, mainCentered, subPos, ts, bgColor, textBgOn, textBgColor, panelTexts, panelFonts, showArrows, usePanels, panelPos, hiFont, hiPos, arrowSize, arrowPos]) // eslint-disable-line

  // ---- ドラッグ移動(メイン/サブを掴んだ方を動かす) ----
  const dragRef = useRef<{ target: string; dx: number; dy: number } | null>(null)
  function canvasXY(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scale = W / rect.width
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
  }
  // メインコピーの現在の描画範囲（自動中央 or mainPos）を返す
  function mainBounds() {
    if (!copy.main_copy.trim()) return null
    const ctx = canvasRef.current!.getContext('2d')!
    const ff = ts?.font_family || "'Noto Sans JP', sans-serif"
    const lines = copy.main_copy.split('\n')
    ctx.font = `900 ${mainFont}px ${ff}`
    const rawMax = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
    const effMain = rawMax > W * 0.92 ? Math.floor(mainFont * (W * 0.92) / rawMax) : mainFont
    ctx.font = `900 ${effMain}px ${ff}`
    const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
    const lineH = effMain * 1.15
    const auto = !bgImgRef.current && mainCentered
    const top = auto ? Math.max(40, (H - lines.length * lineH) / 2 - 30) : mainPos.y
    const left = auto ? Math.max(20, (W - widest) / 2) : mainPos.x
    return { left, top, w: widest, h: lines.length * lineH }
  }
  // メインのドラッグ開始（自動中央なら現在位置を mainPos に確定して手動配置へ＝ジャンプ防止）
  function startMainDrag(x: number, y: number) {
    const mb = (!bgImgRef.current && mainCentered) ? mainBounds() : null
    if (mb) {
      setMainCentered(false); setMainPos({ x: mb.left, y: mb.top })
      dragRef.current = { target: 'main', dx: x - mb.left, dy: y - mb.top }
    } else {
      dragRef.current = { target: 'main', dx: x - mainPos.x, dy: y - mainPos.y }
    }
  }
  function onDown(e: React.MouseEvent) {
    const { x, y } = canvasXY(e.clientX, e.clientY)
    const ctx = canvasRef.current!.getContext('2d')!
    const font = ts?.font_family || "'Noto Sans JP', sans-serif"
    setSelected(hitTest(x, y)) // クリックで選択（枠＋リサイズハンドル表示。空白クリックで解除）
    // メイン文字の上を最優先で掴めるように（最前面なので直感的）
    const mb = mainBounds()
    if (mb && x >= mb.left - 16 && x <= mb.left + mb.w + 16 && y >= mb.top - 12 && y <= mb.top + mb.h + 12) {
      startMainDrag(x, y); return
    }
    // 3コマ文字の当たり判定（メインと同じようにドラッグ移動）
    if (usePanels) {
      for (let i = 0; i < 3; i++) {
        const t = panelTexts[i]
        if (!t.trim()) continue
        ctx.font = `900 ${panelFonts[i]}px ${font}`
        const lines = t.split('\n')
        const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
        const h = lines.length * panelFonts[i] * 1.12
        const cx = panelPos[i].x, py = panelPos[i].y
        if (x >= cx - w / 2 - 20 && x <= cx + w / 2 + 20 && y >= py - 12 && y <= py + h + 12) {
          dragRef.current = { target: `panel${i}`, dx: x - cx, dy: y - py }
          return
        }
      }
      // 矢印の当たり判定（左→中 / 中→右）
      if (showArrows) {
        for (let i = 0; i < arrowPos.length; i++) {
          const ax = arrowPos[i].x, ay = arrowPos[i].y
          if (x >= ax - arrowSize / 2 - 10 && x <= ax + arrowSize / 2 + 10 && y >= ay - arrowSize * 0.45 - 10 && y <= ay + arrowSize * 0.45 + 10) {
            dragRef.current = { target: `arrow${i}`, dx: x - ax, dy: y - ay }
            return
          }
        }
      }
    }
    // 強調ワード（独立フレーズ）の当たり判定
    if (copy.highlight_word.trim()) {
      ctx.font = `900 ${hiFont}px ${font}`
      const hlines = copy.highlight_word.split('\n')
      const w = Math.max(1, ...hlines.map((l) => ctx.measureText(l).width))
      const h = hlines.length * hiFont * 1.15
      if (x >= hiPos.x - 12 && x <= hiPos.x + w + 12 && y >= hiPos.y - 12 && y <= hiPos.y + h + 12) {
        dragRef.current = { target: 'hi', dx: x - hiPos.x, dy: y - hiPos.y }
        return
      }
    }
    // サブコピー帯の当たり判定(下部・複数行対応)。それ以外はメイン。
    const subH = copy.sub_copy.split('\n').length * (subFont + 8) + 24
    if (copy.sub_copy.trim() && y >= subPos.y - 10 && y <= subPos.y + subH + 10) {
      dragRef.current = { target: 'sub', dx: x - subPos.x, dy: y - subPos.y }
    } else {
      startMainDrag(x, y)
    }
  }
  function onMove(e: React.MouseEvent) {
    if (!dragRef.current) return
    const { x, y } = canvasXY(e.clientX, e.clientY)
    const d = dragRef.current
    if (d.target.startsWith('panel')) {
      const i = Number(d.target.slice(5))
      setPanelPos((p) => p.map((pp, idx) => (idx === i ? { x: x - d.dx, y: y - d.dy } : pp)))
    } else if (d.target.startsWith('arrow')) {
      const i = Number(d.target.slice(5))
      setArrowPos((p) => p.map((pp, idx) => (idx === i ? { x: x - d.dx, y: y - d.dy } : pp)))
    } else if (d.target === 'hi') setHiPos({ x: x - d.dx, y: y - d.dy })
    else if (d.target === 'sub') setSubPos({ x: x - d.dx, y: y - d.dy })
    else setMainPos({ x: x - d.dx, y: y - d.dy })
  }
  function onUp() { dragRef.current = null }

  // ---- どの文字要素の上か判定（ホイール拡縮・ダブルクリック編集で共用。掴み座標は不要） ----
  function hitTest(x: number, y: number): string | null {
    const ctx = canvasRef.current!.getContext('2d')!
    const ff = ts?.font_family || "'Noto Sans JP', sans-serif"
    const mb = mainBounds()
    if (mb && x >= mb.left - 16 && x <= mb.left + mb.w + 16 && y >= mb.top - 12 && y <= mb.top + mb.h + 12) return 'main'
    if (usePanels) {
      for (let i = 0; i < 3; i++) {
        const t = panelTexts[i]; if (!t.trim()) continue
        ctx.font = `900 ${panelFonts[i]}px ${ff}`
        const lines = t.split('\n')
        const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
        const h = lines.length * panelFonts[i] * 1.12
        const cx = panelPos[i].x, py = panelPos[i].y
        if (x >= cx - w / 2 - 20 && x <= cx + w / 2 + 20 && y >= py - 12 && y <= py + h + 12) return `panel${i}`
      }
      if (showArrows) for (let i = 0; i < arrowPos.length; i++) {
        const ax = arrowPos[i].x, ay = arrowPos[i].y
        if (x >= ax - arrowSize / 2 - 10 && x <= ax + arrowSize / 2 + 10 && y >= ay - arrowSize * 0.45 - 10 && y <= ay + arrowSize * 0.45 + 10) return `arrow${i}`
      }
    }
    if (copy.highlight_word.trim()) {
      ctx.font = `900 ${hiFont}px ${ff}`
      const hlines = copy.highlight_word.split('\n')
      const w = Math.max(1, ...hlines.map((l) => ctx.measureText(l).width))
      const h = hlines.length * hiFont * 1.15
      if (x >= hiPos.x - 12 && x <= hiPos.x + w + 12 && y >= hiPos.y - 12 && y <= hiPos.y + h + 12) return 'hi'
    }
    const subH = copy.sub_copy.split('\n').length * (subFont + 8) + 24
    if (copy.sub_copy.trim() && y >= subPos.y - 10 && y <= subPos.y + subH + 10) return 'sub'
    return null
  }

  // ---- ホイールで「全部の文字」を画像上で拡縮（Canva風。要素の上でスクロール） ----
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {})
  wheelHandler.current = (e: WheelEvent) => {
    const { x, y } = canvasXY(e.clientX, e.clientY)
    const t = hitTest(x, y)
    if (!t) return
    e.preventDefault()
    const step = e.deltaY < 0 ? 4 : -4
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v + step))
    if (t === 'main') setMainFont((v) => clamp(v, 28, 220))
    else if (t === 'hi') setHiFont((v) => clamp(v, 20, 200))
    else if (t === 'sub') setSubFont((v) => clamp(v, 18, 120))
    else if (t.startsWith('panel')) { const i = Number(t.slice(5)); setPanelFonts((p) => p.map((vv, idx) => (idx === i ? clamp(vv, 20, 200) : vv))) }
    else if (t.startsWith('arrow')) setArrowSize((v) => clamp(v, 24, 240))
  }
  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const h = (e: WheelEvent) => wheelHandler.current?.(e)
    c.addEventListener('wheel', h, { passive: false })
    return () => c.removeEventListener('wheel', h)
  }, [])

  // ---- 画像内で直接テキスト入力（ダブルクリックでその場編集） ----
  const wrapRef = useRef<HTMLDivElement>(null)
  type Editing = { target: string; left: number; top: number; width: number; fontPx: number; center: boolean }
  const [editing, setEditing] = useState<Editing | null>(null)
  const [selected, setSelected] = useState<string | null>(null) // 選択中の文字要素（枠＋ハンドル表示）

  // 要素のキャンバス座標での外接矩形（選択枠・リサイズハンドルの位置に使う）
  function elementRect(target: string): { left: number; top: number; w: number; h: number } | null {
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return null
    const ff = ts?.font_family || "'Noto Sans JP', sans-serif"
    if (target === 'main') { const b = mainBounds(); return b ? { left: b.left, top: b.top, w: b.w, h: b.h } : null }
    if (target === 'hi') {
      if (!copy.highlight_word.trim()) return null
      ctx.font = `900 ${hiFont}px ${ff}`; const lines = copy.highlight_word.split('\n')
      return { left: hiPos.x, top: hiPos.y, w: Math.max(1, ...lines.map((l) => ctx.measureText(l).width)), h: lines.length * hiFont * 1.15 }
    }
    if (target === 'sub') {
      if (!copy.sub_copy.trim()) return null
      ctx.font = `700 ${subFont}px ${ff}`; const lines = copy.sub_copy.split('\n')
      return { left: subPos.x - 4, top: subPos.y, w: Math.max(1, ...lines.map((l) => ctx.measureText(l).width)) + 40, h: lines.length * (subFont + 8) + 24 }
    }
    if (target.startsWith('panel')) {
      const i = Number(target.slice(5)); if (!panelTexts[i].trim()) return null
      ctx.font = `900 ${panelFonts[i]}px ${ff}`; const lines = panelTexts[i].split('\n')
      const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
      return { left: panelPos[i].x - w / 2, top: panelPos[i].y, w, h: lines.length * panelFonts[i] * 1.12 }
    }
    if (target.startsWith('arrow')) {
      const i = Number(target.slice(5))
      return { left: arrowPos[i].x - arrowSize / 2, top: arrowPos[i].y - arrowSize * 0.36, w: arrowSize, h: arrowSize * 0.72 }
    }
    return null
  }
  function currentFont(target: string): number {
    if (target === 'main') return mainFont
    if (target === 'hi') return hiFont
    if (target === 'sub') return subFont
    if (target.startsWith('panel')) return panelFonts[Number(target.slice(5))]
    if (target.startsWith('arrow')) return arrowSize
    return 48
  }
  function setFontFor(target: string, v: number) {
    if (target === 'main') setMainFont(Math.min(260, Math.max(20, v)))
    else if (target === 'hi') setHiFont(Math.min(240, Math.max(16, v)))
    else if (target === 'sub') setSubFont(Math.min(160, Math.max(14, v)))
    else if (target.startsWith('panel')) { const i = Number(target.slice(5)); setPanelFonts((p) => p.map((vv, idx) => (idx === i ? Math.min(240, Math.max(16, v)) : vv))) }
    else if (target.startsWith('arrow')) setArrowSize(Math.min(260, Math.max(20, v)))
  }
  // 角ハンドルのドラッグ＝アンカー(左上)からの距離比で文字サイズを伸縮（Canva/Slides風）
  function onHandleDown(e: React.MouseEvent, target: string) {
    e.stopPropagation(); e.preventDefault()
    const r = elementRect(target); if (!r) return
    const start = canvasXY(e.clientX, e.clientY)
    const anchorX = r.left, anchorY = r.top
    const startDist = Math.max(1, Math.hypot(start.x - anchorX, start.y - anchorY))
    const startFont = currentFont(target)
    const move = (ev: MouseEvent) => {
      const p = canvasXY(ev.clientX, ev.clientY)
      const dist = Math.hypot(p.x - anchorX, p.y - anchorY)
      setFontFor(target, Math.round(startFont * Math.max(0.2, dist / startDist)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  // 要素の現在値(文字列)を取得/設定
  function elementValue(target: string): string {
    if (target === 'main') return copy.main_copy
    if (target === 'hi') return copy.highlight_word
    if (target === 'sub') return copy.sub_copy
    if (target.startsWith('panel')) return panelTexts[Number(target.slice(5))]
    return ''
  }
  function setElementValue(target: string, value: string) {
    if (target === 'main') setCopy((c) => ({ ...c, main_copy: value }))
    else if (target === 'hi') setCopy((c) => ({ ...c, highlight_word: value }))
    else if (target === 'sub') setCopy((c) => ({ ...c, sub_copy: value }))
    else if (target.startsWith('panel')) { const i = Number(target.slice(5)); setPanelTexts((p) => p.map((v, idx) => (idx === i ? value : v))) }
  }
  // 要素のキャンバス座標 → 画面CSS座標へ変換してオーバーレイ入力欄を出す
  function openEditor(target: string) {
    const c = canvasRef.current; if (!c) return
    const rect = c.getBoundingClientRect()
    const scale = rect.width / W // 表示縮尺
    const ctx = c.getContext('2d')!
    const ff = ts?.font_family || "'Noto Sans JP', sans-serif"
    let left = 0, top = 0, width = 300, fontPx = 48, center = false
    if (target === 'main') {
      const b = mainBounds()
      if (b) {
        // 自動中央のまま編集すると行数変化で再センタリングされ文字が上下にズレるため、
        // 編集開始時に現在位置を mainPos に固定して「編集前のまま」にする。
        if (!bgImgRef.current && mainCentered) { setMainCentered(false); setMainPos({ x: b.left, y: b.top }) }
        left = b.left; top = b.top; width = b.w; fontPx = b.h / Math.max(1, copy.main_copy.split('\n').length) / 1.15
      }
    }
    else if (target === 'hi') {
      ctx.font = `900 ${hiFont}px ${ff}`; const lines = copy.highlight_word.split('\n')
      left = hiPos.x; top = hiPos.y; width = Math.max(60, ...lines.map((l) => ctx.measureText(l).width)); fontPx = hiFont
    } else if (target === 'sub') {
      ctx.font = `700 ${subFont}px ${ff}`; const lines = copy.sub_copy.split('\n')
      left = subPos.x + 16; top = subPos.y + 12; width = Math.max(60, ...lines.map((l) => ctx.measureText(l).width)); fontPx = subFont
    } else if (target.startsWith('panel')) {
      const i = Number(target.slice(5)); ctx.font = `900 ${panelFonts[i]}px ${ff}`; const lines = (panelTexts[i] || ' ').split('\n')
      const w = Math.max(60, ...lines.map((l) => ctx.measureText(l).width)); left = panelPos[i].x - w / 2; top = panelPos[i].y; width = w; fontPx = panelFonts[i]; center = true
    }
    setEditing({ target, left: left * scale, top: top * scale, width: Math.max(80, width) * scale, fontPx: fontPx * scale, center })
  }
  function onDblClick(e: React.MouseEvent) {
    const { x, y } = canvasXY(e.clientX, e.clientY)
    const t = hitTest(x, y)
    // 何も無い所をダブルクリック→メインを編集（空でも入力開始できる）
    openEditor(t && t.startsWith('arrow') ? 'main' : (t || 'main'))
  }

  // ---- サムネサイズ(1280x720)でPNGダウンロード ----
  function downloadPng() {
    const c = canvasRef.current; if (!c) return
    draw() // 最新状態を確実に反映
    const a = document.createElement('a')
    a.download = `thumbnail_${(title || 'youtube').replace(/[^\w一-龠ぁ-んァ-ヶー]/g, '_').slice(0, 40)}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  }

  // ---- 保存(完成PNG) ----
  async function save() {
    setBusy('save'); setErr(null)
    try {
      const dataUrl = canvasRef.current!.toDataURL('image/png')
      // 再編集時に文字が二重にならないよう「文字なしのクリーン背景」と3コマ文も一緒に保存
      await api.post('/thumbnails', {
        mindmap_id: mindmapId, title, prompt,
        copy: { ...copy, panels: panelTexts },
        image_base64: dataUrl,
        clean_background_base64: bgImgRef.current ? backgroundDataUrl() : undefined,
        source: 'gpt_image',
      })
      loadThumbs()
    } catch (e: any) {
      setErr(e?.response?.data?.error || '保存に失敗しました')
    } finally { setBusy(null) }
  }

  // ---- 保存済みを編集欄に読み込む(変種づくり) ----
  async function editThumb(t: Thumb) {
    if (t.copy) setCopy({ main_copy: t.copy.main_copy || '', highlight_word: t.copy.highlight_word || '', sub_copy: t.copy.sub_copy || '' })
    if (t.copy?.panels) { setPanelTexts([t.copy.panels[0] || '', t.copy.panels[1] || '', t.copy.panels[2] || '']); setUsePanels(t.copy.panels.some((p) => p?.trim())) }
    if (t.prompt) setPrompt(t.prompt)
    // 文字なしのクリーン背景があればそれを下敷きに（文字が二重にならない）。
    // 無い旧データのみ、やむなく文字込み画像を下敷きにする。
    if (t.has_clean_background) {
      try {
        const r = await api.get(`/thumbnails/${t.id}/clean_background`, { responseType: 'blob' })
        loadBackground(URL.createObjectURL(r.data as Blob))
      } catch { if (thumbUrls[t.id]) loadBackground(thumbUrls[t.id]) }
    } else if (thumbUrls[t.id]) {
      loadBackground(thumbUrls[t.id])
    }
    // 上へスクロールはしない（編集位置を維持）
  }

  // ---- Canva 連携 ----
  async function connectCanva() {
    try { const r = await api.get('/canva/connect'); location.href = r.data.authorize_url }
    catch (e: any) { setErr(e?.response?.data?.error || 'Canva連携設定が未完了です') }
  }
  async function toCanva() {
    setBusy('canva'); setErr(null)
    try {
      // 文字込みの合成画像(テンプレ未設定時のフォールバック=文言がCanvaにも見える) と
      // 文字なしのクリーン背景＋テキスト(テンプレ有り時=編集可能テキスト) の両方を送る。
      const composited = canvasRef.current ? canvasRef.current.toDataURL('image/png') : undefined
      const clean = bgImgRef.current ? backgroundDataUrl() : undefined
      const r = await api.post('/thumbnails/to_canva', {
        mindmap_id: mindmapId, title, prompt,
        image_base64: composited,
        background_base64: clean,
        texts: { main_copy: copy.main_copy, highlight: copy.highlight_word, sub_copy: copy.sub_copy, panel_left: panelTexts[0], panel_mid: panelTexts[1], panel_right: panelTexts[2] },
      })
      loadThumbs()
      if (r.data.edit_url) window.open(r.data.edit_url, '_blank')
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Canva連携に失敗しました')
    } finally { setBusy(null) }
  }
  function backgroundDataUrl(): string {
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H
    const ctx = tmp.getContext('2d')!
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, W, H)
    return tmp.toDataURL('image/png')
  }
  async function importCanva(id: number) {
    setBusy(`imp-${id}`); setErr(null)
    try { await api.post(`/thumbnails/${id}/import_canva`); setThumbUrls((p) => { const n = { ...p }; delete n[id]; return n }); loadThumbs() }
    catch (e: any) { setErr(e?.response?.data?.error || 'Canvaからの取込に失敗しました') }
    finally { setBusy(null) }
  }
  async function removeThumb(id: number) { await api.delete(`/thumbnails/${id}`); loadThumbs() }

  const canva = defaults?.canva

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-[var(--color-text-sub)]">背景=AI / 文字=ブラウザ合成 / 仕上げ=保存 or Canva</div>

      {/* スタイル選択 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-[var(--color-text-sub)]">スタイル</label>
        <select value={styleKey} onChange={(e) => onChangeStyle(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] p-1.5 text-xs">
          {defaults?.styles?.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* プロンプト編集 */}
      <div>
        <div className="mb-1 text-xs font-semibold text-[var(--color-text-sub)]">背景プロンプト(編集可・スタイルで切替)</div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
          className="w-full rounded-lg border border-[var(--color-border)] p-2 text-xs font-mono" />
      </div>

      {/* 文言 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs">メインコピー(改行可)
          <textarea value={copy.main_copy} onChange={(e) => setCopy({ ...copy, main_copy: e.target.value })} rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-xs" />
        </label>
        <label className="text-xs">強調ワード(別表示・色付き・改行可)
          <textarea value={copy.highlight_word} onChange={(e) => setCopy({ ...copy, highlight_word: e.target.value })} rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-xs"
            placeholder="メインとは別の一言（重複させない）。ドラッグで移動" />
        </label>
        <label className="text-xs">サブコピー(下帯・改行可)
          <textarea value={copy.sub_copy} onChange={(e) => setCopy({ ...copy, sub_copy: e.target.value })} rows={3}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-xs"
            placeholder="下帯の一言（改行可）。ドラッグで移動" />
        </label>
      </div>

      {/* 3コマ毎の文字（左/中/右） */}
      <div className="rounded-lg bg-[var(--color-bg-sub,#f7f7f8)] p-2 text-xs space-y-1">
        <label className="flex items-center gap-1 font-semibold">
          <input type="checkbox" checked={usePanels} onChange={(e) => setUsePanels(e.target.checked)} />
          3コマ毎に文字を入れる（各コマ中央上に配置・改行可）
        </label>
        {usePanels && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">矢印
                <select value={showArrows ? 'on' : 'off'} onChange={(e) => setShowArrows(e.target.value === 'on')} className="rounded border border-[var(--color-border)] px-1 py-0.5">
                  <option value="on">表示する</option>
                  <option value="off">表示しない</option>
                </select>
              </label>
              {showArrows && (
                <label className="flex items-center gap-1">矢印サイズ<input type="range" min={30} max={200} value={arrowSize} onChange={(e) => setArrowSize(Number(e.target.value))} className="w-20" /><span className="tabular-nums w-7">{arrowSize}</span></label>
              )}
              <span className="text-[10px] text-[var(--color-text-sub)]">※コマ文字・矢印・強調ワードはすべてドラッグで移動できます</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['左コマ', '中コマ', '右コマ'].map((lbl, i) => (
                <div key={i} className="text-[11px]">
                  <div className="flex items-center justify-between">
                    <span>{lbl}</span>
                    <label className="flex items-center gap-0.5">サイズ<input type="range" min={24} max={140} value={panelFonts[i]} onChange={(e) => setPanelFonts((p) => p.map((v, idx) => (idx === i ? Number(e.target.value) : v)))} className="w-16" /><span className="tabular-nums w-6">{panelFonts[i]}</span></label>
                  </div>
                  <textarea value={panelTexts[i]} onChange={(e) => setPanelTexts((p) => p.map((v, idx) => (idx === i ? e.target.value : v)))} rows={2}
                    className="mt-0.5 w-full rounded border border-[var(--color-border)] p-1.5 text-xs" />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={genCopy} disabled={!!busy} className="rounded-lg bg-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" title="マインドマップの内容から新しい文言をAIがゼロから作る（今の文字は置き換わる）">{busy === 'copy' ? '生成中…' : '✨ 文言を自動生成'}</button>
        <button onClick={proofreadCopy} disabled={!!busy} className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" title="今の文言の誤字脱字・表記ゆれだけを直す（言い回し・意味・長さは変えない）">{busy === 'proof' ? '添削中…' : '🪄 誤字脱字を直す'}</button>
        <button onClick={genBackground} disabled={!!busy} className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy === 'bg' ? '生成中…(20〜40秒)' : '🎨 背景を生成'}</button>
        <button onClick={genAll} disabled={!!busy} className="rounded-lg bg-gradient-to-r from-blue-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" title="背景を生成→そのあと文言も自動生成">{busy ? '生成中…' : '🚀 背景＋文言を一括'}</button>
        <button onClick={save} disabled={!!busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy === 'save' ? '保存中…' : '💾 保存'}</button>
        <button onClick={downloadPng} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white" title="今のプレビューをサムネサイズ(1280×720)のPNGでダウンロード">📥 サムネをダウンロード</button>
      </div>

      {/* 文字スタイル(サイズ・色) */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--color-bg-sub,#f7f7f8)] p-2 text-xs">
        <label className="flex items-center gap-1">メイン<input type="range" min={48} max={180} value={mainFont} onChange={(e) => setMainFont(Number(e.target.value))} /></label>
        <label className="flex items-center gap-1">強調<input type="range" min={28} max={140} value={hiFont} onChange={(e) => setHiFont(Number(e.target.value))} /></label>
        <label className="flex items-center gap-1">サブ<input type="range" min={24} max={80} value={subFont} onChange={(e) => setSubFont(Number(e.target.value))} /></label>
        {ts && <>
          <span className="text-[10px] text-[var(--color-text-sub)]">色:</span>
          <label className="flex items-center gap-1" title="メイン＆3コマ文字の色">メイン/コマ<input type="color" value={ts.main_color} onChange={(e) => setTs({ ...ts, main_color: e.target.value })} /></label>
          <label className="flex items-center gap-1" title="強調ワード＆矢印の色">強調/矢印<input type="color" value={ts.highlight_color} onChange={(e) => setTs({ ...ts, highlight_color: e.target.value })} /></label>
          <label className="flex items-center gap-1" title="サブコピーの文字色">サブ文字<input type="color" value={ts.sub_color} onChange={(e) => setTs({ ...ts, sub_color: e.target.value })} /></label>
          <label className="flex items-center gap-1" title="全文字の縁取り色">フチ<input type="color" value={ts.stroke_color} onChange={(e) => setTs({ ...ts, stroke_color: e.target.value })} /></label>
          <label className="flex items-center gap-1" title="サブコピーの下帯の色">サブ帯<input type="color" value={ts.sub_bg_color} onChange={(e) => setTs({ ...ts, sub_bg_color: e.target.value })} /></label>
        </>}
        <label className="flex items-center gap-1">全体背景<input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} /></label>
        <label className="flex items-center gap-1" title="メイン/強調/3コマ文字の後ろに塗りボックスを敷く">
          <input type="checkbox" checked={textBgOn} onChange={(e) => setTextBgOn(e.target.checked)} />文字背景
          <input type="color" value={textBgColor} onChange={(e) => setTextBgColor(e.target.value)} disabled={!textBgOn} />
        </label>
        <button onClick={() => { bgImgRef.current = null; draw() }}
          className="rounded border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px]" title="AI背景画像を消して背景色のみにする">🗑 背景画像クリア(色のみ)</button>
      </div>

      {/* Canva */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-bg-sub,#f7f7f8)] p-2">
        {canva && !canva.configured && <span className="text-[11px] text-[var(--color-text-sub)]">Canva連携は未設定</span>}
        {canva?.configured && !canva.connected && <button onClick={connectCanva} className="rounded-lg border border-[#00c4cc] px-3 py-1.5 text-xs font-semibold text-[#00b3ba]">🔗 Canvaに接続</button>}
        {canva?.connected && <button onClick={toCanva} disabled={!!busy} className="rounded-lg bg-[#00c4cc] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy === 'canva' ? '送信中…' : '🎨 Canvaで仕上げる'}</button>}
      </div>

      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}

      {/* プレビュー（画像上で：ドラッグ移動 / ホイールで拡縮 / ダブルクリックで直接入力） */}
      <div ref={wrapRef} className="relative w-full">
        <canvas ref={canvasRef} width={W} height={H}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onDoubleClick={onDblClick}
          className="w-full cursor-move rounded-xl border border-[var(--color-border)] shadow" />
        {selected && !editing && (() => {
          const r = elementRect(selected); if (!r) return null
          const scale = canvasRef.current ? canvasRef.current.getBoundingClientRect().width / W : 1
          return (
            <div style={{ position: 'absolute', left: r.left * scale - 3, top: r.top * scale - 3, width: r.w * scale + 6, height: r.h * scale + 6, border: '1.5px dashed #2563eb', borderRadius: 4, pointerEvents: 'none', zIndex: 6 }}>
              <div onMouseDown={(e) => onHandleDown(e, selected)} title="ドラッグで文字サイズを伸縮"
                style={{ position: 'absolute', right: -9, bottom: -9, width: 18, height: 18, background: '#2563eb', border: '2px solid #fff', borderRadius: 4, cursor: 'nwse-resize', pointerEvents: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }} />
            </div>
          )
        })()}
        {editing && (
          <textarea
            autoFocus
            value={elementValue(editing.target)}
            onChange={(e) => setElementValue(editing.target, e.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); setEditing(null) } }}
            style={{
              position: 'absolute', left: editing.left, top: editing.top, width: editing.width,
              fontSize: editing.fontPx, lineHeight: 1.15, fontWeight: 900,
              textAlign: editing.center ? 'center' : 'left',
              fontFamily: ts?.font_family || "'Noto Sans JP', sans-serif",
              color: '#111', background: 'rgba(255,255,255,0.92)', border: '2px solid #2563eb',
              borderRadius: 6, padding: '2px 4px', outline: 'none', resize: 'none', overflow: 'hidden', zIndex: 10,
            }}
            rows={Math.max(1, elementValue(editing.target).split('\n').length)}
          />
        )}
      </div>
      <div className="text-[10px] text-[var(--color-text-sub)]">画像上で：<b>クリック</b>＝選択（青枠＋右下ハンドル）／ <b>ハンドルをドラッグ</b>＝文字を伸縮（Canva風）／ <b>本体をドラッグ</b>＝移動 ／ <b>ホイール</b>＝拡縮 ／ <b>ダブルクリック</b>＝その場でテキスト入力。全文字（メイン・強調・サブ・3コマ・矢印）対応。</div>

      {/* 履歴(再編集・変種) */}
      {thumbs.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-[var(--color-text-sub)]">保存済みサムネ(「編集」で読み込んで変種を作成)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {thumbs.map((t) => (
              <div key={t.id} className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                {thumbUrls[t.id]
                  ? <img src={thumbUrls[t.id]} alt={t.title} className="aspect-video w-full object-cover" />
                  : <div className="flex aspect-video w-full items-center justify-center bg-gray-100 text-[10px] text-gray-400">読込中…</div>}
                <div className="flex flex-wrap items-center justify-between gap-1 p-1">
                  <button onClick={() => editThumb(t)} className="text-[10px] text-blue-600">✎編集</button>
                  {thumbUrls[t.id] && <a href={thumbUrls[t.id]} download={`thumbnail_${t.id}.png`} className="text-[10px] text-blue-600">⬇DL</a>}
                  {t.canva_edit_url && <a href={t.canva_edit_url} target="_blank" rel="noreferrer" className="text-[10px] text-[#00b3ba]">Canva</a>}
                  {t.canva_edit_url && <button onClick={() => importCanva(t.id)} className="text-[10px] text-emerald-600">{busy === `imp-${t.id}` ? '…' : '取込'}</button>}
                  <button onClick={() => removeThumb(t.id)} className="text-[10px] text-red-500">削除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
