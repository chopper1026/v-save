import { useState, useEffect } from 'react'
import { Play, Trash2, RefreshCw, CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react'
import { api, toProxyUrl } from '../lib/api'
import { VIDEO_PLACEHOLDER_URL } from '../lib/assets'
import {
  resolveHistoryRedownloadDownloadUrl,
  resolveWebDownloadRequestUrl,
  type HistoryParsedVideo,
} from '../lib/history-redownload'
import { createRuntimeTraceId } from '../lib/runtime-monitor'
import { useUserStore } from '../store/useUserStore'
import ConfirmDialog from './ConfirmDialog'

// 后端返回的下载历史数据类型
interface DownloadHistoryItem {
  id: string
  videoTitle: string
  videoUrl: string
  sourceUrl?: string | null
  platform: string
  coverUrl: string
  format: string
  quality: string
  downloadUrl: string
  status: string
  createdAt: string
}

// 前端显示用的数据类型
interface DownloadItem {
  id: string
  title: string
  sourceUrl?: string
  videoUrl: string
  thumbnail: string
  platform: string
  platformKey: string
  date: string
  status: 'completed' | 'pending' | 'failed'
  duration?: string
  quality?: string
  downloadUrl?: string
}

interface DownloadHistoryResponse {
  success: boolean
  data: DownloadHistoryItem[]
  meta?: {
    total?: number
  }
  stats?: {
    total?: number
    byPlatform?: Record<string, number>
  }
}

const platformColors: Record<string, string> = {
  douyin: 'bg-pink-100 text-pink-600',
  bilibili: 'bg-blue-100 text-blue-600',
  kuaishou: 'bg-orange-100 text-orange-600',
  xiaohongshu: 'bg-red-100 text-red-600',
  youtube: 'bg-red-100 text-red-600',
}

const platformNames: Record<string, string> = {
  douyin: '抖音',
  bilibili: 'B站',
  kuaishou: '快手',
  xiaohongshu: '小红书',
  youtube: 'YouTube',
}

const statusConfig = {
  completed: { icon: CheckCircle, color: 'text-green-500', label: '已完成' },
  pending: { icon: Clock, color: 'text-yellow-500', label: '处理中' },
  failed: { icon: AlertCircle, color: 'text-red-500', label: '失败' },
}

const PAGE_SIZE_OPTIONS = [12, 24, 48]
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]
const PLATFORM_FILTER_OPTIONS = [
  { value: 'all', label: '全部平台' },
  { value: 'douyin', label: '抖音' },
  { value: 'bilibili', label: 'B站' },
  { value: 'kuaishou', label: '快手' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'youtube', label: 'YouTube' },
]

