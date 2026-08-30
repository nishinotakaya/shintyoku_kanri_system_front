import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import ProgressPage from './pages/ProgressPage'
import CalendarPage from './pages/CalendarPage'
import UsersPage from './pages/UsersPage'
import SkillSheetsPage from './pages/SkillSheetsPage'
import BacklogActivitiesPage from './pages/BacklogActivitiesPage'
import GitPage from './pages/GitPage'
import InterviewMindmapPage from './pages/InterviewMindmapPage'
import VideoStudioPage from './pages/VideoStudioPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import InvoicesPage from './pages/InvoicesPage'
import SettingsModal from './components/SettingsModal'
import BusinessExpensesPage from './pages/BusinessExpensesPage'
import { isAuthed, signOut } from './lib/auth'
import { useMe, clearMeCache } from './lib/useMe'
import { api } from './lib/api'
import type { Me } from './lib/api'

type SubmissionLite = { id: number; year: number; month: number; category: string; kind: 'invoice' | 'expense'; user_display_name: string }

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthed()) return <Navigate to="/sign_in" replace />
  return <>{children}</>
}

// 各画面の閲覧権限 (admin は常に全部見れる)。値は users.feature_flags のキー。
export type FeatureKey = 'attendance' | 'calendar' | 'progress' | 'purchase_orders' | 'invoices' | 'skill_sheet' | 'interview_mindmap' | 'backlog_activities' | 'keihi' | 'video_studio'
type NavItem = { to: string; label: string; icon: string; adminOnly?: boolean; feature?: FeatureKey; tabTitle?: string }
const NAV: NavItem[] = [
  { to: '/calendar', label: 'カレンダー', icon: '📅', feature: 'calendar', tabTitle: 'カレンダー' },
  { to: '/progress', label: '進捗管理', icon: '📊', feature: 'progress', tabTitle: '進捗' },
  { to: '/git', label: 'Git', icon: '🌿', feature: 'backlog_activities', tabTitle: 'Git' },
  { to: '/attendance', label: '勤怠', icon: '🕒', feature: 'attendance', tabTitle: '勤怠' },
  { to: '/purchase-orders', label: '注文書', icon: '📋', feature: 'purchase_orders', tabTitle: '注文書' },
  { to: '/invoices', label: '請求書一覧', icon: '📄', feature: 'invoices', tabTitle: '請求書' },
  { to: '/skill-sheets', label: 'スキルシート', icon: '📑', feature: 'skill_sheet', tabTitle: 'スキルシート' },
  { to: '/interview-mindmap', label: 'マインドマップ', icon: '🧠', feature: 'interview_mindmap', tabTitle: 'マインドマップ' },
  { to: '/backlog-activities', label: '対応ログ', icon: '📈', feature: 'backlog_activities', tabTitle: '対応ログ' },
  { to: '/keihi', label: '経費計上', icon: '🧾', feature: 'keihi', tabTitle: '経費計上' },
  { to: '/video-studio', label: '動画スタジオ', icon: '🎬', feature: 'video_studio', tabTitle: '動画スタジオ' },
  { to: '/users', label: 'ユーザー一覧', icon: '👥', adminOnly: true, tabTitle: 'ユーザー' },
]

// NAV 項目の表示可否: adminOnly は admin のみ（常時表示でロックアウト防止）、
// feature は admin なら明示的に false のときだけ非表示・一般ユーザーは該当フラグ ON のみ
function navVisible(item: NavItem, me: Me | null): boolean {
  if (item.adminOnly) return !!me?.admin
  if (item.feature) {
    if (me?.admin) return me?.feature_flags?.[item.feature] !== false
    return !!me?.feature_flags?.[item.feature]
  }
  return true
}

// その人が最初に見れる画面 (スキルシートのみのユーザーは /skill-sheets へ)
function firstVisiblePath(me: Me | null): string {
  return NAV.find((n) => navVisible(n, me))?.to ?? '/skill-sheets'
}

// iOS/Android のネイティブアプリ(Capacitor)またはホーム画面PWAとして起動しているか。
// この場合はトップ画面を経費計上(/keihi)にする。
const isMobileAppShell = () =>
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ||
  window.matchMedia('(display-mode: standalone)').matches

// 画面ごとの権限ガード。権限が無ければ自分が見れる最初の画面へリダイレクト (レイアウトを崩さない)
function RequireFeature({ feature, adminOnly, children }: { feature?: FeatureKey; adminOnly?: boolean; children: React.ReactNode }) {
  const { me, loading } = useMe()
  if (loading) return null
  if (!me) return <Navigate to="/sign_in" replace />
  // admin: adminOnly 画面は常に閲覧可、feature 画面は明示的に false のときだけ不可
  if (me.admin) {
    if (adminOnly) return <>{children}</>
    if (!feature || me.feature_flags?.[feature] !== false) return <>{children}</>
    return <Navigate to={firstVisiblePath(me)} replace />
  }
  if (adminOnly) return <Navigate to={firstVisiblePath(me)} replace />
  if (!feature || me.feature_flags?.[feature]) return <>{children}</>
  return <Navigate to={firstVisiblePath(me)} replace />
}
const BRAND = '進捗管理システム'
const SEEN_BELL_KEY = 'bellSeenApplicationIds'
const appKey = (s: SubmissionLite) => `${s.kind}-${s.id}`

