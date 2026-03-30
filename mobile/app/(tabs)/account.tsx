import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { AccountTabSkeleton } from '@/components/tab-first-render-skeletons';
import { colors } from '@/constants/theme';
import { api, mapApiUserToMobileUser } from '@/lib/api';
import { useAuthStore } from '@/store/auth-store';
import type { UserProfile } from '@/types/api';

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

const estimateBase64Bytes = (base64: string): number =>
  Math.ceil((base64.length * 3) / 4);

const normalizePhone = (value: string) => String(value || '').replace(/\D+/g, '');

const maskPhone = (raw?: string | null) => {
  const digits = normalizePhone(raw || '');
  if (digits.length !== 11) {
    return raw || '--';
  }
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
};

const getErrorMessage = (err: any, fallback: string) => {
  const message = err?.response?.data?.message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && message.length) {
    return String(message[0]);
  }
  return fallback;
};

export default function AccountScreen() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const logout = useAuthStore((state) => state.logout);
  const userId = user?.id ?? null;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [error, setError] = useState('');

  const [editorType, setEditorType] = useState<'none' | 'nickname' | 'phone'>(
    'none'
  );
  const [editorValue, setEditorValue] = useState('');

  const fetchProfile = useCallback(async () => {
    try {
      setError('');
      const response = await api.get('/users/profile');
      const data = response.data as UserProfile;
      setProfile(data);
      setNickname(data.nickname || '');
      setAvatar(data.avatar || '');
      setPhone(data.phone || '');
      updateUser(mapApiUserToMobileUser(data));
    } catch (err: any) {
      setError(getErrorMessage(err, '获取个人信息失败'));
    }
  }, [updateUser]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      await fetchProfile();
      if (!cancelled) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchProfile, userId]);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('权限不足', '请允许相册权限后再选择头像');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert('头像读取失败', '请重试选择一张图片');
      return;
    }

    const avatarBytes = estimateBase64Bytes(asset.base64);
    if (avatarBytes > MAX_AVATAR_BYTES) {
      Alert.alert('头像过大', '请选择 8MB 以内的图片，或先压缩后再上传');
      return;
    }

    const nextAvatar = `data:image/jpeg;base64,${asset.base64}`;
    setAvatar(nextAvatar);
  };

  const onSaveProfile = async () => {
    try {
      setSavingProfile(true);
      setError('');
      const response = await api.patch('/users/profile', {
        nickname: String(nickname || '').trim(),
        avatar,
      });

      const data = response.data as UserProfile;
      setProfile(data);
      setNickname(data.nickname || '');
      setAvatar(data.avatar || '');
      setPhone(data.phone || '');
      updateUser(mapApiUserToMobileUser(data));
      Alert.alert('保存成功', '个人资料已更新');
    } catch (err: any) {
      setError(getErrorMessage(err, '保存失败，请稍后重试'));
    } finally {
      setSavingProfile(false);
    }
  };

  const openEditor = (type: 'nickname' | 'phone') => {
    setEditorType(type);
    setEditorValue(type === 'nickname' ? nickname : phone);
  };

  const closeEditor = (force = false) => {
    if (!force && (savingPhone || savingProfile)) {
      return;
    }
    setEditorType('none');
    setEditorValue('');
  };

  const onSubmitEditor = async () => {
    if (editorType === 'none') {
      return;
    }

    if (editorType === 'nickname') {
      const nextNickname = String(editorValue || '').trim();
      if (!nextNickname) {
        Alert.alert('提示', '昵称不能为空');
        return;
      }
      setNickname(nextNickname);
      closeEditor(true);
      return;
    }

    const normalized = normalizePhone(editorValue);
    if (!/^1\d{10}$/.test(normalized)) {
      Alert.alert('手机号格式不正确', '请输入 11 位大陆手机号');
      return;
    }

    try {
      setSavingPhone(true);
      setError('');
      const response = await api.patch('/users/account/phone', {
        phone: normalized,
      });
      const data = response.data as UserProfile;
      setProfile(data);
      setPhone(data.phone || normalized);
      setNickname(data.nickname || nickname);
      setAvatar(data.avatar || '');
      updateUser(mapApiUserToMobileUser(data));
      closeEditor(true);
      Alert.alert('保存成功', '手机号已更新');
    } catch (err: any) {
      setError(getErrorMessage(err, '手机号更新失败，请稍后重试'));
    } finally {
      setSavingPhone(false);
    }
  };

  const profileDirty =
    String(profile?.nickname || '').trim() !== String(nickname || '').trim() ||
    String(profile?.avatar || '') !== String(avatar || '');

  const statusCode = profile?.accountStatus || user?.accountStatus || 'ACTIVE';
  const statusLabel = statusCode === 'DISABLED' ? '禁用' : '启用';
  const roleLabel =
    (profile?.role || user?.role || 'USER') === 'SUPER_ADMIN'
      ? '超级管理员'
      : '普通用户';

  if (loading) {
    return <AccountTabSkeleton />;
  }

  return (
    <Screen>
      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>
                  {(profile?.nickname || user?.name || 'U').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarAction}>
              <Ionicons name="camera-outline" size={13} color="#fff" />
            </View>
          </Pressable>

          <View style={styles.heroMeta}>
            <Text style={styles.name}>{profile?.nickname || user?.name || '未设置昵称'}</Text>
            <Text style={styles.email}>{profile?.email || user?.email || '--'}</Text>
            <View style={styles.levelBadge}>
              <Ionicons name="shield-checkmark-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.levelText}>{roleLabel}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>个人资料</Text>

        <Pressable style={styles.rowItem} onPress={() => openEditor('nickname')}>
          <Text style={styles.rowLabel}>昵称</Text>
          <View style={styles.rowValueWrap}>
            <Text style={styles.rowValue} numberOfLines={1}>
              {nickname || '--'}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </View>
        </Pressable>

        <Pressable style={styles.rowItem} onPress={() => openEditor('phone')}>
          <Text style={styles.rowLabel}>手机号</Text>
          <View style={styles.rowValueWrap}>
            <Text style={styles.rowValue} numberOfLines={1}>
              {phone ? maskPhone(phone) : '未绑定，点击绑定'}
            </Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </View>
        </Pressable>

        <View style={styles.rowItem}>
          <Text style={styles.rowLabel}>邮箱</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {profile?.email || user?.email || '--'}
          </Text>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.primaryBtn, !profileDirty && styles.primaryBtnDisabled]}
          onPress={() => {
            void onSaveProfile();
          }}
          disabled={savingProfile || !profileDirty}
        >
          {savingProfile ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="save-outline" size={15} color="#fff" />
              <Text style={styles.primaryText}>
                {profileDirty ? '保存个人资料' : '资料已是最新'}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.sectionTitle}>账户概览</Text>
        <View style={styles.infoLineWrap}>
          <Text style={styles.infoLabel}>角色</Text>
          <Text style={styles.infoValue}>{roleLabel}</Text>
        </View>
        <View style={styles.infoLineWrap}>
          <Text style={styles.infoLabel}>账号状态</Text>
          <Text style={styles.infoValue}>{statusLabel}</Text>
        </View>
        <View style={styles.infoLineWrap}>
          <Text style={styles.infoLabel}>手机号</Text>
          <Text style={styles.infoValue}>{phone ? maskPhone(phone) : '未绑定'}</Text>
        </View>
        <View style={styles.infoLineWrap}>
          <Text style={styles.infoLabel}>累计下载次数</Text>
          <Text style={styles.infoValue}>
            {profile?.downloadCount ?? user?.downloadCount ?? 0}
          </Text>
        </View>
      </View>

      <Pressable style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={16} color={colors.danger} />
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>

      <Modal
        visible={editorType !== 'none'}
        transparent
        animationType="fade"
        onRequestClose={() => closeEditor()}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editorType === 'nickname'
                ? '修改昵称'
                : phone
                  ? '修改手机号'
                  : '绑定手机号'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={editorValue}
              onChangeText={setEditorValue}
              placeholder={editorType === 'nickname' ? '请输入昵称' : '请输入 11 位手机号'}
              placeholderTextColor={colors.textMuted}
              keyboardType={editorType === 'nickname' ? 'default' : 'number-pad'}
              maxLength={editorType === 'nickname' ? 30 : 11}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalBtnGhost}
                onPress={() => {
                  closeEditor();
                }}
              >
                <Text style={styles.modalBtnGhostText}>取消</Text>
              </Pressable>
              <Pressable
                style={styles.modalBtnPrimary}
                onPress={() => {
                  void onSubmitEditor();
                }}
                disabled={savingPhone || savingProfile}
              >
                {savingPhone ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>保存</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  muted: {
    color: colors.textMuted,
  },
  heroCard: {
    borderWidth: 1,
    borderColor: '#C5D8FF',
    borderRadius: 20,
    backgroundColor: '#E8F0FF',
    padding: 14,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  avatarWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#C8D8FA',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  avatarAction: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,64,175,0.9)',
    borderWidth: 1,
    borderColor: '#fff',
  },
  avatarPlaceholder: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: '800',
  },
  heroMeta: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '900',
  },
  email: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  levelBadge: {
    marginTop: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#C8D8FA',
    backgroundColor: '#EEF4FF',
  },
  levelText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  formCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 12,
    gap: 10,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  rowItem: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rowValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
    justifyContent: 'flex-end',
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    maxWidth: '72%',
    textAlign: 'right',
  },
  error: {
    color: colors.danger,
    fontSize: 12,
  },
  primaryBtn: {
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryBtnDisabled: {
    backgroundColor: colors.textMuted,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  infoLineWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoLabel: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  infoValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  logoutBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  logoutText: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13,
  },
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: '#fff',
    padding: 14,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  modalInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtnGhost: {
    minWidth: 88,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalBtnGhostText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  modalBtnPrimary: {
    minWidth: 88,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalBtnPrimaryText: {
    color: '#fff',
    fontWeight: '800',
  },
});
