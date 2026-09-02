// SAP-XXXX[タイトル] / SAP-XXXX 形式の文字列を Backlog リンクに変換するレンダラ
// 例:
//   SAP-3838[家歴の絞り込み条件] → <a href="https://xxx.backlog.com/view/SAP-3838">SAP-3838 家歴の絞り込み条件</a>
//   SAP-3654                    → <a href="...">SAP-3654</a>
import { Fragment, useEffect, useState } from 'react'
import { api } from '../lib/api'

const SAP_REGEX = /(SAP-\d+)(?:\[([^\]]*)\])?/g

let cachedBacklogUrl: string | null | undefined = undefined
const subscribers: Array<(url: string | null) => void> = []

async function loadBacklogUrl(): Promise<string | null> {
  if (cachedBacklogUrl !== undefined) return cachedBacklogUrl
  try {
    const r = await api.get('/backlog/setting')
    cachedBacklogUrl = r.data?.backlog_url || null
  } catch {
    cachedBacklogUrl = null
  }
  subscribers.forEach((fn) => fn(cachedBacklogUrl ?? null))
  subscribers.length = 0
  return cachedBacklogUrl ?? null
}

function useBacklogUrl(): string | null {
  const [url, setUrl] = useState<string | null>(cachedBacklogUrl ?? null)
  useEffect(() => {
    if (cachedBacklogUrl !== undefined) {
      setUrl(cachedBacklogUrl ?? null)
      return
    }
    subscribers.push(setUrl)
    loadBacklogUrl()
  }, [])
  return url
}

export function renderSapText(text: string, backlogUrl: string | null): React.ReactNode {
  if (!text) return text
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  SAP_REGEX.lastIndex = 0
  while ((match = SAP_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const issueKey = match[1]
    const title = match[2] ?? ''
    const href = backlogUrl ? `${backlogUrl.replace(/\/$/, '')}/view/${issueKey}` : null
    const display = title ? `${issueKey} ${title}` : issueKey

    if (href) {
      parts.push(
        <a
          key={`${match.index}-${issueKey}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fuchsia-600 underline decoration-dotted hover:text-fuchsia-500"
          onClick={(e) => e.stopPropagation()}
        >
          {display}
        </a>
      )
    } else {
      parts.push(<span key={`${match.index}-${issueKey}`}>{display}</span>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>
}

// リビング(Notion)タスクのタイトル → Notion URL。業務報告の「タイトル(1)/タイトル2(2)」の
// タイトル部分をリンク化するのに使う。Backlog URL と同じくモジュールキャッシュで1回だけ取得する。
type NotionLinkTarget = { title: string; url: string }

let cachedNotionTargets: NotionLinkTarget[] | null | undefined = undefined
const notionSubscribers: Array<(targets: NotionLinkTarget[] | null) => void> = []

async function loadNotionTargets(): Promise<NotionLinkTarget[] | null> {
  if (cachedNotionTargets !== undefined) return cachedNotionTargets
  try {
    const r = await api.get('/notion_tasks', { params: { ignore_date: 'true' } })
    cachedNotionTargets = (Array.isArray(r.data) ? r.data : [])
      .filter((task: any) => task?.title && task?.url)
      .map((task: any) => ({ title: String(task.title), url: String(task.url) }))
      .sort((a: NotionLinkTarget, b: NotionLinkTarget) => b.title.length - a.title.length) // 長い一致を優先
  } catch {
    cachedNotionTargets = null // notion の閲覧権限なし等。リンク化せずプレーン表示に落とす
  }
  notionSubscribers.forEach((fn) => fn(cachedNotionTargets ?? null))
  notionSubscribers.length = 0
  return cachedNotionTargets ?? null
}

function useNotionTargets(enabled: boolean): NotionLinkTarget[] | null {
  const [targets, setTargets] = useState<NotionLinkTarget[] | null>(cachedNotionTargets ?? null)
  useEffect(() => {
    if (!enabled) return
    if (cachedNotionTargets !== undefined) {
      setTargets(cachedNotionTargets ?? null)
      return
    }
    notionSubscribers.push(setTargets)
    loadNotionTargets()
  }, [enabled])
  return enabled ? targets : null
}

// テキスト中に登場する Notion タスクタイトルをリンクへ変える。
// targets は長いタイトル順なので、同じ位置で複数一致したときは長い方が勝つ。
export function renderNotionText(text: string, targets: NotionLinkTarget[] | null): React.ReactNode {
  if (!text || !targets || targets.length === 0) return text
  const parts: React.ReactNode[] = []
  let rest = text
  while (rest.length > 0) {
    let bestIndex = -1
    let bestTarget: NotionLinkTarget | null = null
    for (const target of targets) {
      const index = rest.indexOf(target.title)
      if (index === -1) continue
      if (bestIndex === -1 || index < bestIndex) {
        bestIndex = index
        bestTarget = target
      }
    }
    if (bestIndex === -1 || !bestTarget) {
      parts.push(rest)
      break
    }
    if (bestIndex > 0) parts.push(rest.slice(0, bestIndex))
    parts.push(
      <a
        key={`notion-${parts.length}`}
        href={bestTarget.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-fuchsia-600 underline decoration-dotted hover:text-fuchsia-500"
        onClick={(e) => e.stopPropagation()}
      >
        {bestTarget.title}
      </a>
    )
    rest = rest.slice(bestIndex + bestTarget.title.length)
  }
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>
}

// category が living のときはタマ(SAP/Backlog)ではなくリビング(Notion)としてリンク化する
export default function SapLink({ text, category }: { text: string | null | undefined; category?: string }) {
  const isLiving = category === 'living'
  const backlogUrl = useBacklogUrl()
  const notionTargets = useNotionTargets(isLiving)
  if (!text) return null
  if (isLiving) return <>{renderNotionText(text, notionTargets)}</>
  return <>{renderSapText(text, backlogUrl)}</>
}