function Layout({ children }: { children: React.ReactNode }) {
  const { me } = useMe()
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem('sidebarOpen')
    if (stored !== null) return stored === 'true'
    return window.innerWidth >= 768 // スマホは初期閉じ(コンテンツを潰さない)。☰で開閉可
  })
  const [pendingApplications, setPendingApplications] = useState<SubmissionLite[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  // 全ユーザー共通の設定モーダル（振込先などの請求書設定・アカウント設定）をヘッダーから開く
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    localStorage.setItem('sidebarOpen', String(sidebarOpen))
  }, [sidebarOpen])

  // スマホは遷移したらサイドバーを閉じる（重なったまま残ると本文が読めない）。
  // md以上は常設なので閉じない。
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [loc.pathname])

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
      {/* スマホでサイドバーを開いている間の背景。タップで閉じる */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="サイドバーを閉じる"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar
          スマホ: 本文の上に重ねる(fixed)。幅を取らないので本文が潰れない。
          md以上: 従来どおり本文の左に並べる(sticky)。 */}
      <aside
        className={`bg-white flex flex-col h-screen overflow-hidden z-40 fixed top-0 left-0 transition-transform duration-200 ease-out
          md:sticky md:z-auto md:shrink-0 md:translate-x-0 md:transition-[width] ${
          sidebarOpen
            ? 'w-56 border-r border-[var(--color-border)] translate-x-0'
            : 'w-56 -translate-x-full md:w-0 md:border-r-0'
        }`}
        aria-hidden={!sidebarOpen}
      >
        <Link to="/" className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border)] min-w-[14rem]">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] shadow-md shrink-0" />
          <div className="text-sm font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap">進捗管理システム</div>
        </Link>
        <nav className="flex-1 px-3 py-3 space-y-0.5 min-w-[14rem]">
          {NAV.filter((n) => navVisible(n, me)).map((n) => {
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
          <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
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
            <div className="ml-auto flex items-center gap-2 sm:gap-4">
              <div className="hidden max-w-[140px] truncate whitespace-nowrap text-sm text-[var(--color-text-sub)] sm:block">{me?.display_name ?? me?.email ?? '—'}</div>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="設定（請求書・振込先など）"
                className="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-[var(--color-bg)] sm:px-3"
              >
                ⚙<span className="hidden sm:inline"> 設定</span>
              </button>
              <button
                onClick={async () => {
                  await signOut()
                  clearMeCache()
                  nav('/sign_in')
                }}
                className="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-sub)] hover:bg-[var(--color-bg)] sm:px-3"
              >
                ログアウト
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-3 py-4 sm:px-6 sm:py-6 min-w-0">{children}</main>
      </div>
      <SettingsModal
        open={settingsOpen}
        initialTab="account"
        year={new Date().getFullYear()}
        month={new Date().getMonth() + 1}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setSettingsOpen(false)}
      />
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
            {isMobileAppShell() ? (
              // iOS/Android アプリはトップ=経費計上（カレンダーはサイドバーの /calendar から見れる）
              <Navigate to="/keihi" replace />
            ) : (
              <Navigate to="/calendar" replace />
            )}
          </RequireAuth>
        }
      />
      <Route
        path="/attendance"
        element={
          <RequireAuth>
            <RequireFeature feature="attendance">
              <Layout>
                <Dashboard />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/keihi"
        element={
          <RequireAuth>
            <RequireFeature feature="keihi">
              <Layout>
                <BusinessExpensesPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <RequireFeature feature="progress">
              <Layout>
                <ProgressPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/calendar"
        element={
          <RequireAuth>
            <RequireFeature feature="calendar">
              <Layout>
                <CalendarPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <RequireFeature adminOnly>
              <Layout>
                <UsersPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/skill-sheets"
        element={
          <RequireAuth>
            <RequireFeature feature="skill_sheet">
              <Layout>
                <SkillSheetsPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/backlog-activities"
        element={
          <RequireAuth>
            <RequireFeature feature="backlog_activities">
              <Layout>
                <BacklogActivitiesPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/git"
        element={
          <RequireAuth>
            <RequireFeature feature="backlog_activities">
              <Layout>
                <GitPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/interview-mindmap"
        element={
          <RequireAuth>
            <RequireFeature feature="interview_mindmap">
              <Layout>
                <InterviewMindmapPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/video-studio"
        element={
          <RequireAuth>
            <RequireFeature feature="video_studio">
              <Layout>
                <VideoStudioPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/purchase-orders"
        element={
          <RequireAuth>
            <RequireFeature feature="purchase_orders">
              <Layout>
                <PurchaseOrdersPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route
        path="/invoices"
        element={
          <RequireAuth>
            <RequireFeature feature="invoices">
              <Layout>
                <InvoicesPage />
              </Layout>
            </RequireFeature>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
