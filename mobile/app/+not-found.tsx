import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth-store';

export default function NotFoundRoute() {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const target = token ? '/(tabs)/home' : '/(auth)/login';
    router.dismissTo(target);
  }, [hydrated, router, token]);

  return null;
}
