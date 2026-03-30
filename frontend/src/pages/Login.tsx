import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import axios from 'axios'
import { useUserStore } from '../store/useUserStore'
import { api, mapApiUserToStoreUser, type AuthResponse } from '../lib/api'
import AuthLayout from '../components/AuthLayout'

const REMEMBER_PASSWORD_STORAGE_KEY = 'remembered-login-credentials'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const login = useUserStore((state) => state.login)
  const isLoggedIn = useUserStore((state) => state.isLoggedIn)
  const isHydrated = useUserStore((state) => state.isHydrated)
  const navigate = useNavigate()

  useEffect(() => {
    if (isHydrated && isLoggedIn) {
      navigate('/', { replace: true })
    }
  }, [isHydrated, isLoggedIn, navigate])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const raw = localStorage.getItem(REMEMBER_PASSWORD_STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const parsed = JSON.parse(raw) as {
        email?: string
        password?: string
      }
      setEmail(typeof parsed.email === 'string' ? parsed.email : '')
      setPassword(typeof parsed.password === 'string' ? parsed.password : '')
      setRememberPassword(true)
    } catch {
      localStorage.removeItem(REMEMBER_PASSWORD_STORAGE_KEY)
    }
  }, [isHydrated])

  if (!isHydrated || isLoggedIn) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await api.post<AuthResponse>('/auth/login', {
        email,
        password,
      })

      const { access_token, user } = response.data
      if (rememberPassword) {
        localStorage.setItem(
          REMEMBER_PASSWORD_STORAGE_KEY,
          JSON.stringify({
            email: email.trim(),
            password,
          })
        )
      } else {
        localStorage.removeItem(REMEMBER_PASSWORD_STORAGE_KEY)
      }
      login(mapApiUserToStoreUser(user), access_token)
      navigate('/')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message = err.response?.data?.message
        if (Array.isArray(message)) {
          setError(message[0] || '登录失败，请检查邮箱和密码')
        } else if (typeof message === 'string') {
          setError(message)
        } else {
          setError('登录失败，请检查邮箱和密码')
        }
      } else {
        setError('登录失败，请稍后重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout
      badge="账号登录"
      title="欢迎回来，继续你的下载流程"
      subtitle="登录后可同步下载历史、接收通知，并使用更完整的多平台下载能力。"
      featureTitle="登录后可获得"
      featureDescription="系统会自动同步你的下载任务与账户状态，减少重复配置与重复解析。"
      featurePoints={['多平台解析与下载历史同步', '通知中心实时提醒关键状态', '会员档位和权限自动识别']}
      bottomHint="登录后可享受更完整的下载能力与状态同步"
    >
      <h1 className="text-2xl font-extrabold text-slate-900 text-center mb-2">登录账号</h1>
      <p className="text-slate-500 text-center mb-7">请输入邮箱和密码继续</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">邮箱</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all outline-none"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">密码</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full h-12 pl-12 pr-12 bg-slate-50 border border-slate-200 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all outline-none"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {error && <p className="text-rose-500 text-sm text-center">{error}</p>}

        <label className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-700 hover:border-sky-300 hover:bg-sky-50/70 cursor-pointer transition-colors">
          <span className="relative inline-flex h-5 w-5 items-center justify-center">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
              className="peer sr-only"
            />
            <span className="h-5 w-5 rounded-md border border-slate-300 bg-white transition-all peer-checked:border-sky-500 peer-checked:bg-gradient-to-br peer-checked:from-sky-500 peer-checked:to-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500/40" />
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100"
              aria-hidden="true"
            >
              <path
                d="M5 10.5L8.2 13.5L15 6.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>记住密码</span>
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full h-12 text-white font-semibold rounded-xl disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-[0_12px_24px_rgba(37,99,235,0.32)] disabled:opacity-75"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              登录中...
            </>
          ) : (
            <>
              登录
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        还没有账号？{' '}
        <Link to="/register" className="text-sky-600 font-semibold hover:underline">
          立即注册
        </Link>
      </div>
    </AuthLayout>
  )
}
