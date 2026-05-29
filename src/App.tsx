import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import ProgressPage from './pages/ProgressPage'
import CalendarPage from './pages/CalendarPage'
import UsersPage from './pages/UsersPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import InvoicesPage from './pages/InvoicesPage'
import { fetchMe, isAuthed, signOut } from './lib/auth'
import { api } from './lib/api'
import type { Me } from './lib/api'

type SubmissionLite = { id: number; year: number; month: number; category: string; kind: 'invoice' | 'expense'; user_display_name: string }

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthed()) return <Navigate to="/sign_in" replace />
  return <>{children}</>
}

type NavItem = { to: string; label: string; icon: string; adminOnly?: boolean; tabTitle?: string }
const NAV: NavItem[] = [
  { to: '/', label: 'カレンダー', icon: '📅', tabTitle: 'カレンダー' },
  { to: '/progress', label: '進捗管理', icon: '📊', tabTitle: '進捗' },
  { to: '/attendance', label: '勤怠', icon: '🕒', tabTitle: '勤怠' },
  { to: '/purchase-orders', label: '注文書', icon: '📋', tabTitle: '注文書' },
  { to: '/invoices', label: '請求書一覧', icon: '📄', tabTitle: '請求書' },
  { to: '/users', label: 'ユーザー一覧', icon: '👥', adminOnly: true, tabTitle: 'ユーザー' },
]
const BRAND = '進捗管理システム'
const SEEN_BELL_KEY = 'bellSeenApplicationIds'
const appKey = (s: SubmissionLite) => `${s.kind}-${s.id}`

