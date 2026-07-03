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

export default function SapLink({ text }: { text: string | null | undefined }) {
  const backlogUrl = useBacklogUrl()
  if (!text) return null
  return <>{renderSapText(text, backlogUrl)}</>
}
