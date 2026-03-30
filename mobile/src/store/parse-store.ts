import { create } from 'zustand';
import type { ParsedVideoView } from '@/types/api';

interface ParseState {
  sourceUrl: string;
  parsedVideo: ParsedVideoView | null;
  setParseResult: (sourceUrl: string, parsedVideo: ParsedVideoView) => void;
  updateParsedVideo: (parsedVideo: ParsedVideoView) => void;
  clearParseResult: () => void;
}

export const useParseStore = create<ParseState>()((set) => ({
  sourceUrl: '',
  parsedVideo: null,
  setParseResult: (sourceUrl, parsedVideo) =>
    set({
      sourceUrl: String(sourceUrl || '').trim(),
      parsedVideo,
    }),
  updateParsedVideo: (parsedVideo) =>
    set((state) => ({
      sourceUrl: state.sourceUrl,
      parsedVideo,
    })),
  clearParseResult: () =>
    set({
      sourceUrl: '',
      parsedVideo: null,
    }),
}));
