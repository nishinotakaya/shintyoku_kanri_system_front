import { useEffect, useRef, useState } from 'react'

type Props = {
  // ストロークが変わるたびに呼ばれる。署名なし(消去直後・未描画)は null。
  onChange: (signatureImage: string | null) => void
}

// 相手向け公開ページの署名欄。canvas + Pointer Events(マウス/指/ペン共通)。
// touch-none で画面スクロール/ズームを無効化し、devicePixelRatio に合わせて実ピクセル数を確保することで
// スマホでも線がにじまないようにする。
export default function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  // 実際に線を引いたかどうかは ref で同期的に判定する(state だと pointerup 時に
  // 直前の pointermove の更新が反映されているとは限らないため)。isEmpty state は表示専用。
  const hasDrawnRef = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      // リサイズすると canvas の内容は消えるが、署名欄は向き変更等が起きにくく実害は小さいため許容する。
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      context.scale(ratio, ratio)
      context.lineWidth = 2.5
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.strokeStyle = '#1f2933'
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFromEvent(event)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !lastPointRef.current) return
    const point = pointFromEvent(event)
    context.beginPath()
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    context.lineTo(point.x, point.y)
    context.stroke()
    lastPointRef.current = point
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true
      setIsEmpty(false)
    }
  }

  const finishStroke = () => {
    drawingRef.current = false
    lastPointRef.current = null
    const canvas = canvasRef.current
    if (canvas && hasDrawnRef.current) {
      onChange(canvas.toDataURL('image/png'))
    }
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
    hasDrawnRef.current = false
    setIsEmpty(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
        onPointerCancel={finishStroke}
        className="h-40 w-full touch-none rounded-lg border border-[var(--color-border)] bg-white"
      />
      <button
        type="button"
        onClick={handleClear}
        disabled={isEmpty}
        className="h-11 rounded-md border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-sub)] disabled:opacity-40"
      >
        書き直す
      </button>
    </div>
  )
}
