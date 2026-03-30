import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/auth-store';

export default function IndexRoute() {
  const token = useAuthStore((state) => state.token);
  return <Redirect href={token ? '/(tabs)/home' : '/(auth)/login'} />;
}
