import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import axios from 'axios'
import { useUserStore } from '../store/useUserStore'
import { api, mapApiUserToStoreUser, type AuthResponse } from '../lib/api'
import AuthLayout from '../components/AuthLayout'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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

  if (!isHydrated || isLoggedIn) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 验证密码匹配
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    // 验证密码强度
    if (password.length < 6) {
      setError('密码长度至少为6位')
      return
    }

    setIsLoading(true)

    try {
      const response = await api.post<AuthResponse>('/auth/register', {
        email,
        password,
        nickname: name,
      })

      const { access_token, user } = response.data
      login(mapApiUserToStoreUser(user), access_token)
      navigate('/')
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message = err.response?.data?.message
        if (Array.isArray(message)) {
          setError(message[0] || '注册失败，请稍后重试')
        } else if (typeof message === 'string') {
          setError(message)
        } else {
          setError('注册失败，请稍后重试')
        }
      } else {
        setError('注册失败，请稍后重试')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout
      badge="账号注册"
      title="创建账号，开启 V-SAVE"
      subtitle="注册后立即拥有个人下载空间，解析记录、会员状态、通知中心统一管理。"
      featureTitle="注册后可获得"
      featureDescription="从首次下载开始，系统将自动跟踪你的下载历史与会员权限，减少重复操作。"
      featurePoints={['个人下载历史自动保存', '会员状态与过期提醒可见', '后台通知统一接收关键变更']}
      bottomHint="注册后可直接进入首页开始解析下载"
    >
      <h1 className="text-2xl font-extrabold text-slate-900 text-center mb-2">注册账号</h1>
      <p className="text-slate-500 text-center mb-7">创建你的账号，开始下载之旅</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">昵称</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入昵称"
              className="w-full h-12 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all outline-none"
              required
            />
          </div>
        </div>

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
              placeholder="请输入密码（至少6位）"
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

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-2">确认密码</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入密码"
              className="w-full h-12 pl-12 pr-12 bg-slate-50 border border-slate-200 rounded-xl focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:bg-white transition-all outline-none"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {error && <p className="text-rose-500 text-sm text-center">{error}</p>}

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
              注册中...
            </>
          ) : (
            <>
              注册
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-slate-500">
        已有账号？{' '}
        <Link to="/login" className="text-sky-600 font-semibold hover:underline">
          立即登录
        </Link>
      </div>
    </AuthLayout>
  )
}
