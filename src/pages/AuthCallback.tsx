import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const nav = useNavigate()

  useEffect(() => {
    const token = params.get('token')
    if (token) {
      localStorage.setItem('jwt', token)
      nav('/', { replace: true })
    } else {
      nav('/sign_in?error=auth_failed', { replace: true })
    }
  }, [params, nav])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--color-text-sub)]">ログイン処理中...</div>
    </div>
  )
}
