import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import Sidebar from '../components/Sidebar'
import DownloadHistory from '../components/DownloadHistory'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  applyMarkAllNotificationsReadLocally,
  applyNotificationReadLocally,
} from '../lib/notification-state'
import { api } from '../lib/api'
import { useNotificationStore } from '../store/useNotificationStore'
import { useUserStore } from '../store/useUserStore'
import { User, Camera, Mail, RefreshCw, Trash2 } from 'lucide-react'

const MAX_AVATAR_UPLOAD_SIZE = 5 * 1024 * 1024
const MAX_AVATAR_RENDER_SIZE = 512
const AVATAR_OUTPUT_QUALITY = 0.85

interface NotificationItem {
  id: string
  userId: string | null
  type: string
  level: 'info' | 'success' | 'warn' | 'error'
  source: string
  title: string
  content: string
  actionUrl?: string | null
  isRead: boolean
  readAt?: string | null
  createdAt: string
}

const VALID_TABS = new Set(['profile', 'history', 'notifications', 'settings'])
const ADMIN_AUTH_NOTIFICATION_TYPES = new Set([
  'AUTH_RECOVERED',
  'COOKIE_RISK',
  'COOKIE_EXPIRED',
])

const resolveNotificationActionUrl = (
  actionUrl: string | null | undefined,
  type: string,
  isSuperAdmin: boolean,
) => {
  const target = String(actionUrl || '').trim()
  if (!target) {
    return '/user'
  }

  if (
    target === '/user?tab=auth'
    || (isSuperAdmin && ADMIN_AUTH_NOTIFICATION_TYPES.has(String(type || '').toUpperCase()))
  ) {
    return '/admin?tab=auth'
  }

  return target
}

const resizeImageToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()

      img.onerror = () => reject(new Error('解析图片失败'))
      img.onload = () => {
        const maxEdge = Math.max(img.width, img.height)
        const scale = maxEdge > MAX_AVATAR_RENDER_SIZE
          ? MAX_AVATAR_RENDER_SIZE / maxEdge
          : 1

        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持头像处理'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', AVATAR_OUTPUT_QUALITY))
      }

      img.src = String(reader.result)
    }

    reader.readAsDataURL(file)
  })
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export default function UserCenter() {
  const { user, isLoggedIn, isHydrated, logout, updateUser } = useUserStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = String(searchParams.get('tab') || '').trim()
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : 'profile'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [nickname, setNickname] = useState(user?.name || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [accountStatus, setAccountStatus] = useState(user?.accountStatus || 'ACTIVE')
  const [downloadCount, setDownloadCount] = useState(user?.downloadCount ?? 0)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [phoneMessage, setPhoneMessage] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [isBindingPhone, setIsBindingPhone] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationTotal, setNotificationTotal] = useState(0)
  const [notificationPage, setNotificationPage] = useState(1)
  const [notificationPageSize] = useState(20)
  const [notificationUnreadOnly, setNotificationUnreadOnly] = useState(false)
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [notificationPendingAction, setNotificationPendingAction] = useState<
    'markOne' | 'markAll' | 'clearAll' | null
  >(null)
  const [showClearNotificationsConfirm, setShowClearNotificationsConfirm] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const setUnreadNotificationCount = useNotificationStore((state) => state.setUnreadCount)
  const decrementUnreadNotificationCount = useNotificationStore(
    (state) => state.decrementUnreadCount,
  )

  const syncProfile = useCallback(async () => {
    if (!isLoggedIn) {
      return
    }

    try {
      const response = await api.get('/users/profile')
      const profile = response.data || {}
      const nextNickname = String(profile.nickname || user?.name || '').trim()
      const nextAvatar = String(profile.avatar || user?.avatar || '')
      const nextPhone = profile.phone || null
      const nextStatus = profile.accountStatus || user?.accountStatus || 'ACTIVE'
      const nextDownloadCount = Number(profile.downloadCount ?? user?.downloadCount ?? 0)

      setNickname(nextNickname)
      setAvatar(nextAvatar)
      setPhone(nextPhone || '')
      setAccountStatus(nextStatus)
      setDownloadCount(nextDownloadCount)
      updateUser({
        name: nextNickname || user?.name || '',
        avatar: nextAvatar || undefined,
        phone: nextPhone,
        accountStatus: nextStatus,
        downloadCount: nextDownloadCount,
      })
    } catch (error) {
      console.error('获取个人资料失败:', error)
    }
  }, [isLoggedIn, updateUser, user?.accountStatus, user?.avatar, user?.downloadCount, user?.name])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    if (!isLoggedIn) {
      navigate('/login')
      return
    }

    void syncProfile()
  }, [isHydrated, isLoggedIn, navigate, syncProfile])

  useEffect(() => {
    const nextParams =
      activeTab === 'profile'
        ? new URLSearchParams()
        : new URLSearchParams({ tab: activeTab })
    if (searchParams.toString() !== nextParams.toString()) {
      setSearchParams(nextParams, { replace: true })
    }
  }, [activeTab, searchParams, setSearchParams])

  const fetchNotifications = useCallback(async (options?: { page?: number; unreadOnly?: boolean }) => {
    if (!isLoggedIn) {
      return
    }

    const nextPage = Math.max(1, Number(options?.page || notificationPage) || 1)
    const nextUnreadOnly =
      typeof options?.unreadOnly === 'boolean' ? options.unreadOnly : notificationUnreadOnly

    try {
      setIsLoadingNotifications(true)
      setNotificationError('')

      const response = await api.get('/notifications', {
        params: {
          page: nextPage,
          pageSize: notificationPageSize,
          unreadOnly: nextUnreadOnly ? '1' : undefined,
        },
      })

      if (response.data?.success) {
        setNotifications((response.data?.data || []) as NotificationItem[])
        setNotificationTotal(Number(response.data?.meta?.total || 0))
        setNotificationPage(Number(response.data?.meta?.page || nextPage))
      }
    } catch (err) {
      console.error('获取通知列表失败:', err)
      setNotificationError('获取通知失败，请稍后重试')
    } finally {
      setIsLoadingNotifications(false)
    }
  }, [isLoggedIn, notificationPage, notificationPageSize, notificationUnreadOnly])

  useEffect(() => {
    if (activeTab === 'notifications') {
      void fetchNotifications()
    }
  }, [activeTab, fetchNotifications])

  const handleMarkNotificationRead = useCallback(async (id: string) => {
    const target = notifications.find((item) => item.id === id)
    if (!target || target.isRead) {
      return
    }

    try {
      setNotificationPendingAction('markOne')
      setNotificationError('')
      await api.patch(`/notifications/${id}/read`)
      const readAt = new Date().toISOString()
      setNotifications((prev) => applyNotificationReadLocally(prev, {
        id,
        unreadOnly: notificationUnreadOnly,
        readAt,
      }))
      decrementUnreadNotificationCount()

      if (notificationUnreadOnly) {
        setNotificationTotal((prev) => Math.max(prev - 1, 0))
      }
    } catch (err) {
      console.error('标记通知已读失败:', err)
      setNotificationError('标记已读失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [decrementUnreadNotificationCount, notificationUnreadOnly, notifications])

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try {
      setNotificationPendingAction('markAll')
      setNotificationError('')
      await api.patch('/notifications/read-all')
      const readAt = new Date().toISOString()
      setNotifications((prev) => applyMarkAllNotificationsReadLocally(prev, {
        unreadOnly: notificationUnreadOnly,
        readAt,
      }))
      setUnreadNotificationCount(0)

      if (notificationUnreadOnly) {
        setNotificationTotal(0)
        setNotificationPage(1)
      }
    } catch (err) {
      console.error('全部标记已读失败:', err)
      setNotificationError('全部标记已读失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [notificationUnreadOnly, setUnreadNotificationCount])

  const handleClearAllNotifications = useCallback(async () => {
    try {
      setNotificationPendingAction('clearAll')
      setShowClearNotificationsConfirm(false)
      setNotificationError('')
      await api.delete('/notifications/clear')
      setNotifications([])
      setNotificationTotal(0)
      setNotificationPage(1)
      setUnreadNotificationCount(0)
    } catch (err) {
      console.error('清空通知失败:', err)
      setNotificationError('清空通知失败，请稍后重试')
    } finally {
      setNotificationPendingAction(null)
    }
  }, [setUnreadNotificationCount])

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setSaveError('请选择图片文件')
      return
    }

    if (file.size > MAX_AVATAR_UPLOAD_SIZE) {
      setSaveError('头像图片不能超过 5MB')
      return
    }

    try {
      setIsUploadingAvatar(true)
      setSaveError('')
      const dataUrl = await resizeImageToDataUrl(file)
      setAvatar(dataUrl)
    } catch (error) {
      console.error('头像处理失败:', error)
      setSaveError('头像处理失败，请重试')
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  const handleSaveProfile = async () => {
    try {
      setIsSaving(true)
      setSaveMessage('')
      setSaveError('')

      const response = await api.patch('/users/profile', {
        nickname: nickname.trim(),
        avatar,
      })
      const payload = response.data || {}
      const nextNickname = payload.nickname || nickname.trim()
      const nextAvatar = payload.avatar || avatar
      const nextPhone = payload.phone || phone || null
      const nextStatus = payload.accountStatus || accountStatus
      const nextDownloadCount = Number(payload.downloadCount ?? downloadCount)

      setNickname(nextNickname)
      setAvatar(nextAvatar)
      setPhone(nextPhone || '')
      setAccountStatus(nextStatus)
      setDownloadCount(nextDownloadCount)
      updateUser({
        name: nextNickname,
        avatar: nextAvatar || undefined,
        phone: nextPhone,
        accountStatus: nextStatus,
        downloadCount: nextDownloadCount,
      })
      setSaveMessage('个人资料已更新')
    } catch (error: any) {
      console.error('更新个人资料失败:', error)
      const message = error?.response?.data?.message
      setSaveError(Array.isArray(message) ? message[0] : message || '更新失败，请稍后重试')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordError('请完整填写密码信息')
      setPasswordMessage('')
      return
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError('两次输入的新密码不一致')
      setPasswordMessage('')
      return
    }

    try {
      setIsChangingPassword(true)
      setPasswordError('')
      setPasswordMessage('')
      await api.patch('/users/account/password', {
        currentPassword,
        newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setPasswordMessage('密码修改成功')
    } catch (error: any) {
      console.error('修改密码失败:', error)
      const message = error?.response?.data?.message
      setPasswordError(Array.isArray(message) ? message[0] : message || '修改密码失败，请稍后重试')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleBindPhone = async () => {
    if (!phone.trim()) {
      setPhoneError('请输入手机号')
      setPhoneMessage('')
      return
    }

    try {
      setIsBindingPhone(true)
      setPhoneError('')
      setPhoneMessage('')
      const response = await api.patch('/users/account/phone', {
        phone: phone.trim(),
      })
      const payload = response.data || {}
      const nextPhone = payload.phone || phone.trim()
      setPhone(nextPhone)
      updateUser({ phone: nextPhone })
      setPhoneMessage('手机号已更新')
    } catch (error: any) {
      console.error('绑定手机号失败:', error)
      const message = error?.response?.data?.message
      setPhoneError(Array.isArray(message) ? message[0] : message || '绑定手机号失败，请稍后重试')
    } finally {
      setIsBindingPhone(false)
    }
  }

  if (!isHydrated || !isLoggedIn || !user) {
    return null
  }

  const renderProfileTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="relative">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="relative w-28 h-28 rounded-3xl overflow-hidden border border-sky-100 bg-sky-50"
            >
              {avatar ? (
                <img src={avatar} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-12 h-12 text-sky-500" />
                </div>
              )}
              <span className="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-slate-900/85 text-white flex items-center justify-center">
                <Camera className="w-4 h-4" />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">{nickname || user.name}</h1>
              <p className="mt-1 text-sm text-text-secondary flex items-center gap-2">
                <Mail className="w-4 h-4" />
                {user.email}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-wide text-text-secondary">角色</div>
                <div className="mt-2 font-semibold text-text-primary">
                  {user.role === 'SUPER_ADMIN' ? '超级管理员' : '普通用户'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-wide text-text-secondary">账号状态</div>
                <div className="mt-2 font-semibold text-text-primary">
                  {accountStatus === 'DISABLED' ? '已禁用' : '启用中'}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-wide text-text-secondary">累计下载</div>
                <div className="mt-2 font-semibold text-text-primary">{downloadCount}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">个人资料</h2>
            <p className="text-sm text-text-secondary mt-1">昵称、头像和手机号会同步到当前账号资料。</p>
          </div>
          <button
            type="button"
            onClick={() => void syncProfile()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm text-text-primary"
          >
            <RefreshCw className="w-4 h-4" />
            刷新资料
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">昵称</label>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-gray-200"
              placeholder="请输入昵称"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">手机号</label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-gray-200"
              placeholder="未绑定可直接输入"
            />
          </div>
        </div>
        {(saveMessage || saveError) && (
          <p className={`mt-4 text-sm ${saveError ? 'text-red-500' : 'text-emerald-600'}`}>
            {saveError || saveMessage}
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={isSaving || isUploadingAvatar}
            onClick={() => void handleSaveProfile()}
            className="px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {isSaving ? '保存中...' : isUploadingAvatar ? '处理中...' : '保存资料'}
          </button>
        </div>
      </div>
    </div>
  )

  const renderNotificationsTab = () => (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">通知中心</h2>
          <p className="text-sm text-text-secondary mt-1">查看系统通知、登录态告警和账号安全提醒。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setNotificationUnreadOnly((prev) => !prev)
              setNotificationPage(1)
              void fetchNotifications({ page: 1, unreadOnly: !notificationUnreadOnly })
            }}
            className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm text-text-primary"
          >
            {notificationUnreadOnly ? '查看全部' : '仅看未读'}
          </button>
          <button
            type="button"
            disabled={notificationPendingAction !== null}
            onClick={() => void handleMarkAllNotificationsRead()}
            className="px-3 py-2 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 text-sm disabled:opacity-60"
          >
            全部已读
          </button>
          <button
            type="button"
            disabled={notificationPendingAction !== null}
            onClick={() => setShowClearNotificationsConfirm(true)}
            className="px-3 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 text-sm disabled:opacity-60"
          >
            清空通知
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-text-secondary">
        共 {notificationTotal} 条通知，第 {notificationPage} 页
      </p>
      {notificationError && <p className="mt-3 text-sm text-red-500">{notificationError}</p>}

      <div className="mt-4 space-y-3">
        {isLoadingNotifications && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
            通知加载中...
          </div>
        )}
        {!isLoadingNotifications && notifications.length === 0 && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-text-secondary">
            当前没有通知
          </div>
        )}
        {!isLoadingNotifications && notifications.map((item) => (
          <div
            key={item.id}
            className={`rounded-xl border p-4 ${
              item.isRead ? 'border-gray-100 bg-white' : 'border-sky-100 bg-sky-50/40'
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary">{item.title}</h3>
                  {!item.isRead && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-xs font-medium">
                      未读
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">{item.content}</p>
                <p className="mt-3 text-xs text-text-secondary">
                  {formatDateTime(item.createdAt)} ｜ 来源：{item.source}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {item.actionUrl && (
                  <button
                    type="button"
                    onClick={() => navigate(resolveNotificationActionUrl(item.actionUrl, item.type, isSuperAdmin))}
                    className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm text-text-primary"
                  >
                    去处理
                  </button>
                )}
                {!item.isRead && (
                  <button
                    type="button"
                    disabled={notificationPendingAction !== null}
                    onClick={() => void handleMarkNotificationRead(item.id)}
                    className="px-3 py-2 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 text-sm disabled:opacity-60"
                  >
                    标记已读
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderSettingsTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
        <h2 className="text-lg font-semibold text-text-primary">绑定手机号</h2>
        <p className="text-sm text-text-secondary mt-1">手机号仅用于账号资料展示与后续安全通知。</p>
        <div className="mt-4 flex flex-col md:flex-row gap-3">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="flex-1 h-11 px-4 rounded-xl border border-gray-200"
            placeholder="请输入 11 位大陆手机号"
          />
          <button
            type="button"
            disabled={isBindingPhone}
            onClick={() => void handleBindPhone()}
            className="px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {isBindingPhone ? '保存中...' : '保存手机号'}
          </button>
        </div>
        {(phoneMessage || phoneError) && (
          <p className={`mt-3 text-sm ${phoneError ? 'text-red-500' : 'text-emerald-600'}`}>
            {phoneError || phoneMessage}
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
        <h2 className="text-lg font-semibold text-text-primary">修改密码</h2>
        <p className="text-sm text-text-secondary mt-1">修改后请使用新密码重新登录。</p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="h-11 px-4 rounded-xl border border-gray-200"
            placeholder="当前密码"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="h-11 px-4 rounded-xl border border-gray-200"
            placeholder="新密码"
          />
          <input
            type="password"
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            className="h-11 px-4 rounded-xl border border-gray-200"
            placeholder="确认新密码"
          />
        </div>
        {(passwordMessage || passwordError) && (
          <p className={`mt-3 text-sm ${passwordError ? 'text-red-500' : 'text-emerald-600'}`}>
            {passwordError || passwordMessage}
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={isChangingPassword}
            onClick={() => void handleChangePassword()}
            className="px-5 py-2.5 rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {isChangingPassword ? '提交中...' : '修改密码'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6">
        <h2 className="text-lg font-semibold text-text-primary">退出登录</h2>
        <p className="text-sm text-text-secondary mt-1">退出后会清除当前浏览器中的登录态。</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              logout()
              navigate('/')
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
          >
            <Trash2 className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-12 px-4">
        <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-64 shrink-0">
            <Sidebar
              activeTab={activeTab}
              onTabChange={(tab) => {
                const nextParams =
                  tab === 'profile'
                    ? new URLSearchParams()
                    : new URLSearchParams({ tab })
                setSearchParams(nextParams)
              }}
            />
          </div>

          <div className="flex-1 min-w-0">
            {activeTab === 'profile' && renderProfileTab()}
            {activeTab === 'history' && <DownloadHistory />}
            {activeTab === 'notifications' && renderNotificationsTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={showClearNotificationsConfirm}
        title="确认清空通知"
        description="该操作会删除当前账号下的全部通知记录，且无法恢复。"
        confirmText="确认清空"
        cancelText="取消"
        onConfirm={() => void handleClearAllNotifications()}
        onCancel={() => setShowClearNotificationsConfirm(false)}
        variant="danger"
      />
    </div>
  )
}
