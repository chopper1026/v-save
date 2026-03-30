import { useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Platform } from 'react-native';
import {
  shouldReleaseScrollToTopLock,
  shouldShowScrollToTopButton,
} from '@/lib/scroll-to-top';
import {
  type ScrollableTabName,
  useTabScrollToTopStore,
} from '@/store/tab-scroll-to-top-store';

export const useTabScrollToTop = <T,>(tab: ScrollableTabName) => {
  const listRef = useRef<FlatList<T>>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const requestToken = useTabScrollToTopStore((state) => state.requests[tab]);
  const scrollToTopLockRef = useRef(false);

  useScrollToTop(listRef as RefObject<any>);

  const scrollToTop = useCallback(() => {
    scrollToTopLockRef.current = true;
    setShowScrollToTop(false);
    listRef.current?.scrollToOffset({
      offset: 0,
      animated: true,
    });
  }, []);

  const syncScrollToTopLock = useCallback((offsetY: number) => {
    if (!scrollToTopLockRef.current) {
      return false;
    }

    if (shouldReleaseScrollToTopLock(offsetY)) {
      scrollToTopLockRef.current = false;
    }

    setShowScrollToTop(false);
    return true;
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      if (syncScrollToTopLock(offsetY)) {
        return;
      }

      const nextVisible = shouldShowScrollToTopButton(offsetY);
      setShowScrollToTop((current) => (current === nextVisible ? current : nextVisible));
    },
    [syncScrollToTopLock]
  );

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      syncScrollToTopLock(event.nativeEvent.contentOffset.y);
    },
    [syncScrollToTopLock]
  );

  useEffect(() => {
    if (requestToken > 0) {
      scrollToTop();
    }
  }, [requestToken, scrollToTop]);

  return {
    listRef,
    scrollToTop,
    handleScroll,
    handleScrollEnd,
    showScrollToTop: Platform.OS === 'ios' && showScrollToTop,
  };
};
