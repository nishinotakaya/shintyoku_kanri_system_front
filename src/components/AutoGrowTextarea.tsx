import { useLayoutEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }

// 入力内容に応じて高さが縦に自動拡張される textarea。
// scrollHeight に合わせて高さを再設定し、内部スクロール/手動リサイズを抑止する。
export default function AutoGrowTextarea({ minRows = 2, value, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      style={{ resize: 'none', overflow: 'hidden', ...style }}
      {...rest}
    />
  )
}