function Layout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem('sidebarOpen')
    return stored === null ? true : stored === 'true'
  })
  const [pendingApplications, setPendingApplications] = useState<SubmissionLite[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  // 既読にした申請の ID セット（リロードしてもバッジが復活しないよう localStorage に永続化）
  const [seenApplicationIds, setSeenApplicationIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SEEN_BELL_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => {
    fetchMe().then(setMe)
  }, [])

  useEffect(() => {
    localStorage.setItem('sidebarOpen', String(sidebarOpen))
  }, [sidebarOpen])

  // ページ遷移ごとにブラウザタブのタイトルを切替。
  // /attendance (Dashboard) は page 側で年月を追記するので、ここでは初期値だけ入れる。
  useEffect(() => {
    const item = NAV.find((n) => n.to === loc.pathname)
    const tab = item?.tabTitle ?? item?.label
    document.title = tab ? `${tab} — ${BRAND}` : BRAND
  }, [loc.pathname])

  // admin: 申請中件数を 60 秒毎にポーリング
  useEffect(() => {
    if (!me?.admin) { setPendingApplications([]); return }
    let cancelled = false
    const fetchPending = async () => {
      try {
        const [inv, exp] = await Promise.all([
          api.get<SubmissionLite[]>('/invoice_submissions', { params: { status: 'pending', kind: 'invoice' } }),
          api.get<SubmissionLite[]>('/invoice_submissions', { params: { status: 'pending', kind: 'expense' } }),
        ])
        if (cancelled) return
        const next = [...inv.data, ...exp.data]
        setPendingApplications(next)
        // 承認/却下済みで pending から外れた申請は既読セットからも除去（肥大化防止）
        setSeenApplicationIds((prev) => {
          const stillPending = new Set(next.map(appKey))
          const pruned = new Set([...prev].filter((k) => stillPending.has(k)))
          return pruned.size === prev.size ? prev : pruned
        })
      } catch { /* noop */ }
    }
    fetchPending()
    const t = setInterval(fetchPending, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [me?.admin, loc.pathname])

  // その時点の未対応申請をすべて既読にする（バッジを消す）
  const markPendingSeen = () => {
    setSeenApplicationIds((prev) => {
      if (pendingApplications.length === 0) return prev
      const next = new Set(prev)
      for (const s of pendingApplications) next.add(appKey(s))
      return next.size === prev.size ? prev : next
    })
  }

  // 既読セットを localStorage に保存
  useEffect(() => {
    try { localStorage.setItem(SEEN_BELL_KEY, JSON.stringify([...seenApplicationIds])) } catch { /* noop */ }
  }, [seenApplicationIds])

  // ページ遷移したら、その時点の未対応申請を既読にしてバッジを消す。
  // 新しい申請が届けば未読として再びバッジが点く。
  useEffect(() => {
    markPendingSeen()
    // pendingApplications はあえて依存に含めない（遷移時点のスナップショットを既読化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])

  // バッジに出す「未読の未対応申請」
  const unseenApplications = pendingApplications.filter((s) => !seenApplicationIds.has(appKey(s)))

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`shrink-0 bg-white flex flex-col sticky top-0 h-screen transition-[width] duration-200 ease-out overflow-hidden ${
          sidebarOpen ? 'w-56 border-r border-[var(--color-border)]' : 'w-0 border-r-0'
        }`}
        aria-hidden={!sidebarOpen}
      >
        <Link to="/" className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border)] min-w-[14rem]">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] shadow-md shrink-0" />
          <div className="text-sm font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap">進捗管理システム</div>
        </Link>
        <nav className="flex-1 px-3 py-3 space-y-0.5 min-w-[14rem]">
          {NAV.filter((n) => !n.adminOnly || !!me?.admin).map((n) => {
            const active = loc.pathname === n.to
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition ${
                  active
                    ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)] text-white font-semibold shadow-md'
                    : 'text-[var(--color-text-sub)] font-medium hover:text-[var(--color-text)] hover:bg-[var(--color-bg)]'
                }`}
              >
                <span className="text-base leading-none">{n.icon}</span>
                <span>{n.label}</span>
                {active && <span className="ml-auto text-xs opacity-80">●</span>}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white border-b border-[var(--color-border)] shadow-sm">
          <div className="flex items-center gap-4 px-6 py-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
              aria-expanded={sidebarOpen}
              title={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] active:scale-95 transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-5 w-5 transition-transform duration-200 ${sidebarOpen ? '' : 'rotate-180'}`}
                aria-hidden
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            {me?.admin && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBellOpen((v) => { const nextOpen = !v; if (nextOpen) markPendingSeen(); return nextOpen })}
                  aria-label={`未対応申請 ${pendingApplications.length} 件${unseenApplications.length ? `（新着 ${unseenApplications.length} 件）` : ''}`}
                  title={unseenApplications.length > 0 ? `${unseenApplications.length} 件の新しい申請が届いています` : pendingApplications.length > 0 ? `未対応の申請が ${pendingApplications.length} 件あります` : '新しい申請はありません'}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-sub)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] active:scale-95 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {unseenApplications.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none flex items-center justify-center shadow ring-2 ring-white">
                      {unseenApplications.length > 99 ? '99+' : unseenApplications.length}
                    </span>
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-[var(--color-border)] bg-white shadow-lg z-30 p-2">
                    <div className="text-[11px] font-semibold text-[var(--color-text)] mb-1 flex items-center justify-between">
                      <Link to="/attendance" onClick={() => setBellOpen(false)}
                        className="text-fuchsia-600 hover:text-fuchsia-500 underline-offset-2 hover:underline">
                        未対応の申請（{pendingApplications.length}） →
                      </Link>
                      <button onClick={() => setBellOpen(false)} className="text-[var(--color-text-sub)] hover:text-[var(--color-text)]">✕</button>
                    </div>
                    {pendingApplications.length === 0 ? (
                      <div className="text-[11px] text-[var(--color-text-sub)] py-2">新しい申請はありません</div>
                    ) : (
                      <ul className="divide-y divide-[var(--color-border)] max-h-[min(60vh,22rem)] overflow-y-auto overscroll-contain">
                        {pendingApplications.map((s) => {
                          const surname = (s.user_display_name ?? '').split(/[\s　]/)[0] ?? s.user_display_name
                          const kindLabel = s.kind === 'invoice' ? '請求書' : '立替金'
                          return (
                            <li key={`${s.kind}-${s.id}`} className="py-0">
                              <Link to="/attendance" onClick={() => setBellOpen(false)}
                                className="block py-1.5 text-[11px] hover:bg-fuchsia-50 rounded px-1">
                                <div>
                                  <span className={`mr-1 inline-block rounded px-1 py-0.5 text-[9px] ${s.kind === 'invoice' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>{kindLabel}</span>
                                  <span className="font-semibold text-fuchsia-600">{surname}さん</span>
                                </div>
                                <div className="text-[10px] text-[var(--color-text-sub)]">{s.year}年{s.month}月分（{s.category}）</div>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <div className="mt-1 pt-1 border-t border-[var(--color-border)]">
                      <Link to="/attendance" onClick={() => setBellOpen(false)} className="text-[11px] text-fuchsia-500 hover:text-fuchsia-400 font-semibold">申請ダッシュボードへ →</Link>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="ml-auto flex items-center gap-4">
              <div className="text-sm text-[var(--color-text-sub)]">{me?.display_name ?? me?.email ?? '—'}</div>
              <button
                onClick={async () => {
                  await signOut()
                  nav('/sign_in')
                }}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-[var(--color-bg)]"
              >
                ログアウト
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign_in" element={<SignIn />} />
      <Route path="/sign_up" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout>
              <CalendarPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/attendance"
        element={
          <RequireAuth>
            <Layout>
              <Dashboard />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <Layout>
              <ProgressPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/calendar"
        element={<Navigate to="/" replace />}
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <Layout>
              <UsersPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/purchase-orders"
        element={
          <RequireAuth>
            <Layout>
              <PurchaseOrdersPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/invoices"
        element={
          <RequireAuth>
            <Layout>
              <InvoicesPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
