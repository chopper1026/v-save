import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { colors } from '@/constants/theme';
import { API_BASE_URL } from '@/lib/env';
import {
  api,
  getPublicSystemSettings,
  mapApiUserToMobileUser,
} from '@/lib/api';
import { extractApiDebugDetails, extractApiErrorMessage } from '@/lib/error';
import { useAuthStore } from '@/store/auth-store';
import type { AuthResponse } from '@/types/api';

export default function RegisterScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadPublicSettings = async () => {
      try {
        const settings = await getPublicSystemSettings();
        if (!isActive) {
          return;
        }
        setRegistrationEnabled(settings.registrationEnabled);
        setSettingsLoaded(true);
        if (!settings.registrationEnabled) {
          router.replace('/(auth)/login');
        }
      } catch (_err) {
        if (!isActive) {
          return;
        }
        setRegistrationEnabled(false);
        setSettingsLoaded(true);
        router.replace('/(auth)/login');
      }
    };

    void loadPublicSettings();

    return () => {
      isActive = false;
    };
  }, [router]);

  if (!settingsLoaded) {
    return (
      <Screen>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>正在检查注册入口...</Text>
        </View>
      </Screen>
    );
  }

  if (!registrationEnabled) {
    return null;
  }

  const onSubmit = async () => {
    if (!nickname.trim() || !email.trim() || !password.trim()) {
      setError('请完整填写注册信息');
      return;
    }
    if (password.length < 6) {
      setError('密码长度至少为6位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入密码不一致');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await api.post<AuthResponse>('/auth/register', {
        email: email.trim(),
        password,
        nickname: nickname.trim(),
      });

      login(mapApiUserToMobileUser(response.data.user), response.data.access_token);
      router.replace('/(tabs)/home');
    } catch (err: any) {
      const message = extractApiErrorMessage(err, '注册失败，请稍后重试', {
        apiBaseUrl: API_BASE_URL,
      });
      if (__DEV__) {
        setError(`${message}\n${extractApiDebugDetails(err)}`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.logo}>V-SAVE</Text>
        <Text style={styles.title}>创建账号</Text>
        <Text style={styles.subtitle}>注册后即可在 iOS 端使用完整下载能力</Text>
      </View>

      <View style={styles.container}>
        <View style={styles.inputWrap}>
          <Ionicons name="person-outline" size={16} color={colors.textMuted} />
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder="昵称"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrap}>
          <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="邮箱"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrap}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="密码（至少6位）"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.inputWrap}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="确认密码"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primaryButton} onPress={onSubmit} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="person-add-outline" size={16} color="#fff" />
              <Text style={styles.primaryButtonText}>注册并登录</Text>
            </>
          )}
        </Pressable>

        <Link href="/(auth)/login" asChild>
          <Pressable>
            <Text style={styles.linkText}>已有账号？返回登录</Text>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#C7D8FF',
    backgroundColor: '#E7F0FF',
    padding: 16,
    gap: 6,
  },
  logo: {
    color: colors.primaryDark,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontSize: 22,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  container: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  inputWrap: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 4,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  linkText: {
    marginTop: 8,
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '700',
  },
});
