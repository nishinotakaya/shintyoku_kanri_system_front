import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import AutoGrowTextarea from '../AutoGrowTextarea'
import ConfirmDialog from '../ConfirmDialog'

// 「カンペ」タブ本体。撮影中にチラ見して読む台本をAIで生成・保存する。
// テンプレはスタイルで分岐(sales=西野式セールス / app_build=アプリを作る完全台本)。
// 未生成なら中央の生成ボタンのみ、生成済みなら【見出し】区切りでセクションカードに分解して表示する。

type KanpeStyle = 'sales' | 'app_build'

type Props = {
  mindmapId: number
  kanpeScript: string | null
  kanpeStyle: KanpeStyle
  onStyleChange: (style: KanpeStyle) => void
  onSaved: (kanpeScript: string) => void
}

type KanpeSection = { heading: string; body: string }

// PATCH/POST の応答は他エンドポイントと同形式の mindmap payload だが、このコンポーネントは kanpe_script だけ使う
type KanpeResponse = { kanpe_script: string }

// 本編セクションの「未来：」「問題：」「原因：」「解決：」ラベルの強調色(閲覧モードのみ)
const LABEL_ACCENT: Record<string, string> = {
  未来: 'text-emerald-600',
  問題: 'text-red-600',
  原因: 'text-amber-600',
  解決: 'text-sky-600',
}

// kanpe_script(【見出し】区切りの1テキスト)をセクション配列に分解する。
// 最初の見出しより前のテキスト(前置き)や、AIが見出し書式を外した場合の全文も
// heading='' のセクションとして必ず保持する(編集保存で本文を消さない・不可視にしないため)。
function parseKanpeScript(script: string): KanpeSection[] {
  const sections: KanpeSection[] = []
  let currentHeading = ''
  let currentBodyLines: string[] = []
  const flushCurrentSection = () => {
    const body = currentBodyLines.join('\n').trim()
    if (currentHeading !== '' || body !== '') sections.push({ heading: currentHeading, body })
  }
  script.split('\n').forEach((line) => {
    const headingMatch = line.match(/^\s*【(.+)】\s*$/)
    if (headingMatch) {
      flushCurrentSection()
      currentHeading = headingMatch[1]
      currentBodyLines = []
    } else {
      currentBodyLines.push(line)
    }
  })
  flushCurrentSection()
  return sections
}

// セクション配列を保存用の1テキストに再結合する(【見出し】\n本文 の形式。見出しなしセクションは本文のみ)
function buildKanpeScript(sections: KanpeSection[]): string {
  return sections.map((section) => (section.heading === '' ? section.body : `【${section.heading}】\n${section.body}`)).join('\n\n')
}

