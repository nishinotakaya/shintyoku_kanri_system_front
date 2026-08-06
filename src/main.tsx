import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

// デプロイ後、開きっぱなしの古いタブは消えた旧ハッシュのチャンクを読みに行って白画面になる。
// Vite はチャンク読み込み失敗時に vite:preloadError を投げるので、一度だけ自動リロードして
// 新しい index.html を取り直す(2回目は無限ループ防止のため何もしない)。
window.addEventListener('vite:preloadError', () => {
  const RELOADED_KEY = 'chunk-reload-at'
  const lastReloadedAt = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0)
  if (Date.now() - lastReloadedAt < 60_000) return
  sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  window.location.reload()
})

// PWA: Service Worker 登録 (本番のみ。ホーム画面追加でアプリとして起動できる)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
