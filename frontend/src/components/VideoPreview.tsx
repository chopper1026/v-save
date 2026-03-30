import { useState, useRef, useEffect } from 'react'
import { Clock, Play, X } from 'lucide-react'
import { VIDEO_PLACEHOLDER_URL } from '../lib/assets'
import {
  createRuntimeEventKey,
  normalizeRuntimePlatform,
  reportRuntimeClientEvent,
} from '../lib/runtime-monitor'

export type Platform = 'douyin' | 'bilibili' | 'xiaohongshu' | 'kuaishou' | 'youtube' | 'unknown'

interface VideoInfo {
  title: string
  cover: string
  duration: string
  platform: Platform
  author: string
  url?: string
  audioUrl?: string
  runtimeTraceId?: string
}

interface VideoPreviewProps {
  video: VideoInfo | null
  isLoading?: boolean
}

const isHlsUrl = (value: string): boolean => /\.m3u8(\?|$)/i.test(value || '')

const platformConfig: Record<Platform, { name: string; color: string; badgeBg: string; borderColor: string }> = {
  douyin: { name: '抖音', color: '#111827', badgeBg: 'rgba(17,24,39,0.08)', borderColor: 'rgba(17,24,39,0.2)' },
  bilibili: { name: 'B站', color: '#0284c7', badgeBg: 'rgba(2,132,199,0.12)', borderColor: 'rgba(2,132,199,0.26)' },
  xiaohongshu: { name: '小红书', color: '#e11d48', badgeBg: 'rgba(225,29,72,0.11)', borderColor: 'rgba(225,29,72,0.24)' },
  kuaishou: { name: '快手', color: '#ea580c', badgeBg: 'rgba(234,88,12,0.12)', borderColor: 'rgba(234,88,12,0.22)' },
  youtube: { name: 'YouTube', color: '#dc2626', badgeBg: 'rgba(220,38,38,0.1)', borderColor: 'rgba(220,38,38,0.24)' },
  unknown: { name: '未知', color: '#475569', badgeBg: 'rgba(71,85,105,0.12)', borderColor: 'rgba(71,85,105,0.24)' },
}

