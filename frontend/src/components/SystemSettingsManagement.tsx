import { useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { api } from '../lib/api'
import { setPublicSystemSettingsCache } from '../hooks/usePublicSystemSettings'

interface AdminSystemSettingsResponse {
  success?: boolean
  data?: {
    registrationEnabled?: boolean
  }
}

const normalizeRegistrationEnabled = (response: AdminSystemSettingsResponse | undefined) =>
  response?.data?.registrationEnabled === true

export default function SystemSettingsManagement() {
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [initialRegistrationEnabled, setInitialRegistrationEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const hasChanges = registrationEnabled !== initialRegistrationEnabled

  const loadSettings = async () => {
    try {
      setIsLoading(true)
      setError('')
      setSuccess('')
      const response = await api.get<AdminSystemSettingsResponse>('/admin/system-settings')
      const nextValue = normalizeRegistrationEnabled(response.data)
      setRegistrationEnabled(nextValue)
      setInitialRegistrationEnabled(nextValue)
      setPublicSystemSettingsCache({ registrationEnabled: nextValue })
    } catch (err) {
      console.error('获取系统设置失败:', err)
      setError('获取系统设置失败，请稍后重试。')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  const handleSave = async () => {
    try {
      setIsSaving(true)
      setError('')
      setSuccess('')
      const response = await api.put<AdminSystemSettingsResponse>('/admin/system-settings', {
        registrationEnabled,
      })
      const nextValue = normalizeRegistrationEnabled(response.data)
      setRegistrationEnabled(nextValue)
      setInitialRegistrationEnabled(nextValue)
      setPublicSystemSettingsCache({ registrationEnabled: nextValue })
      setSuccess('设置已保存')
    } catch (err) {
      console.error('保存系统设置失败:', err)
      setError('保存失败，请稍后重试。')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">系统设置</h1>
          <p className="text-sm text-text-secondary mt-1">
            控制是否向新用户开放注册入口。关闭后，网页端与移动端都会隐藏注册入口并拦截注册请求。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSettings()}
          disabled={isLoading || isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-text-secondary hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <label htmlFor="registration-enabled" className="text-base font-semibold text-text-primary">
              开放注册入口
            </label>
            <p className="mt-1 text-sm text-text-secondary">
              开启后访客可以注册账号；关闭后只有现有账号可以登录，注册页会自动跳回登录页。
            </p>
          </div>

          <label
            htmlFor="registration-enabled"
            className="inline-flex items-center gap-3 text-sm font-medium text-text-primary"
          >
            <span>{registrationEnabled ? '已开放' : '已关闭'}</span>
            <span className="relative inline-flex h-7 w-12 items-center">
              <input
                id="registration-enabled"
                aria-label="开放注册入口"
                type="checkbox"
                checked={registrationEnabled}
                disabled={isLoading || isSaving}
                onChange={(event) => {
                  setRegistrationEnabled(event.target.checked)
                  setError('')
                  setSuccess('')
                }}
                className="peer sr-only"
              />
              <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-500 peer-disabled:opacity-60" />
              <span className="absolute left-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </div>

        {isLoading && (
          <p className="mt-4 text-sm text-text-secondary">正在加载当前系统设置...</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-500">{error}</p>
        )}
        {success && (
          <p className="mt-4 text-sm text-emerald-600">{success}</p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isLoading || isSaving || !hasChanges}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </section>
  )
}
