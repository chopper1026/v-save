import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SkeletonBlock } from '@/components/skeleton-block';
import { colors } from '@/constants/theme';

export function HistoryTabSkeleton() {
  return (
    <Screen scroll={false} bodyStyle={styles.page}>
      <View style={styles.listContent}>
        <View style={styles.headerWrap}>
          <SkeletonBlock width="38%" height={28} radius={14} />
          <SkeletonBlock width="72%" height={14} radius={7} />
          <View style={styles.filterGroup}>
            <SkeletonBlock width={42} height={12} radius={6} />
            <View style={styles.filterChipRow}>
              <SkeletonBlock width={74} height={34} radius={17} />
              <SkeletonBlock width={74} height={34} radius={17} />
              <SkeletonBlock width={74} height={34} radius={17} />
            </View>
          </View>
          <View style={styles.filterGroup}>
            <SkeletonBlock width={42} height={12} radius={6} />
            <View style={styles.filterChipRow}>
              <SkeletonBlock width={70} height={34} radius={17} />
              <SkeletonBlock width={86} height={34} radius={17} />
              <SkeletonBlock width={92} height={34} radius={17} />
            </View>
          </View>
          <View style={styles.alignEnd}>
            <SkeletonBlock width={116} height={36} radius={18} />
          </View>
        </View>

        <View style={styles.cardColumn}>
          <HistoryCardSkeleton />
          <HistoryCardSkeleton />
          <HistoryCardSkeleton />
        </View>
      </View>
    </Screen>
  );
}

export function NotificationsTabSkeleton() {
  return (
    <Screen scroll={false} bodyStyle={styles.page}>
      <View style={styles.listContent}>
        <View style={styles.headerWrap}>
          <SkeletonBlock width="34%" height={28} radius={14} />
          <SkeletonBlock width="68%" height={14} radius={7} />
          <View style={styles.actionRow}>
            <SkeletonBlock width={104} height={34} radius={17} />
            <SkeletonBlock width={104} height={34} radius={17} />
          </View>
        </View>

        <View style={styles.cardColumn}>
          <NotificationCardSkeleton />
          <NotificationCardSkeleton />
          <NotificationCardSkeleton />
        </View>
      </View>
    </Screen>
  );
}

export function AccountTabSkeleton() {
  return (
    <Screen>
      <View style={styles.accountHero}>
        <SkeletonBlock width={84} height={84} radius={42} />
        <View style={styles.accountHeroMeta}>
          <SkeletonBlock width="58%" height={22} radius={11} />
          <SkeletonBlock width="78%" height={14} radius={7} />
          <SkeletonBlock width={94} height={26} radius={13} />
        </View>
      </View>

      <View style={styles.accountCard}>
        <SkeletonBlock width={82} height={16} radius={8} />
        <AccountRowSkeleton />
        <AccountRowSkeleton />
        <AccountRowSkeleton />
        <SkeletonBlock width="100%" height={46} radius={14} />
      </View>

      <View style={styles.accountCard}>
        <SkeletonBlock width={82} height={16} radius={8} />
        <AccountInfoLineSkeleton />
        <AccountInfoLineSkeleton />
        <AccountInfoLineSkeleton />
      </View>

      <SkeletonBlock width="100%" height={48} radius={16} />
    </Screen>
  );
}

function HistoryCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <View style={styles.flexFill}>
          <SkeletonBlock width="82%" height={18} radius={9} />
          <SkeletonBlock width="54%" height={18} radius={9} style={styles.cardSpacing} />
        </View>
        <SkeletonBlock width={58} height={24} radius={12} />
      </View>
      <SkeletonBlock width="46%" height={14} radius={7} />
      <SkeletonBlock width="54%" height={14} radius={7} />
      <SkeletonBlock width={110} height={36} radius={18} />
    </View>
  );
}

function NotificationCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <SkeletonBlock width="52%" height={18} radius={9} />
        <SkeletonBlock width={10} height={10} radius={5} />
      </View>
      <SkeletonBlock width="88%" height={14} radius={7} />
      <SkeletonBlock width="74%" height={14} radius={7} />
      <SkeletonBlock width="44%" height={12} radius={6} />
    </View>
  );
}

function AccountRowSkeleton() {
  return (
    <View style={styles.rowSkeleton}>
      <SkeletonBlock width={72} height={14} radius={7} />
      <SkeletonBlock width={132} height={14} radius={7} />
    </View>
  );
}

function AccountInfoLineSkeleton() {
  return (
    <View style={styles.infoLineSkeleton}>
      <SkeletonBlock width={88} height={14} radius={7} />
      <SkeletonBlock width={112} height={14} radius={7} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 118,
    gap: 12,
  },
  headerWrap: {
    gap: 10,
  },
  filterGroup: {
    gap: 8,
  },
  filterChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  alignEnd: {
    alignItems: 'flex-end',
  },
  cardColumn: {
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexFill: {
    flex: 1,
  },
  cardSpacing: {
    marginTop: 8,
  },
  accountHero: {
    borderWidth: 1,
    borderColor: '#C5D8FF',
    borderRadius: 20,
    backgroundColor: '#E8F0FF',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountHeroMeta: {
    flex: 1,
    gap: 8,
  },
  accountCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 12,
    gap: 12,
  },
  rowSkeleton: {
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
  infoLineSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
