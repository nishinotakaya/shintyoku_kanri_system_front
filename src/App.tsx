import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import AuthCallback from './pages/AuthCallback'
import Dashboard from './pages/Dashboard'
import ProgressPage from './pages/ProgressPage'
import CalendarPage from './pages/CalendarPage'
import { fetchMe, isAuthed, signOut } from './lib/auth'
import type { Me } from './lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthed()) return <Navigate to="/sign_in" replace />
  return <>{children}</>
}

const NAV = [
  { to: '/', label: 'カレンダー' },
  { to: '/attendance', label: '勤怠' },
  { to: '/progress', label: '進捗管理' },
]

function Layout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(() => {
    fetchMe().then(setMe)
  }, [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-white border-b border-[var(--color-border)] shadow-sm">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-light)] shadow-md" />
              <div className="text-lg font-bold tracking-tight text-[var(--color-text)]">進捗管理システム</div>
            </Link>
            <nav className="flex gap-1">
              {NAV.map((n) => {
                const active = loc.pathname === n.to
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                        : 'text-[var(--color-text-sub)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)]'
                    }`}
                  >
                    {n.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
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
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
