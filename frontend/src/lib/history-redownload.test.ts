import { describe, expect, it, vi } from 'vitest'
import {
  resolveHistoryRedownloadDownloadUrl,
  resolveWebDownloadRequestUrl,
} from './history-redownload'

describe('history redownload helpers', () => {
  it('re-resolves the latest download url from sourceUrl when history has an original link', async () => {
    const parseVideo = vi.fn().mockResolvedValue({
      title: 'sample video',
      cover: 'https://example.com/cover.jpg',
      duration: '00:12',
      platform: 'douyin',
      author: 'tester',
      videoUrl: 'https://v26-web.douyinvod.com/video.mp4',
      audioUrl: '',
      downloadOptions: {
        merged: {
          '720p': 'https://v26-web.douyinvod.com/video.mp4',
        },
      },
    })
    const getDownloadUrl = vi.fn().mockResolvedValue({
      downloadUrl: 'https://v26-web.douyinvod.com/video-fresh.mp4',
    })

    const result = await resolveHistoryRedownloadDownloadUrl({
      item: {
        sourceUrl: 'https://v.douyin.com/example/',
        downloadUrl: 'https://www.douyin.com/aweme/v1/play/?video_id=legacy',
        format: 'mp4',
        quality: '720p',
      },
      clientType: 'WEB',
      parseVideo,
      getDownloadUrl,
    })

    expect(parseVideo).toHaveBeenCalledWith('https://v.douyin.com/example/')
    expect(getDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientType: 'WEB',
        format: 'mp4',
        quality: '720p',
        videoInfo: expect.stringContaining('"sourceUrl":"https://v.douyin.com/example/"'),
      }),
    )
    expect(result).toBe('https://v26-web.douyinvod.com/video-fresh.mp4')
  })

  it('falls back to the stored history download url when sourceUrl is missing', async () => {
    const parseVideo = vi.fn()
    const getDownloadUrl = vi.fn()

    const result = await resolveHistoryRedownloadDownloadUrl({
      item: {
        downloadUrl: 'https://cdn.example.com/video.mp4',
        format: 'mp4',
        quality: '720p',
      },
      clientType: 'WEB',
      parseVideo,
      getDownloadUrl,
    })

    expect(result).toBe('https://cdn.example.com/video.mp4')
    expect(parseVideo).not.toHaveBeenCalled()
    expect(getDownloadUrl).not.toHaveBeenCalled()
  })

  it('rewrites local api urls to the current origin and proxies external urls', () => {
    expect(
      resolveWebDownloadRequestUrl(
        'http://127.0.0.1:3001/api/download/tasks/task-1/file',
        {
          currentOrigin: 'http://localhost:4871',
          currentHostname: 'localhost',
        },
      ),
    ).toBe('http://localhost:4871/api/download/tasks/task-1/file')

    expect(
      resolveWebDownloadRequestUrl('https://v26-web.douyinvod.com/video.mp4', {
        currentOrigin: 'http://localhost:4871',
        currentHostname: 'localhost',
      }),
    ).toContain('/api/proxy/fetch?url=')
  })
})
