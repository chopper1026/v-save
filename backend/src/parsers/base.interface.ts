export interface VideoStreamCandidate {
  url: string;
  codecid?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  bandwidth?: number;
  fileId?: string;
  ratio?: string;
  sourceKind?: string;
  watermark?: boolean;
}

/**
 * 视频信息接口
 */
export interface VideoDownloadOptions {
  // 音视频合流（优先用于预览/常规下载）
  merged?: Record<string, string>;
  // 纯视频流（通常无音频轨）
  video?: Record<string, string>;
  // 纯视频流候选（用于客户端/服务端按端能力做更精细选流）
  videoCandidates?: Record<string, VideoStreamCandidate[]>;
  // 纯音频流
  audio?: Record<string, string>;
}

export interface VideoInfo {
  title: string;
  cover: string;
  duration: string;
  platform: 'douyin' | 'bilibili' | 'xiaohongshu' | 'kuaishou' | 'youtube';
  author?: string;
  description?: string;
  sourceUrl?: string;
  videoUrl: string;
  audioUrl?: string;
  downloadOptions?: VideoDownloadOptions;
  qualityStatus?:
    | 'complete'
    | 'enriching'
    | 'session_required'
    | 'source_single_quality';
  qualityRefreshKey?: string;
  qualityMessage?: string;
}

/**
 * 视频解析器接口
 */
export interface VideoParser {
  platform: VideoInfo['platform'];
  parse(url: string): Promise<VideoInfo>;
  supports(url: string): boolean;
}
