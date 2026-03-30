import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { useIntentStore } from '@/store/intent-store';
import { extractSupportedVideoUrl } from '@/lib/link';

const tryDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const decodePossiblyTwice = (value: string): string => {
  const once = tryDecodeURIComponent(value);
  if (!once.includes('%')) {
    return once;
  }
  return tryDecodeURIComponent(once);
};

const pickFirstParam = (value?: string | string[]): string => {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
};

export default function ShareRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const setIncomingUrl = useIntentStore((state) => state.setIncomingUrl);

  useEffect(() => {
    const raw = pickFirstParam(params.url) || pickFirstParam(params.text);
    const target = raw ? decodePossiblyTwice(raw) : '';
    const extracted = extractSupportedVideoUrl(target);
    if (extracted) {
      setIncomingUrl(extracted);
    }
    router.replace('/(tabs)/home');
  }, [params.text, params.url, router, setIncomingUrl]);

  return <Screen scroll={false} />;
}