const normalizeCoverUrl = (url: string): string => {
  if (!url) {
    return ''
  }

  let normalized = url
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`
  }

  return normalized
}

// 转换后端数据为前端格式
const transformHistoryItem = (item: DownloadHistoryItem): DownloadItem => {
  const rawCoverUrl = normalizeCoverUrl(item.coverUrl || '')
  const proxyCoverUrl = rawCoverUrl
    ? toProxyUrl(rawCoverUrl, 'image')
    : VIDEO_PLACEHOLDER_URL

  return {
    id: item.id,
    title: item.videoTitle,
    sourceUrl: item.sourceUrl || '',
    videoUrl: item.videoUrl || '',
    thumbnail: proxyCoverUrl,
    platform: platformNames[item.platform] || item.platform,
    platformKey: item.platform,
    date: new Date(item.createdAt).toLocaleString('zh-CN'),
    status: (item.status as 'completed' | 'pending' | 'failed') || 'completed',
    quality: item.quality || '720p',
    downloadUrl: item.downloadUrl,
  }
}

export default function DownloadHistory() {
  const [history, setHistory] = useState<DownloadItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null)
  const [isClearingAll, setIsClearingAll] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [jumpPageInput, setJumpPageInput] = useState('1')
  const [totalCount, setTotalCount] = useState(0)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const isLoggedIn = useUserStore((state) => state.isLoggedIn)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const buildQueryParams = (page: number, size: number = pageSize) => {
    const offset = Math.max(0, (page - 1) * size)
    return {
      limit: size,
      offset,
      platform: platformFilter !== 'all' ? platformFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }
  }

  const fetchHistory = async (page: number, size: number = pageSize) => {
    setIsLoading(true)
    setError(null)

    if (!isLoggedIn) {
      setError('请先登录')
      setIsLoading(false)
      return
    }

    try {
      const response = await api.get<DownloadHistoryResponse>('/download/history', {
        params: buildQueryParams(page, size),
      })

      if (response.data?.success && Array.isArray(response.data?.data)) {
        const transformedData = response.data.data.map(transformHistoryItem)
        setHistory(transformedData)
        const total = Number(
          response.data?.meta?.total
            ?? response.data?.stats?.total
            ?? transformedData.length
            ?? 0,
        )
        setTotalCount(total)
        setJumpPageInput(String(page))
        setError(null)
      } else {
        setError('获取历史记录失败')
      }
    } catch (err) {
      console.error('获取下载历史失败:', err)
      setError('获取历史记录失败，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }

  // 加载下载历史
  useEffect(() => {
    void fetchHistory(currentPage, pageSize)
  }, [currentPage, isLoggedIn, pageSize, platformFilter, dateFrom, dateTo])

  useEffect(() => {
    setCurrentPage(1)
    setJumpPageInput('1')
  }, [platformFilter, dateFrom, dateTo])

  const handleDelete = async (id: string) => {
    try {
      setDeletingId(id)
      await api.delete(`/download/history/${id}`)
      const hasSingleItemOnPage = history.length === 1
      const hasPreviousPage = currentPage > 1
      if (hasSingleItemOnPage && hasPreviousPage) {
        setCurrentPage((prev) => prev - 1)
      } else {
        void fetchHistory(currentPage, pageSize)
      }
    } catch (err) {
      console.error('删除下载记录失败:', err)
      setError('删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

  const handleClearAll = async () => {
    if (isClearingAll) {
      return
    }

    try {
      setIsClearingAll(true)
      setShowClearConfirm(false)
      await api.delete('/download/history')
      if (currentPage !== 1) {
        setCurrentPage(1)
      } else {
        void fetchHistory(1, pageSize)
      }
    } catch (err) {
      console.error('清空下载历史失败:', err)
      setError('清空失败，请稍后重试')
    } finally {
      setIsClearingAll(false)
    }
  }

  const handleRedownload = async (item: DownloadItem) => {
    try {
      setRedownloadingId(item.id)
      setError(null)

      const runtimeTraceId = createRuntimeTraceId('download')
      const downloadUrl = await resolveHistoryRedownloadDownloadUrl({
        item,
        clientType: 'WEB',
        parseVideo: async (sourceUrl) => {
          const response = await api.post(
            '/download/parse',
            {
              url: sourceUrl,
              clientType: 'WEB',
            },
            {
              headers: {
                'x-runtime-trace-id': runtimeTraceId,
              },
            },
          )
          return (response.data?.data || null) as HistoryParsedVideo | null
        },
        getDownloadUrl: async (payload) => {
          const response = await api.post('/download/get-url', payload, {
            timeout: 90000,
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          })
          return response.data?.data || null
        },
      })

      const target = resolveWebDownloadRequestUrl(downloadUrl, {
        runtimeTraceId,
        currentOrigin: window.location.origin,
        currentHostname: window.location.hostname,
      })
      window.open(target, '_blank', 'noopener,noreferrer')
    } catch (err) {
      console.error('重新下载失败:', err)
      const message =
        err instanceof Error && err.message
          ? err.message
          : '重新下载失败，请稍后重试'
      setError(message)
    } finally {
      setRedownloadingId(null)
    }
  }

  const handleJumpPage = () => {
    const parsed = Number.parseInt(jumpPageInput.trim(), 10)
    if (!Number.isFinite(parsed)) {
      setJumpPageInput(String(currentPage))
      return
    }

    const nextPage = Math.min(totalPages, Math.max(1, parsed))
    setCurrentPage(nextPage)
    setJumpPageInput(String(nextPage))
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">下载历史</h3>
            <p className="text-sm text-text-secondary mt-1">
              共 {totalCount} 条下载记录，第 {currentPage} / {totalPages} 页
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            disabled={isClearingAll}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
          >
            {isClearingAll ? '清空中...' : '一键清空'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">平台筛选</span>
            <select
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            >
              {PLATFORM_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">开始日期</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">结束日期</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </label>
        </div>
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="确认清空全部下载历史？"
        description="清空后无法恢复，当前账号的下载历史将被永久删除。"
        confirmText="确认清空"
        cancelText="取消"
        onConfirm={() => void handleClearAll()}
        onCancel={() => setShowClearConfirm(false)}
        loading={isClearingAll}
        variant="danger"
      />

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 text-primary animate-spin" />
          <p className="text-text-secondary">加载中...</p>
        </div>
      ) : error ? (
        <div className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-red-500">{error}</p>
        </div>
      ) : history.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <Play className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-text-secondary">暂无下载记录</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {history.map((item) => {
            const StatusIcon = statusConfig[item.status].icon
            return (
              <div
                key={item.id}
                className="p-4 md:p-5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {/* 缩略图 */}
                  <div className="relative w-full sm:w-40 sm:h-[90px] aspect-video sm:aspect-auto rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.currentTarget
                        target.onerror = null
                        target.src = VIDEO_PLACEHOLDER_URL
                      }}
                    />
                    {item.duration && (
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
                        {item.duration}
                      </div>
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    {item.sourceUrl || item.videoUrl ? (
                      <a
                        href={item.sourceUrl || item.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline break-all mb-2 block"
                        title="打开原视频链接"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <h4 className="font-medium text-text-primary break-all mb-2">
                        {item.title}
                      </h4>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${platformColors[item.platformKey] || 'bg-gray-100 text-gray-600'}`}>
                        {item.platform}
                      </span>
                      <span className="text-xs text-text-secondary">{item.date}</span>
                      {item.quality && (
                        <span className="text-xs text-text-secondary">{item.quality}</span>
                      )}
                      <div className={`flex items-center gap-1 text-xs ${statusConfig[item.status].color}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        <span>{statusConfig[item.status].label}</span>
                      </div>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 sm:self-center">
                    {item.status === 'failed' || item.status === 'completed' ? (
                      <button
                        onClick={() => {
                          void handleRedownload(item)
                        }}
                        disabled={redownloadingId === item.id}
                        className="p-2 rounded-lg text-text-secondary hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-60"
                        title="重新下载"
                      >
                        {redownloadingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </button>
                    ) : null}
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                      className="p-2 rounded-lg text-text-secondary hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isLoading && !error && history.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">每页</span>
            <select
              value={pageSize}
              onChange={(event) => {
                const nextSize = Number.parseInt(event.target.value, 10)
                const validSize = PAGE_SIZE_OPTIONS.includes(nextSize)
                  ? nextSize
                  : DEFAULT_PAGE_SIZE
                setPageSize(validSize)
                setCurrentPage(1)
                setJumpPageInput('1')
              }}
              className="h-8 px-2 rounded-lg border border-gray-200 bg-white text-xs text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-secondary">条</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-text-primary hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              下一页
            </button>

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">跳转</span>
              <input
                value={jumpPageInput}
                onChange={(event) => setJumpPageInput(event.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleJumpPage()
                  }
                }}
                onBlur={() => {
                  if (!jumpPageInput.trim()) {
                    setJumpPageInput(String(currentPage))
                  }
                }}
                className="w-14 h-8 px-2 rounded-lg border border-gray-200 bg-white text-xs text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                inputMode="numeric"
                aria-label="跳转页码"
              />
              <span className="text-xs text-text-secondary">页</span>
              <button
                type="button"
                onClick={handleJumpPage}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                跳转
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
