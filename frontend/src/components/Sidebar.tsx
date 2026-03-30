import { Link, useLocation, useNavigate } from 'react-router-dom'
import { User, Download, Settings, Bell, LogOut } from 'lucide-react'
import { useUserStore } from '../store/useUserStore'

interface SidebarProps {
  activeTab?: string
  onTabChange?: (tab: string) => void
}

const baseMenuItems = [
  { id: 'profile', label: '个人资料', icon: User, path: '/user' },
  { id: 'history', label: '下载历史', icon: Download, path: '/user?tab=history' },
  { id: 'notifications', label: '通知中心', icon: Bell, path: '/user?tab=notifications' },
  { id: 'settings', label: '账户设置', icon: Settings, path: '/user?tab=settings' },
]

export default function Sidebar({ activeTab = 'profile', onTabChange }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useUserStore((state) => ({
    logout: state.logout,
  }))
  const menuItems = baseMenuItems

  const getActiveTab = () => {
    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    if (tab) return tab
    return activeTab
  }

  const currentTab = getActiveTab()

  return (
    <aside className="w-full md:w-64 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4">
      <nav className="space-y-1">
        {menuItems.map((item) => {
          const isActive = currentTab === item.id
          return (
            <Link
              key={item.id}
              to={item.path}
              onClick={(e) => {
                if (onTabChange && item.path.startsWith('/user')) {
                  e.preventDefault()
                  onTabChange(item.id)
                }
              }}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
                ${isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-secondary hover:bg-gray-50 hover:text-text-primary'
                }
              `}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-6 pt-6 border-t border-gray-100">
        <button
          onClick={() => {
            logout()
            navigate('/')
          }}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-text-secondary hover:bg-red-50 hover:text-red-500 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span>退出登录</span>
        </button>
      </div>
    </aside>
  )
}
