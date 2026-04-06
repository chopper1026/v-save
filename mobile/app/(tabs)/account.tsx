import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/screen';
import { AccountTabSkeleton } from '@/components/tab-first-render-skeletons';
import { colors } from '@/constants/theme';
import { api, mapApiUserToMobileUser } from '@/lib/api';
import {
  resolveAccountCoverPresentation,
  resolveAccountPagePresentation,
} from '@/lib/account-page-presentation';
import { cleanupDuplicateDownloadAlbums } from '@/lib/media-album-maintenance';
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

function DetailRow({
  label,
  value,
  caption,
  onPress,
  isLast = false,
}: {
  label: string;
  value: string;
  caption?: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const content = (
    <>
      <View style={styles.detailRowMeta}>
        <Text style={styles.detailRowLabel}>{label}</Text>
        {caption ? (
          <Text style={styles.detailRowCaption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      <View style={styles.detailRowValueWrap}>
        <Text style={styles.detailRowValue} numberOfLines={1}>
          {value}
        </Text>
        {onPress ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={[styles.detailRow, isLast && styles.detailRowLast]}>{content}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.detailRow,
        isLast && styles.detailRowLast,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
}

export default function AccountScreen() {
  const coverPresentation = resolveAccountCoverPresentation();
  const pagePresentation = resolveAccountPagePresentation();
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
  const [cleaningAlbums, setCleaningAlbums] = useState(false);
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

  const runDownloadAlbumCleanup = useCallback(async () => {
    try {
      setCleaningAlbums(true);
      const result = await cleanupDuplicateDownloadAlbums(MediaLibrary);

      if (result.foundAlbums === 0) {
        Alert.alert('无需清理', '没有找到 V-SAVE 相册。');
        return;
      }

      if (result.deletedAlbums === 0) {
        Alert.alert('无需清理', '当前只有一个 V-SAVE 相册，没有重复项。');
        return;
      }

      const mergedSummary = result.mergedAssets
        ? `，并补合并 ${result.mergedAssets} 个项目`
        : '';
      Alert.alert(
        '清理完成',
        `已删除 ${result.deletedAlbums} 个重复 V-SAVE 相册${mergedSummary}。视频仍保留在系统图库里。`
      );
    } catch (err: any) {
      Alert.alert(
        '清理失败',
        getErrorMessage(err, '清理重复相册失败，请稍后重试')
      );
    } finally {
      setCleaningAlbums(false);
    }
  }, []);

  const onPressCleanupDownloadAlbums = useCallback(() => {
    Alert.alert(
      '清理重复 V-SAVE 相册',
      '会把所有同名 V-SAVE 相册里的内容合并到一个相册，并删除多余和空相册。不会删除视频本身。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '开始清理',
          onPress: () => {
            void runDownloadAlbumCleanup();
          },
        },
      ]
    );
  }, [runDownloadAlbumCleanup]);

  const profileDirty =
    String(profile?.nickname || '').trim() !== String(nickname || '').trim() ||
    String(profile?.avatar || '') !== String(avatar || '');

  const statusCode = profile?.accountStatus || user?.accountStatus || 'ACTIVE';
  const statusLabel = statusCode === 'DISABLED' ? '禁用' : '启用';
  const roleLabel =
    (profile?.role || user?.role || 'USER') === 'SUPER_ADMIN'
      ? '超级管理员'
      : '普通用户';
  const displayName = nickname || profile?.nickname || user?.name || '未设置昵称';
  const displayEmail = profile?.email || user?.email || '--';
  const avatarInitial = displayName.slice(0, 1).toUpperCase() || 'U';
  const maskedPhone = phone ? maskPhone(phone) : '未绑定';
  const downloadCount = String(profile?.downloadCount ?? user?.downloadCount ?? 0);
  const profileStatusLabel = profileDirty ? '待保存' : '已同步';
  const detailRows = pagePresentation.detailFields.map((field) => {
    if (field === 'phone') {
      return {
        key: field,
        label: '手机号',
        value: maskedPhone,
        caption: phone ? '已绑定，可随时修改' : '未绑定，点击添加',
        onPress: () => openEditor('phone'),
      };
    }

    if (field === 'email') {
      return {
        key: field,
        label: '邮箱',
        value: displayEmail,
      };
    }

    if (field === 'status') {
      return {
        key: field,
        label: '账号状态',
        value: statusLabel,
      };
    }

    return {
      key: field,
      label: '累计下载',
      value: `${downloadCount} 次`,
    };
  });

  if (loading) {
    return <AccountTabSkeleton />;
  }

  return (
    <Screen>
      <View style={styles.heroCard}>
        <View style={styles.heroOrbLarge} />
        <View style={styles.heroOrbSmall} />

        <View style={styles.heroRow}>
          <Pressable
            onPress={pickAvatar}
            style={({ pressed }) => [styles.avatarWrap, pressed && styles.avatarWrapPressed]}
            accessibilityRole="button"
            accessibilityHint={
              coverPresentation.avatarInteraction === 'press-avatar'
                ? '点按更换头像'
                : undefined
            }
          >
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>{avatarInitial}</Text>
              </View>
            )}
            <View style={styles.avatarAction}>
              <Ionicons name="camera-outline" size={13} color="#fff" />
            </View>
          </Pressable>

          <View style={styles.heroMeta}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              {coverPresentation.nicknameInteraction === 'inline-edit-icon' ? (
                <Pressable
                  onPress={() => openEditor('nickname')}
                  style={({ pressed }) => [
                    styles.nicknameEditBtn,
                    pressed && styles.nicknameEditBtnPressed,
                  ]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityHint="点按编辑昵称"
                >
                  <Ionicons name="pencil" size={13} color="#fff" />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.email} numberOfLines={1}>
              {displayEmail}
            </Text>

            <View style={styles.heroBadges}>
              <View style={styles.heroBadge}>
                <Ionicons name="shield-checkmark-outline" size={13} color="#fff" />
                <Text style={styles.heroBadgeText}>{roleLabel}</Text>
              </View>
              {coverPresentation.showStatusBadge ? (
                <View style={styles.heroBadge}>
                  <Ionicons name="pulse-outline" size={13} color="#fff" />
                  <Text style={styles.heroBadgeText}>{statusLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.contentShell,
          pagePresentation.contentLayout === 'single-column' &&
            styles.contentShellSingleColumn,
        ]}
      >
        <View style={styles.primaryPanel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitleCompact}>账户资料</Text>
            <View
              style={[
                styles.panelStatusChip,
                profileDirty
                  ? styles.panelStatusChipPending
                  : styles.panelStatusChipSynced,
              ]}
            >
              <Ionicons
                name={
                  profileDirty
                    ? 'time-outline'
                    : 'checkmark-circle-outline'
                }
                size={13}
                color={profileDirty ? colors.warning : colors.primaryDark}
              />
              <Text
                style={[
                  styles.panelStatusText,
                  profileDirty
                    ? styles.panelStatusTextPending
                    : styles.panelStatusTextSynced,
                ]}
              >
                {profileStatusLabel}
              </Text>
            </View>
          </View>

          <View style={styles.detailList}>
            {detailRows.map((row, index) => (
              <DetailRow
                key={row.key}
                label={row.label}
                value={row.value}
                caption={row.caption}
                onPress={row.onPress}
                isLast={index === detailRows.length - 1}
              />
            ))}
          </View>

          {!!error ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          {profileDirty || savingProfile ? (
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && profileDirty && styles.primaryBtnPressed,
              ]}
              onPress={() => {
                void onSaveProfile();
              }}
              disabled={savingProfile}
            >
              {savingProfile ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={15} color="#fff" />
                  <Text style={styles.primaryText}>保存资料</Text>
                </>
              )}
            </Pressable>
          ) : (
            <View style={styles.syncedHint}>
              <Ionicons
                name="checkmark-circle-outline"
                size={16}
                color={colors.primaryDark}
              />
              <Text style={styles.syncedHintText}>资料已同步</Text>
            </View>
          )}

          {Platform.OS === 'ios' ? (
            <Pressable
              style={({ pressed }) => [
                styles.maintenanceBtn,
                pressed && !cleaningAlbums && styles.maintenanceBtnPressed,
              ]}
              onPress={onPressCleanupDownloadAlbums}
              disabled={cleaningAlbums}
            >
              {cleaningAlbums ? (
                <ActivityIndicator color={colors.primaryDark} size="small" />
              ) : (
                <>
                  <Ionicons name="albums-outline" size={18} color={colors.primaryDark} />
                  <View style={styles.maintenanceMeta}>
                    <Text style={styles.maintenanceTitle}>清理重复 V-SAVE 相册</Text>
                    <Text style={styles.maintenanceCaption}>
                      合并成一个相册，删除多余和空相册
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && styles.logoutBtnPressed,
          ]}
          onPress={logout}
        >
          <Ionicons name="log-out-outline" size={16} color={colors.danger} />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </View>

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
  heroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#7EB1FF',
    borderRadius: 28,
    backgroundColor: '#2563EB',
    padding: 18,
    gap: 16,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  heroOrbLarge: {
    position: 'absolute',
    right: -26,
    top: -34,
    width: 148,
    height: 148,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroOrbSmall: {
    position: 'absolute',
    left: -18,
    bottom: -36,
    width: 112,
    height: 112,
    borderRadius: 999,
    backgroundColor: 'rgba(147,197,253,0.18)',
  },
  heroRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  avatarWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.48)',
    shadowColor: 'rgba(15,23,42,0.28)',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  avatarWrapPressed: {
    transform: [{ scale: 0.985 }],
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  avatarAction: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  avatarPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '900',
  },
  heroMeta: {
    flex: 1,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  nicknameEditBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  nicknameEditBtnPressed: {
    transform: [{ scale: 0.96 }],
  },
  email: {
    color: 'rgba(239,246,255,0.84)',
    fontSize: 12.5,
  },
  heroBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  heroBadgeText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '800',
  },
  contentShell: {
    gap: 14,
  },
  contentShellSingleColumn: {
    flexDirection: 'column',
  },
  primaryPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#D9E5FB',
    backgroundColor: colors.card,
    padding: 16,
    gap: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  panelTitleCompact: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  panelStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  panelStatusChipSynced: {
    borderColor: '#D6E4FF',
    backgroundColor: '#EEF4FF',
  },
  panelStatusChipPending: {
    borderColor: '#FED7AA',
    backgroundColor: '#FFF7ED',
  },
  panelStatusText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  panelStatusTextSynced: {
    color: colors.primaryDark,
  },
  panelStatusTextPending: {
    color: colors.warning,
  },
  detailList: {
    borderWidth: 1,
    borderColor: '#E3EBFB',
    borderRadius: 18,
    backgroundColor: '#FBFDFF',
    overflow: 'hidden',
  },
  detailRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E7EEFC',
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    backgroundColor: '#F6F9FF',
  },
  detailRowMeta: {
    flex: 1,
    gap: 4,
  },
  detailRowLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  detailRowCaption: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  detailRowValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 1,
  },
  detailRowValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    maxWidth: 160,
    textAlign: 'right',
  },
  errorBanner: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontSize: 12.5,
    lineHeight: 18,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  primaryBtnPressed: {
    transform: [{ scale: 0.988 }],
  },
  syncedHint: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D6E4FF',
    backgroundColor: '#F7FAFF',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  syncedHintText: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 13.5,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  maintenanceBtn: {
    minHeight: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D6E4FF',
    backgroundColor: '#F7FAFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  maintenanceBtnPressed: {
    transform: [{ scale: 0.988 }],
  },
  maintenanceMeta: {
    flex: 1,
    gap: 2,
  },
  maintenanceTitle: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  maintenanceCaption: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  logoutBtn: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  logoutBtnPressed: {
    transform: [{ scale: 0.988 }],
  },
  logoutText: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 13.5,
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
    backgroundColor: colors.cardMuted,
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
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
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
    paddingHorizontal: 16,
  },
  modalBtnPrimaryText: {
    color: '#fff',
    fontWeight: '800',
  },
});