export default function KanpeCueSheet({ mindmapId, kanpeScript, kanpeStyle, onStyleChange, onSaved }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [copied, setCopied] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [styleChangedNotice, setStyleChangedNotice] = useState(false) // 生成済みのままスタイルを切り替えた時の再生成ヒント

  const sections = useMemo(() => (kanpeScript ? parseKanpeScript(kanpeScript) : []), [kanpeScript])
  // 読み上げ目安は本文だけで数える(【見出し】は声に出さないため)
  const totalChars = sections.reduce((sum, section) => sum + section.body.length, 0)
  const estimatedReadingMinutes = (totalChars / 300).toFixed(1) // 300字=1分で概算

  // テンプレ切替トグル。未生成時と生成済み時の両方の画面で表示する
  const styleToggle = (
    <div className="flex items-center gap-1">
      <button onClick={() => changeStyle('sales')} disabled={!!busy}
        className={`rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${kanpeStyle === 'sales' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
        🎤 セールス（西野式）
      </button>
      <button onClick={() => changeStyle('app_build')} disabled={!!busy}
        className={`rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${kanpeStyle === 'app_build' ? 'bg-fuchsia-500 text-white' : 'border border-[var(--color-border)] text-[var(--color-text-sub)]'}`}>
        🛠 アプリを作る
      </button>
    </div>
  )

  const generateKanpe = async () => {
    setBusy('generate'); setErr(null)
    try {
      const response = await api.post<KanpeResponse>(`/interview_mindmaps/${mindmapId}/generate_kanpe`)
      onSaved(response.data.kanpe_script)
      setEditingIndex(null)
      setStyleChangedNotice(false)
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '生成に失敗しました')
    } finally {
      setBusy(null)
      setShowRegenerateConfirm(false)
    }
  }

  // どのテンプレでAI生成するかの切替(sales=西野式セールス / app_build=アプリを作る完全台本)
  const changeStyle = async (style: KanpeStyle) => {
    if (style === kanpeStyle) return
    setBusy('style'); setErr(null)
    try {
      await api.patch(`/interview_mindmaps/${mindmapId}`, { kanpe_style: style })
      onStyleChange(style)
      setStyleChangedNotice(!!kanpeScript) // 旧スタイルの台本が残っている場合だけ再生成を促す
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? 'スタイルの変更に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  const startEdit = (index: number) => { setEditingIndex(index); setEditingBody(sections[index].body) }
  const cancelEdit = () => setEditingIndex(null)

  const saveSection = async (index: number) => {
    setBusy(`save-${index}`); setErr(null)
    try {
      const nextSections = sections.map((section, sectionIndex) => (sectionIndex === index ? { ...section, body: editingBody } : section))
      const response = await api.patch<KanpeResponse>(`/interview_mindmaps/${mindmapId}`, { kanpe_script: buildKanpeScript(nextSections) })
      onSaved(response.data.kanpe_script)
      setEditingIndex(null)
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? '保存に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  const copyAll = async () => {
    if (!kanpeScript) return
    try {
      await navigator.clipboard.writeText(kanpeScript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr('コピーに失敗しました')
    }
  }

  // 本文を行ごとに描画し、「未来：」「問題：」「原因：」「解決：」だけラベル部分を強調する
  const renderBody = (body: string) => body.split('\n').map((line, lineIndex) => {
    const directionMatch = line.match(/^\s*>(.*)$/)
    if (directionMatch) {
      return <p key={lineIndex} className="mb-1 whitespace-pre-wrap rounded bg-sky-50 px-1.5 py-0.5 text-[11px] leading-relaxed text-sky-700">{directionMatch[1].trim()}</p>
    }
    const labelMatch = line.match(/^(未来|問題|原因|解決)：/)
    if (!labelMatch) {
      return line.trim() === '' ? <div key={lineIndex} className="h-2" /> : <p key={lineIndex} className="mb-1 whitespace-pre-wrap leading-relaxed">{line}</p>
    }
    const label = labelMatch[1]
    return (
      <p key={lineIndex} className="mb-1 whitespace-pre-wrap leading-relaxed">
        <b className={LABEL_ACCENT[label]}>{label}：</b>{line.slice(labelMatch[0].length)}
      </p>
    )
  })

  if (!kanpeScript) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        {styleToggle}
        <button onClick={generateKanpe} disabled={!!busy}
          className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-6 py-3 text-sm font-semibold text-white shadow disabled:opacity-50">
          {busy === 'generate' ? '書き出し中…（30秒〜1分ほどかかります）' : (kanpeStyle === 'app_build' ? '🤖 AIで台本を書き出す' : '🤖 AIでカンペを書き出す')}
        </button>
        <div className="max-w-md text-[11px] text-[var(--color-text-sub)]">
          {kanpeStyle === 'app_build'
            ? 'タイトル・マインドマップを読み込んで、アプリを作る完全台本（フック→デモ→AI時代の価値→CTA、画面・テロップ指示付き）を書き出します。'
            : 'ペルソナ・スキルシート・マインドマップの回答を読み込んで、西野式テンプレ（挨拶→企画コール→本編→LINE誘導）のカンペを書き出します。'}
        </div>
        {err && <div className="w-full rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {styleToggle}
        <button onClick={copyAll}
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-sub)] hover:text-fuchsia-600">
          {copied ? '✅ コピーしました' : '📋 全文コピー'}
        </button>
        <button onClick={() => setShowRegenerateConfirm(true)} disabled={!!busy}
          className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 px-3 py-1.5 text-xs font-semibold text-fuchsia-600 disabled:opacity-50">
          {busy === 'generate' ? '書き出し中…（30秒〜1分ほどかかります）' : '🤖 AIで書き直す'}
        </button>
        <span className="ml-auto text-[11px] text-[var(--color-text-sub)]">全{totalChars}字 / 読み上げ目安 約{estimatedReadingMinutes}分</span>
      </div>

      {err && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{err}</div>}
      {styleChangedNotice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          スタイルを変更しました。表示中の台本は前のスタイルのままです。「🤖 AIで書き直す」を押すと新しいスタイルで生成されます。
        </div>
      )}

      <div className="space-y-2">
        {sections.map((section, index) => (
          <div key={index} className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <div className="flex items-center justify-between border-l-4 border-fuchsia-400 bg-fuchsia-50 px-3 py-1.5">
              <span className="text-sm font-bold text-fuchsia-800">{section.heading === '' ? '（見出しなし）' : `【${section.heading}】`}</span>
              {editingIndex !== index && (
                <button onClick={() => startEdit(index)} title="編集" className="text-[11px] text-fuchsia-600 hover:text-fuchsia-800">✏️</button>
              )}
            </div>
            <div className="bg-white px-3 py-2">
              {editingIndex === index ? (
                <div className="space-y-1.5">
                  <AutoGrowTextarea value={editingBody} autoFocus minRows={3} onChange={(e) => setEditingBody(e.target.value)}
                    className="w-full rounded border border-fuchsia-300 px-2 py-1 text-xs leading-relaxed" />
                  <div className="flex gap-1">
                    <button onClick={() => saveSection(index)} disabled={!!busy}
                      className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50">
                      {busy === `save-${index}` ? '保存中…' : '保存'}
                    </button>
                    <button onClick={cancelEdit} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px]">キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="cursor-text text-xs text-[var(--color-text)]" title="クリックで編集" onClick={() => startEdit(index)}>
                  {renderBody(section.body)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showRegenerateConfirm && (
        <ConfirmDialog
          title="AIでカンペを書き直す"
          message="現在のカンペを破棄してAIで書き直します。よろしいですか？"
          confirmLabel="書き直す" busyLabel="書き直し中…" busy={busy === 'generate'} disabled={!!busy}
          onConfirm={generateKanpe} onClose={() => setShowRegenerateConfirm(false)} />
      )}
    </div>
  )
}
