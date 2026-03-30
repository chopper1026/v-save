import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import LinkInput from '../components/LinkInput'
import VideoPreview from '../components/VideoPreview'
import FormatSelector, { FormatType, QualityOption, QualityType } from '../components/FormatSelector'
import DownloadButton from '../components/DownloadButton'
import { useVideoParser } from '../hooks/useVideoParser'
import { Zap, Shield, Wand, PlayCircle, Gauge } from 'lucide-react'
import axios from 'axios'
import { api } from '../lib/api'
import { resolveWebDownloadRequestUrl } from '../lib/history-redownload'
import {
  createRuntimeEventKey,
  createRuntimeTraceId,
  extractRuntimeEventErrorCode,
  normalizeRuntimePlatform,
  reportRuntimeClientEvent,
} from '../lib/runtime-monitor'
import { useUserStore } from '../store/useUserStore'

const DEFAULT_VIDEO_QUALITY_OPTIONS: QualityOption[] = [
  { value: '4k', label: '4K' },
  { value: '1080p', label: '1080P' },
  { value: '720p', label: '720P' },
]

const DEFAULT_AUDIO_QUALITY_OPTIONS: QualityOption[] = [
  { value: '192k', label: '超高音质 192K' },
  { value: '132k', label: '高音质 132K' },
  { value: '64k', label: '标准音质 64K' },
]
const SINGLE_VIDEO_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'source', label: '原始画质' },
]
const SINGLE_AUDIO_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'source', label: '原始音轨' },
]

const VIDEO_QUALITY_ORDER = ['4k', '1440p', '1080p', '720p', '540p', '480p', '360p']
const ASYNC_YOUTUBE_QUALITIES = new Set(['720p', '1080p', '4k'])
const URL_PATTERN = /https?:\/\/[^\s]+/gi
const SUPPORTED_VIDEO_HOSTS = [
  'douyin.com',
  'iesdouyin.com',
  'bilibili.com',
  'b23.tv',
  'xiaohongshu.com',
  'xiaohongshu.cn',
  'xhsc.cn',
  'xhslink.com',
  'kuaishou.com',
  'youtube.com',
  'youtu.be',
]

