import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import ProgressPage from './pages/ProgressPage'
import CalendarPage from './pages/CalendarPage'
import UsersPage from './pages/UsersPage'
import { fetchMe, isAuthed, signOut } from './lib/auth'
import type { Me } from './lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthed()) return <Navigate to="/sign_in" replace />
  return <>{children}</>
}

type NavItem = { to: string; label: string; icon: string; adminOnly?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'カレンダー', icon: '📅' },
  { to: '/attendance', label: '勤怠', icon: '🕒' },
  { to: '/progress', label: '進捗管理', icon: '📊' },
  { to: '/users', label: 'ユーザー一覧', icon: '👥', adminOnly: true },
]

function Layout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => {
    fetchMe().then(setMe)
  }, [])

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[var(--color-border)] bg-white flex flex-col sticky top-0 h-screen">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--color-border)]">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] shadow-md" />
          <div className="text-sm font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap">進捗管理システム</div>
        </Link>
        <nav className="flex-1 px-3 py-3 space-y-0.5">
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
          <div className="flex items-center justify-end gap-4 px-6 py-3">
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
