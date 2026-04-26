import { useRef, useState } from 'react'
import { api } from '../lib/api'

type Op = { from: string; to: string; hours?: number | null; content?: string | null }

export default function VoiceCommand({
  selectedRange,
  onApplied,
}: {
  selectedRange?: { from: string; to: string } | null
  onApplied: () => void
}) {
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastOps, setLastOps] = useState<Op[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunks.current = []
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setBusy(true)
        try {
          const blob = new Blob(chunks.current, { type: 'audio/webm' })
          const fd = new FormData()
          fd.append('audio', blob, 'speech.webm')
          const { data } = await api.post('/work_reports/transcribe', fd)
          setText(data.text)
          await submit(data.text)
        } catch (e: any) {
          setError(e?.response?.data?.error ?? '音声認識に失敗')
        } finally {
          setBusy(false)
        }
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
    } catch (e: any) {
      setError('マイクへのアクセスが拒否されました')
    }
  }
  const stop = () => {
    recRef.current?.stop()
    setRecording(false)
  }

  const submit = async (t?: string) => {
    const value = (t ?? text).trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post('/work_reports/voice_command', {
        text: value,
        selected_range: selectedRange ? `${selectedRange.from}〜${selectedRange.to}` : null,
      })
      setLastOps(data.ops)
      onApplied()
    } catch (e: any) {
      setError(e?.response?.data?.error ?? '解釈に失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass rounded-2xl px-4 py-2 shadow-md">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-sub)] whitespace-nowrap">AI コマンド</span>
        <button
          onClick={recording ? stop : start}
          disabled={busy}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm text-white shadow transition ${
            recording
              ? 'bg-rose-500 shadow-rose-500/30 animate-pulse'
              : 'bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-500/30'
          }`}
          title={recording ? '停止' : '話す'}
        >
          {recording ? '■' : '🎙'}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="例: 4月3日から4月8日は全て8時間にして / SAP-3333で2時間"
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-gray-400 outline-none focus:border-emerald-400/60 focus:bg-gray-50"
        />
        <button
          onClick={() => submit()}
          disabled={busy || !text}
          className="rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-gray-50 disabled:opacity-40"
        >
          適用
        </button>
      </div>
      {error && <div className="mt-1.5 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-red-500">{error}</div>}
      {lastOps && lastOps.length > 0 && (
        <div className="mt-1.5 rounded-lg border border-amber-400/30 bg-amber-50 px-2 py-1 text-[11px] text-amber-600">
          ▶ 解釈:{' '}
          {lastOps.map((op, i) => (
            <span key={i} className="mr-2">
              {op.from} 〜 {op.to}
              {op.content ? ` / ${op.content}` : ''}
              {op.hours != null ? ` / ${op.hours}h` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