const trimWrappedUrl = (value: string): string => {
  let result = value.trim()
  result = result.replace(/^[<>\(\)\[\]\{\}"'“”‘’]+/, '')
  result = result.replace(/[<>\(\)\[\]\{\}"'“”‘’，。！？、；：]+$/, '')
  return result
}

const isSupportedVideoUrl = (value: string): boolean => {
  const lower = value.toLowerCase()
  return SUPPORTED_VIDEO_HOSTS.some((host) => lower.includes(host))
}

const extractSupportedVideoUrl = (raw: string): string | null => {
  const direct = trimWrappedUrl(raw)
  if (/^https?:\/\//i.test(direct) && isSupportedVideoUrl(direct)) {
    return direct
  }

  const matches = raw.match(URL_PATTERN) || []
  for (const match of matches) {
    const normalized = trimWrappedUrl(match)
    if (isSupportedVideoUrl(normalized)) {
      return normalized
    }
  }

  return null
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

type AsyncDownloadTaskStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'processing'

interface AsyncDownloadTaskPayload {
  status?: AsyncDownloadTaskStatus
  progress?: number
  message?: string
  downloadUrl?: string
  fileExtension?: string
}

const EXPIRED_TASK_HINTS = ['任务文件已过期', '文件已过期', '任务已过期']

const isExpiredTaskMessage = (value: string | null | undefined): boolean => {
  const text = String(value || '').trim()
  if (!text) {
    return false
  }
  return EXPIRED_TASK_HINTS.some((hint) => text.includes(hint))
}

const getTaskTerminalErrorMessage = (task: AsyncDownloadTaskPayload): string | null => {
  if (task.status === 'failed') {
    return task.message?.trim() || '下载任务失败'
  }
  if (task.status === 'expired') {
    return task.message?.trim() || '任务文件已过期，请重新创建下载任务'
  }
  return null
}

const getAxiosErrorMessage = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) {
    return null
  }

  const payload = error.response?.data as any
  const message = payload?.message ?? payload?.error
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }
  if (Array.isArray(message) && typeof message[0] === 'string' && message[0].trim()) {
    return message[0].trim()
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  return null
}

const getXhrErrorMessage = (responseText: string): string | null => {
  const text = String(responseText || '').trim()
  if (!text) {
    return null
  }

  try {
    const payload = JSON.parse(text) as any
    const message = payload?.message ?? payload?.error
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
    if (Array.isArray(message) && typeof message[0] === 'string' && message[0].trim()) {
      return message[0].trim()
    }
  } catch {
    return null
  }

  return null
}

const getXhrErrorMessageSafely = async (xhr: XMLHttpRequest | null): Promise<string | null> => {
  if (!xhr) {
    return null
  }

  try {
    if (!xhr.responseType || xhr.responseType === 'text') {
      return getXhrErrorMessage(xhr.responseText || '')
    }
  } catch {
    // ignore InvalidStateError and fall through to other branches
  }

  if (xhr.responseType === 'blob' && xhr.response instanceof Blob) {
    try {
      const text = await xhr.response.text()
      return getXhrErrorMessage(text)
    } catch {
      return null
    }
  }

  if (typeof xhr.response === 'string') {
    return getXhrErrorMessage(xhr.response)
  }

  return null
}

const parseAudioBitrate = (quality: string): number => {
  const matched = quality.toLowerCase().match(/(\d+)\s*k/)
  if (!matched) {
    return 0
  }
  return Number.parseInt(matched[1], 10)
}

const buildVideoQualityOptions = (
  qualityMap?: Record<string, string>,
  options?: {
    preferSourceLabel?: boolean
  },
): QualityOption[] => {
  if (!qualityMap || Object.keys(qualityMap).length === 0) {
    return SINGLE_VIDEO_QUALITY_OPTIONS
  }

  return Object.keys(qualityMap)
    .sort((a, b) => {
      const ai = VIDEO_QUALITY_ORDER.indexOf(a)
      const bi = VIDEO_QUALITY_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .map((quality) => ({
      value: quality,
      label: options?.preferSourceLabel && quality === 'source'
        ? '原始线路'
        : quality.toUpperCase(),
    }))
}

const mergeQualityMaps = (
  primary?: Record<string, string>,
  secondary?: Record<string, string>,
): Record<string, string> | undefined => {
  const merged = {
    ...(primary || {}),
    ...(secondary || {}),
  }

  if (Object.keys(merged).length === 0) {
    return undefined
  }

  return merged
}

const buildAudioQualityOptions = (qualityMap?: Record<string, string>): QualityOption[] => {
  if (!qualityMap || Object.keys(qualityMap).length === 0) {
    return SINGLE_AUDIO_QUALITY_OPTIONS
  }

  return Object.keys(qualityMap)
    .sort((a, b) => parseAudioBitrate(b) - parseAudioBitrate(a))
    .map((quality) => ({
      value: quality,
      label: `音质 ${quality.toUpperCase()}`,
    }))
}

const toMediaIdentity = (value: string): string => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return ''
  }

  try {
    const parsed = new URL(normalized)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`
  } catch {
    return normalized.split('?')[0]?.split('#')[0]?.toLowerCase() || ''
  }
}

const hasDedicatedAudioSource = (video: {
  url?: string
  originalUrl?: string
  originalAudioUrl?: string
  downloadOptions?: {
    audio?: Record<string, string>
  }
} | null): boolean => {
  if (!video) {
    return false
  }

  const audioMap = video.downloadOptions?.audio
  if (audioMap && Object.values(audioMap).some((item) => !!String(item || '').trim())) {
    return true
  }

  const audioIdentity = toMediaIdentity(video.originalAudioUrl || '')
  if (!audioIdentity) {
    return false
  }

  const videoIdentity = toMediaIdentity(video.originalUrl || video.url || '')
  if (!videoIdentity) {
    return true
  }

  return audioIdentity !== videoIdentity
}

export default function Home() {
  const currentYear = new Date().getFullYear()
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<FormatType>('video')
  const [quality, setQuality] = useState<QualityType>('1080p')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const { video, isLoading, error: parseError, parse, reset } = useVideoParser()
  const token = useUserStore((state) => state.token)
  const navigate = useNavigate()
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const qualityAutoSelectRef = useRef(true)
  const audioFormatSupported = useMemo(() => hasDedicatedAudioSource(video), [video])
  const availableFormats = useMemo<FormatType[]>(
    () => (audioFormatSupported ? ['video', 'audio', 'merge'] : ['video', 'merge']),
    [audioFormatSupported],
  )
  const prefersSourceQualityLabel = useMemo(() => {
    if (!video) {
      return false
    }
    return video.platform === 'xiaohongshu' && video.qualityStatus === 'source_single_quality'
  }, [video])
  const qualityStatusNotice = useMemo(() => {
    if (!video) {
      return null
    }
    if (video.platform === 'xiaohongshu' && video.qualityStatus === 'source_single_quality') {
      return video.qualityMessage || '小红书源站当前只返回单路视频，无法准确识别清晰度，将按原始线路下载。'
    }
    return null
  }, [video])

  const qualityOptions = useMemo<QualityOption[]>(() => {
    if (!video) {
      return format === 'audio'
        ? DEFAULT_AUDIO_QUALITY_OPTIONS
        : DEFAULT_VIDEO_QUALITY_OPTIONS
    }

    if (format === 'audio') {
      return buildAudioQualityOptions(video.downloadOptions?.audio)
    }

    if (format === 'merge') {
      const qualityMap = mergeQualityMaps(
        video.downloadOptions?.merged,
        video.downloadOptions?.video,
      )
      return buildVideoQualityOptions(qualityMap, {
        preferSourceLabel: prefersSourceQualityLabel,
      })
    }

    const qualityMap = mergeQualityMaps(
      video.downloadOptions?.merged,
      video.downloadOptions?.video,
    )
    return buildVideoQualityOptions(qualityMap, {
      preferSourceLabel: prefersSourceQualityLabel,
    })
  }, [video, format, prefersSourceQualityLabel])

  useEffect(() => {
    qualityAutoSelectRef.current = true
  }, [video?.originalUrl, video?.url, video?.qualityRefreshKey])

  useEffect(() => {
    if (!qualityOptions.length) {
      return
    }

    if (
      qualityAutoSelectRef.current ||
      !qualityOptions.some((item) => item.value === quality)
    ) {
      setQuality(qualityOptions[0].value)
      qualityAutoSelectRef.current = false
    }
  }, [quality, qualityOptions])

  const handleQualityChange = useCallback((nextQuality: QualityType) => {
    qualityAutoSelectRef.current = false
    setQuality(nextQuality)
  }, [])

  useEffect(() => {
    if (availableFormats.includes(format)) {
      return
    }
    setFormat(availableFormats[0] || 'video')
  }, [availableFormats, format])

  useEffect(() => {
    if (downloadStatus !== 'success') {
      return
    }

    const timer = window.setTimeout(() => {
      setDownloadStatus('idle')
      setDownloadProgress(0)
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [downloadStatus])

  const handleParse = () => {
    const extractedUrl = extractSupportedVideoUrl(url)
    if (!extractedUrl) {
      setDownloadStatus('idle')
      setDownloadProgress(0)
      setError('未检测到可用的视频链接，请粘贴完整链接或包含链接的分享文案')
      return
    }

    if (extractedUrl !== url) {
      setUrl(extractedUrl)
    }

    setError(null)
    setDownloadStatus('idle')
    setDownloadProgress(0)
    parse(extractedUrl)
  }

  // 将 QualityType 转换为后端需要的格式
  const mapQualityToBackend = (q: QualityType): string => {
    return q
  }

  // 将 FormatType 转换为后端需要的格式
  const mapFormatToBackend = (f: FormatType): string => {
    const mapping: Record<FormatType, string> = {
      'video': 'mp4',
      'audio': 'audio',
      'merge': 'mp4'
    }
    return mapping[f]
  }

  const handleDownload = useCallback(async () => {
    if (!video || !video.url) {
      setError('无法获取视频下载地址')
      return
    }
    if (format === 'audio' && !audioFormatSupported) {
      setDownloadStatus('error')
      setError('当前视频不支持独立音频下载，请选择视频格式')
      return
    }
    if (!token) {
      setDownloadStatus('error')
      setError('请先登录后再下载')
      navigate('/login')
      return
    }

    const downloadStartedAt = Date.now()
    const downloadEventKey = createRuntimeEventKey('download')
    const runtimeTraceId = String(video.runtimeTraceId || '').trim() || createRuntimeTraceId('download')
    const platform = normalizeRuntimePlatform(video.platform)
    let hasReportedDownloadOutcome = false
    const reportDownloadOutcome = (outcome: 'success' | 'failure', errorCode?: string) => {
      if (hasReportedDownloadOutcome) {
        return
      }
      hasReportedDownloadOutcome = true
      reportRuntimeClientEvent({
        feature: 'download',
        clientType: 'WEB',
        platform,
        outcome,
        latencyMs: Date.now() - downloadStartedAt,
        errorCode,
        eventKey: downloadEventKey,
        traceId: runtimeTraceId,
      })
    }

    setDownloadStatus('downloading')
    setDownloadProgress(0)
    setError(null)

    try {
      const selectedQuality = qualityOptions.find((item) => item.value === quality)?.value
        || qualityOptions[0]?.value
        || (format === 'audio' ? '132k' : '720p')

      const shouldUseAsyncYoutubeTask =
        video.platform === 'youtube'
        && format !== 'audio'
        && ASYNC_YOUTUBE_QUALITIES.has(selectedQuality)

      const parsedSourceUrl = extractSupportedVideoUrl(url) || url.trim()

      // 准备视频信息
      const videoInfo = {
        title: video.title,
        cover: video.originalCover || video.cover,
        duration: video.duration,
        platform: video.platform,
        author: video.author,
        sourceUrl: parsedSourceUrl,
        videoUrl: video.originalUrl || video.url,
        audioUrl: video.originalAudioUrl || '',
        downloadOptions: video.downloadOptions || undefined,
        qualityStatus: video.qualityStatus,
        qualityRefreshKey: video.qualityRefreshKey,
        qualityMessage: video.qualityMessage,
      }

      let downloadUrl = video.originalUrl || video.url
      let fileExtension = format === 'audio' ? 'm4a' : 'mp4'

      if (shouldUseAsyncYoutubeTask) {
        const sourceUrl = parsedSourceUrl
        if (!sourceUrl) {
          throw new Error('无法提取原始视频链接，请重新粘贴链接后重试')
        }

        const taskResponse = await api.post('/download/create-task', {
          sourceUrl,
          videoInfo: JSON.stringify(videoInfo),
          format: 'mp4',
          quality: selectedQuality,
        }, {
          headers: {
            'x-runtime-trace-id': runtimeTraceId,
          },
        })

        const taskId = taskResponse.data?.data?.id as string | undefined
        if (!taskId) {
          throw new Error('创建下载任务失败')
        }

        let completedTask: AsyncDownloadTaskPayload | null = null
        const maxPollCount = 300 // 最长轮询约 6 分钟

        for (let i = 0; i < maxPollCount; i += 1) {
          const taskResult = await api.get(`/download/tasks/${taskId}`, {
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          })
          const task = taskResult.data?.data as AsyncDownloadTaskPayload | undefined
          if (!task) {
            throw new Error('下载任务不存在')
          }

          if (typeof task.progress === 'number') {
            setDownloadProgress(Math.min(99, Math.max(1, task.progress)))
          } else if (task.status === 'queued') {
            setDownloadProgress((prev) => Math.max(prev, 2))
          } else if (task.status === 'downloading' || task.status === 'processing') {
            setDownloadProgress((prev) => Math.max(prev, 5))
          } else if (task.status === 'merging') {
            setDownloadProgress((prev) => Math.max(prev, 92))
          }

          const terminalError = getTaskTerminalErrorMessage(task)
          if (terminalError) {
            throw new Error(terminalError)
          }

          if (task.status === 'completed' && task.downloadUrl) {
            completedTask = task
            break
          }

          await wait(1200)
        }

        if (!completedTask) {
          throw new Error('下载任务超时，请稍后重试')
        }
        if (!completedTask.downloadUrl) {
          throw new Error('下载任务完成但未返回文件地址，请重试')
        }

        downloadUrl = completedTask.downloadUrl
        fileExtension = (completedTask.fileExtension || 'mp4').replace('.', '')
      }

      if (!shouldUseAsyncYoutubeTask) {
        const getDownloadUrlPayload: Record<string, unknown> = {
          videoInfo: JSON.stringify(videoInfo),
          format: mapFormatToBackend(format),
          quality: mapQualityToBackend(selectedQuality),
          clientType: 'WEB',
        }

        const requestGetDownloadUrl = () => api.post(
          '/download/get-url',
          getDownloadUrlPayload,
          {
            timeout: 90000,
            headers: {
              'x-runtime-trace-id': runtimeTraceId,
            },
          },
        )

        let response
        try {
          response = await requestGetDownloadUrl()
        } catch (error) {
          const isTimeout = axios.isAxiosError(error)
            && (
              error.code === 'ECONNABORTED'
              || error.message?.toLowerCase().includes('timeout')
            )
          if (!isTimeout) {
            throw error
          }

          response = await requestGetDownloadUrl()
        }

        if (!response.data?.success || !response.data?.data?.downloadUrl) {
          throw new Error('下载链接获取失败')
        }

        downloadUrl = response.data.data.downloadUrl
        fileExtension = (response.data.data.fileExtension || fileExtension).replace('.', '')
      }

      const requestUrl = resolveWebDownloadRequestUrl(downloadUrl, {
        runtimeTraceId,
        currentOrigin: window.location.origin,
        currentHostname: window.location.hostname,
      })

      // 使用 XMLHttpRequest 获取真实下载进度
      const xhr = new XMLHttpRequest()
      xhrRef.current = xhr
      xhr.open('GET', requestUrl, true)
      if (runtimeTraceId) {
        xhr.setRequestHeader('x-runtime-trace-id', runtimeTraceId)
      }
      if (token && (requestUrl.includes('/api/download/merge') || requestUrl.includes('/api/download/tasks/'))) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      xhr.responseType = 'blob'

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100
          setDownloadProgress(percentComplete)
        } else if (event.loaded > 0) {
          // 合流流式下载通常无 Content-Length，这里提供一个平滑的伪进度避免“卡住”错觉
          const loadedMb = event.loaded / (1024 * 1024)
          const pseudoProgress = Math.min(95, 5 + Math.log2(loadedMb + 1) * 16)
          setDownloadProgress((prev) => Math.max(prev, pseudoProgress))
        }
      }

      xhr.onload = async () => {
        if (xhr.status === 200) {
          const blob = xhr.response
          if (blob) {
            // 创建下载
            const blobUrl = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = blobUrl
            link.download = `${video.title || 'video'}.${fileExtension}`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            window.URL.revokeObjectURL(blobUrl)

            setDownloadStatus('success')
            setDownloadProgress(100)
            reportDownloadOutcome('success')
          }
        } else {
          const responseMessage = await getXhrErrorMessageSafely(xhr)
          const isTaskArtifactRequest = requestUrl.includes('/api/download/tasks/')
          const isProxyRequest = requestUrl.includes('/api/proxy/fetch?')
          if (isTaskArtifactRequest || isProxyRequest) {
            setDownloadStatus('error')
            setError(responseMessage || (isProxyRequest
              ? '下载代理请求失败，请稍后重试'
              : '下载任务文件获取失败，请重新创建下载任务'))
            reportDownloadOutcome(
              'failure',
              isProxyRequest ? 'PROXY_FETCH_FAILED' : 'TASK_FILE_FETCH_FAILED',
            )
            return
          }

          // 如果 XHR 失败，尝试直接跳转下载
          try {
            const link = document.createElement('a')
            link.href = requestUrl
            link.download = `${video.title || 'video'}.${fileExtension}`
            link.target = '_blank'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            setDownloadStatus('success')
            setDownloadProgress(100)
            reportDownloadOutcome('success')
          } catch {
            setDownloadStatus('error')
            setError('下载失败，请尝试复制链接手动下载')
            reportDownloadOutcome('failure', 'DOWNLOAD_FALLBACK_FAILED')
          }
        }
      }

      xhr.onerror = () => {
        const isTaskArtifactRequest = requestUrl.includes('/api/download/tasks/')
        const isProxyRequest = requestUrl.includes('/api/proxy/fetch?')
        if (isTaskArtifactRequest || isProxyRequest) {
          setDownloadStatus('error')
          setError(isProxyRequest
            ? '下载代理请求失败，请稍后重试'
            : '下载任务文件获取失败，请重新创建下载任务')
          reportDownloadOutcome(
            'failure',
            isProxyRequest ? 'PROXY_FETCH_FAILED' : 'TASK_FILE_FETCH_FAILED',
          )
          return
        }
        // 如果 XHR 失败，尝试直接跳转下载
        try {
          const link = document.createElement('a')
          link.href = requestUrl
          link.download = `${video.title || 'video'}.${fileExtension}`
          link.target = '_blank'
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          setDownloadStatus('success')
          setDownloadProgress(100)
          reportDownloadOutcome('success')
        } catch {
          setDownloadStatus('error')
          setError('下载失败，请尝试复制链接手动下载')
          reportDownloadOutcome('failure', 'DOWNLOAD_FALLBACK_FAILED')
        }
      }

      xhr.send()

    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 403) {
          const responseData = err.response.data
          const responseMessage =
            typeof responseData?.message === 'string'
              ? responseData.message
              : typeof responseData?.message?.message === 'string'
                ? responseData.message.message
                : '当前账号权限不足，请稍后重试'
          setError(responseMessage)
        } else {
          const message = getAxiosErrorMessage(err)
          setError(message || '下载失败，请稍后重试')
        }
      } else {
        console.error('下载失败:', err)
        if (err instanceof Error && err.message) {
          setError(err.message)
        } else {
          setError('下载失败，请稍后重试')
        }
      }
      reportDownloadOutcome(
        'failure',
        extractRuntimeEventErrorCode(err, 'DOWNLOAD_FLOW_FAILED'),
      )
      setDownloadStatus('error')
    }
  }, [video, token, format, quality, qualityOptions, navigate, audioFormatSupported])

  const displayError = error || parseError
  const canQuickRecreateTask =
    !!video
    && downloadStatus === 'error'
    && isExpiredTaskMessage(error || '')
  const platformBadges = ['抖音', 'B站', '小红书', '快手', 'YouTube']
  const metrics = [
    { label: '支持平台', value: '6+', hint: '覆盖主流短视频平台' },
    { label: '最高画质', value: '4K', hint: '按源站可用档位下载' },
    { label: '下载模式', value: '3 种', hint: '视频 / 音频 / 音视频合并' },
    { label: '任务状态', value: '实时', hint: '下载进度可视化反馈' },
  ]

  return (
    <div className="min-h-screen bg-[#f4f8ff] flex flex-col relative overflow-hidden">
      <Header />

      <main className="relative flex-1 pt-24 pb-12 px-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-gradient-to-b from-sky-100/70 via-blue-50 to-transparent" />
        <div className="pointer-events-none absolute top-20 left-[-80px] w-[260px] h-[260px] rounded-full bg-sky-200/35 blur-3xl" />
        <div className="pointer-events-none absolute top-14 right-[-60px] w-[240px] h-[240px] rounded-full bg-blue-300/30 blur-3xl" />

        <div className="max-w-[1200px] mx-auto space-y-5 relative">
          <section className="relative overflow-hidden rounded-[30px] border border-sky-100/80 bg-white/82 backdrop-blur-md shadow-[0_24px_70px_rgba(30,64,175,0.15)]">
            <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:28px_28px]" />
            <div className="relative px-6 py-6 md:px-10 md:py-7">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="max-w-[760px]">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-sky-200 bg-sky-50 text-sm font-semibold text-sky-700 mb-4">
                    <Wand className="w-4 h-4" />
                    一站式视频解析与下载
                  </div>
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                    更快解析，更清晰下载
                    <span className="block mt-1 bg-gradient-to-r from-sky-500 to-blue-600 bg-clip-text text-transparent">
                      V-SAVE 多平台全链路下载
                    </span>
                  </h1>
                  <p className="mt-3 text-base text-slate-600 max-w-2xl leading-relaxed">
                    粘贴分享链接或整段文案，自动识别平台并给出可用画质。全流程可视化反馈，下载过程更稳定，结果更可控。
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {platformBadges.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium text-slate-600 bg-white/85 border border-slate-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="w-full md:w-[300px] grid grid-cols-2 gap-3">
                  {metrics.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-sky-100 bg-white/92 px-3 py-3 shadow-[0_10px_24px_rgba(14,116,204,0.14)]"
                    >
                      <p className="text-xs font-semibold tracking-wide text-slate-500">{item.label}</p>
                      <p className="text-xl font-extrabold text-slate-900 mt-1">{item.value}</p>
                      <p className="text-[11px] leading-4 text-slate-500 mt-1">{item.hint}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white/92 px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                  <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">高速解析</div>
                    <div className="text-sm text-slate-500">支持多平台直达解析链路</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white/92 px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                    <Gauge className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">多档画质</div>
                    <div className="text-sm text-slate-500">按源站可用档位展示真实选项</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white/92 px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">稳定下载</div>
                    <div className="text-sm text-slate-500">任务状态可追踪，异常有提示</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="-mt-2 md:-mt-3 rounded-3xl border border-sky-100 bg-white/78 backdrop-blur-md px-4 py-5 md:px-6 md:py-6 shadow-[0_18px_46px_rgba(15,23,42,0.1)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 mb-3 px-1">
              <PlayCircle className="w-4 h-4 text-sky-600" />
              粘贴链接后解析并预览
            </div>

            <LinkInput
              value={url}
              onChange={(nextValue) => {
                setUrl(nextValue)
                if (error) {
                  setError(null)
                }
                if (parseError) {
                  reset()
                }
              }}
              onParse={handleParse}
              isLoading={isLoading}
            />

            <VideoPreview video={video} isLoading={isLoading} />

            {video && (
              <FormatSelector
                format={format}
                quality={quality}
                qualityLabel={format === 'audio' ? '音频音质' : '视频画质'}
                qualityOptions={qualityOptions}
                qualityHint={format === 'audio' ? null : qualityStatusNotice}
                qualityDisabled={false}
                availableFormats={availableFormats}
                onFormatChange={setFormat}
                onQualityChange={handleQualityChange}
              />
            )}

            {video && (
              <DownloadButton
                onDownload={handleDownload}
                isLoading={downloadStatus === 'downloading'}
                progress={downloadProgress}
                status={downloadStatus}
                disabled={false}
                idleLabel='开始下载'
              />
            )}

            {displayError && (
              <div className="max-w-3xl mx-auto mt-4 p-4 bg-rose-50 text-rose-600 rounded-xl text-center border border-rose-100">
                <div>{displayError}</div>
                {canQuickRecreateTask && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="mt-3 inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition-colors"
                  >
                    一键重建下载任务
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="border-t border-sky-100/90 bg-gradient-to-b from-white/60 to-sky-50/80">
        <div className="max-w-[1200px] mx-auto px-4 py-6">
          <p className="text-sm text-slate-500 text-center">
            V-SAVE &copy; {currentYear} chopper1026. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