export default function VideoPreview({ video, isLoading }: VideoPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<any>(null)
  const previewStartedAtRef = useRef(Date.now())
  const previewEventKeyRef = useRef(createRuntimeEventKey('preview'))
  const previewOutcomeReportedRef = useRef(false)

  useEffect(() => {
    previewStartedAtRef.current = Date.now()
    previewEventKeyRef.current = createRuntimeEventKey('preview')
    previewOutcomeReportedRef.current = false
  }, [video?.runtimeTraceId, video?.url])

  const reportPreviewOutcome = (outcome: 'success' | 'failure', errorCode?: string) => {
    if (!video?.runtimeTraceId || previewOutcomeReportedRef.current) {
      return
    }

    previewOutcomeReportedRef.current = true
    reportRuntimeClientEvent({
      feature: 'preview',
      clientType: 'WEB',
      platform: normalizeRuntimePlatform(video.platform),
      outcome,
      latencyMs: Date.now() - previewStartedAtRef.current,
      errorCode,
      eventKey: previewEventKeyRef.current,
      traceId: video.runtimeTraceId,
    })
  }

  // 清理函数
  useEffect(() => {
    return () => {
      if (hlsRef.current && typeof hlsRef.current.destroy === 'function') {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      // 组件卸载时停止视频
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
      }
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    }
  }, [])

  // 关闭播放器的处理
  const handleClosePlayer = () => {
    setIsPlaying(false)
    if (hlsRef.current && typeof hlsRef.current.destroy === 'function') {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.pause()
    }
    if (audioRef.current) {
      audioRef.current.pause()
    }
  }

  // 点击播放按钮
  const handlePlayClick = () => {
    if (video?.url) {
      previewStartedAtRef.current = Date.now()
      setIsPlaying(true)
    }
  }

  const config = video ? platformConfig[video.platform] : platformConfig.unknown
  const useExternalAudio = Boolean(video?.audioUrl && video?.url && /\.m4s(\?|$)/i.test(video.url))
  const isHlsVideo = Boolean(video?.url && isHlsUrl(video.url))

  useEffect(() => {
    if (isPlaying || !isHlsVideo || !video?.url) {
      return
    }

    const streamUrl = video.url
    let cancelled = false
    let preheatVideo: HTMLVideoElement | null = null
    let preheatHls: any = null

    const appendHiddenVideo = () => {
      if (typeof document === 'undefined') {
        return null
      }

      const element = document.createElement('video')
      element.preload = 'auto'
      element.muted = true
      element.playsInline = true
      element.setAttribute('aria-hidden', 'true')
      element.style.position = 'absolute'
      element.style.left = '-9999px'
      element.style.top = '0'
      element.style.width = '1px'
      element.style.height = '1px'
      element.style.opacity = '0'
      element.style.pointerEvents = 'none'
      document.body.appendChild(element)
      return element
    }

    preheatVideo = appendHiddenVideo()
    if (!preheatVideo) {
      return undefined
    }

    void import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) {
          return
        }

        if (!Hls.isSupported()) {
          preheatVideo.src = streamUrl
          preheatVideo.load()
          return
        }

        preheatHls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        })
        preheatHls.loadSource(streamUrl)
        preheatHls.attachMedia(preheatVideo)
      })
      .catch(() => {
        if (!cancelled) {
          preheatVideo.src = streamUrl
          preheatVideo.load()
        }
      })

    return () => {
      cancelled = true
      if (preheatHls && typeof preheatHls.destroy === 'function') {
        preheatHls.destroy()
      }
      if (preheatVideo?.parentNode) {
        preheatVideo.parentNode.removeChild(preheatVideo)
      }
    }
  }, [isPlaying, isHlsVideo, video?.url])

  useEffect(() => {
    if (!isPlaying || !isHlsVideo || !video?.url || !videoRef.current) {
      return
    }

    const element = videoRef.current
    const streamUrl = video.url
    let cancelled = false

    if (typeof element.canPlayType === 'function' && element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = streamUrl
      return
    }

    void import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) {
          return
        }

        if (!Hls.isSupported()) {
          videoRef.current.src = streamUrl
          return
        }

        if (hlsRef.current && typeof hlsRef.current.destroy === 'function') {
          hlsRef.current.destroy()
          hlsRef.current = null
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        })
        hlsRef.current = hls
        hls.loadSource(streamUrl)
        hls.attachMedia(videoRef.current)
      })
      .catch(() => {
        if (!cancelled && videoRef.current) {
          videoRef.current.src = streamUrl
        }
      })

    return () => {
      cancelled = true
      if (hlsRef.current && typeof hlsRef.current.destroy === 'function') {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [isPlaying, isHlsVideo, video?.url])

  if (!video && !isLoading) return null

  return (
    <>
      <div className="w-full max-w-3xl mx-auto mt-6">
        <div className="bg-white/95 rounded-2xl border border-sky-100 shadow-[0_18px_40px_rgba(15,23,42,0.08)] overflow-hidden">
          {isLoading ? (
            <div className="p-6 flex items-center gap-4">
              <div className="w-44 h-24 bg-slate-100 rounded-xl animate-pulse" />
              <div className="flex-1 space-y-3">
                <div className="h-5 bg-slate-100 rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
              </div>
            </div>
          ) : video ? (
            <div className="flex gap-4 p-4 md:p-5">
              {/* 缩略图 */}
              <div
                className="relative flex-shrink-0 w-44 h-24 rounded-xl overflow-hidden bg-slate-100 group cursor-pointer"
                onClick={handlePlayClick}
              >
                <img
                  src={video.cover || VIDEO_PLACEHOLDER_URL}
                  alt={video.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    <Play className="w-5 h-5 text-sky-600 ml-0.5" fill="currentColor" />
                  </div>
                </div>
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-white text-xs font-medium">
                  {video.duration}
                </div>
              </div>

              {/* 信息 */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="px-2.5 py-1 text-xs font-semibold rounded-full border"
                      style={{
                        backgroundColor: config.badgeBg,
                        borderColor: config.borderColor,
                        color: config.color,
                      }}
                    >
                      {config.name}
                    </span>
                  </div>
                  <h3 className="text-base md:text-[17px] font-semibold text-slate-900 line-clamp-2 leading-snug">
                    {video.title}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>{video.duration}</span>
                  <span className="mx-1">·</span>
                  <span className="truncate">{video.author}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* 视频播放弹窗 */}
      {isPlaying && video?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClosePlayer}
        >
          <div
            className="relative w-full max-w-4xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={handleClosePlayer}
              className="absolute -top-10 right-0 text-white/80 hover:text-white transition-colors"
            >
              <X className="w-8 h-8" />
            </button>

            {/* 视频标题 */}
            <h3 className="text-white text-lg font-medium mb-4 truncate">{video.title}</h3>

            {/* 视频播放器 */}
            <video
              ref={videoRef}
              src={isHlsVideo ? '' : (video.url || '')}
              controls
              autoPlay
              className="w-full rounded-lg shadow-2xl"
              style={{ maxHeight: '70vh' }}
              onCanPlay={() => reportPreviewOutcome('success')}
              onError={() => reportPreviewOutcome('failure', 'PREVIEW_READY_FAILED')}
              onPlay={() => {
                if (!useExternalAudio || !audioRef.current || !videoRef.current) {
                  return
                }
                audioRef.current.currentTime = videoRef.current.currentTime
                audioRef.current.playbackRate = videoRef.current.playbackRate || 1
                audioRef.current.volume = videoRef.current.volume
                audioRef.current.muted = videoRef.current.muted
                void audioRef.current.play().catch(() => undefined)
              }}
              onPause={() => {
                if (useExternalAudio && audioRef.current) {
                  audioRef.current.pause()
                }
              }}
              onSeeking={() => {
                if (useExternalAudio && audioRef.current && videoRef.current) {
                  audioRef.current.currentTime = videoRef.current.currentTime
                }
              }}
              onTimeUpdate={() => {
                if (!useExternalAudio || !audioRef.current || !videoRef.current) {
                  return
                }
                const drift = Math.abs(videoRef.current.currentTime - audioRef.current.currentTime)
                if (drift > 0.35) {
                  audioRef.current.currentTime = videoRef.current.currentTime
                }
              }}
              onRateChange={() => {
                if (useExternalAudio && audioRef.current && videoRef.current) {
                  audioRef.current.playbackRate = videoRef.current.playbackRate
                }
              }}
              onVolumeChange={() => {
                if (useExternalAudio && audioRef.current && videoRef.current) {
                  audioRef.current.volume = videoRef.current.volume
                  audioRef.current.muted = videoRef.current.muted
                }
              }}
              onEnded={() => {
                if (useExternalAudio && audioRef.current) {
                  audioRef.current.pause()
                  audioRef.current.currentTime = 0
                }
              }}
            >
              您的浏览器不支持视频播放
            </video>
            {useExternalAudio && video.audioUrl && (
              <audio
                ref={audioRef}
                src={video.audioUrl}
                preload="auto"
                onError={() => reportPreviewOutcome('failure', 'PREVIEW_AUDIO_FAILED')}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

export type { VideoInfo }
