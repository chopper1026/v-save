import { useEffect } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth-store';

export const useAuthGuard = () => {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const inAuth = pathname.startsWith('/(auth)');

    if (!token && !inAuth) {
      router.replace('/(auth)/login');
      return;
    }

    if (token && inAuth) {
      router.replace('/(tabs)/home');
    }
  }, [hydrated, pathname, router, token]);

  return {
    hydrated,
    token,
  };
};
