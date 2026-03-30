import { Link } from 'react-router-dom'
import { useUserStore } from '../store/useUserStore'
import { Video, User, Crown, Bell, ShieldCheck } from 'lucide-react'
import { useUnreadNotificationCount } from '../hooks/useUnreadNotificationCount'

export default function Header() {
  const { user, isLoggedIn, isHydrated } = useUserStore()
  const unreadCount = useUnreadNotificationCount()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/78 backdrop-blur-md border-b border-sky-100 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="max-w-[1200px] mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-[0_8px_20px_rgba(37,99,235,0.35)] group-hover:scale-[1.03] transition-transform">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-slate-900">V-SAVE</span>
        </Link>

        {/* 右侧操作 */}
        <div className="flex items-center gap-3">
          {isHydrated && isLoggedIn && user ? (
            <>
              {user.role === 'SUPER_ADMIN' && (
                <Link
                  to="/admin?tab=runtime"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  后台管理
                </Link>
              )}
              <Link
                to="/vip"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors"
              >
                <Crown className="w-4 h-4" />
                <span>会员中心</span>
              </Link>
              <Link
                to="/user"
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center">
                  <User className="w-4 h-4 text-sky-600" />
                </div>
                <span>{user.name}</span>
              </Link>
              <Link
                to="/user?tab=notifications"
                className="relative p-2 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="通知中心"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </>
          ) : isHydrated ? (
            <>
              <Link
                to="/login"
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-sky-600 transition-colors"
              >
                登录
              </Link>
              <Link
                to="/register"
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl hover:from-sky-600 hover:to-blue-700 transition-colors shadow-[0_8px_18px_rgba(37,99,235,0.3)]"
              >
                注册
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
