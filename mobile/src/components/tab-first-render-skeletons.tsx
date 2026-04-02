import { StyleSheet, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SkeletonBlock } from '@/components/skeleton-block';
import { colors } from '@/constants/theme';
import { resolveAccountPagePresentation } from '@/lib/account-page-presentation';

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
  const pagePresentation = resolveAccountPagePresentation();

  return (
    <Screen>
      <View style={styles.accountHero}>
        <View style={styles.accountHeroOrbLarge} />
        <View style={styles.accountHeroOrbSmall} />
        <SkeletonBlock width={90} height={90} radius={45} />
        <View style={styles.accountHeroMeta}>
          <View style={styles.accountHeroTitleRow}>
            <SkeletonBlock width="52%" height={24} radius={12} />
            <SkeletonBlock width={30} height={30} radius={15} />
          </View>
          <SkeletonBlock width="76%" height={14} radius={7} />
          <View style={styles.accountHeroBadgeRow}>
            <SkeletonBlock width={92} height={28} radius={14} />
          </View>
        </View>
      </View>

      <View
        style={[
          styles.accountContentShell,
          pagePresentation.contentLayout === 'single-column' &&
            styles.accountContentShellSingleColumn,
        ]}
      >
        <View style={styles.accountPrimaryPanel}>
          <View style={styles.accountPrimaryHeaderRow}>
            <SkeletonBlock width="34%" height={20} radius={10} />
            <SkeletonBlock width={72} height={28} radius={14} />
          </View>
          <View style={styles.accountDetailCard}>
            <AccountRowSkeleton />
            <AccountRowSkeleton />
            <AccountRowSkeleton />
            <AccountRowSkeleton last />
          </View>
          <SkeletonBlock width="100%" height={48} radius={16} />
        </View>
      </View>
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

function AccountRowSkeleton({ last = false }: { last?: boolean }) {
  return (
    <View style={[styles.rowSkeleton, last && styles.rowSkeletonLast]}>
      <SkeletonBlock width={72} height={14} radius={7} />
      <SkeletonBlock width={132} height={14} radius={7} />
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
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#7EB1FF',
    borderRadius: 28,
    backgroundColor: '#2563EB',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountHeroOrbLarge: {
    position: 'absolute',
    right: -26,
    top: -34,
    width: 148,
    height: 148,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  accountHeroOrbSmall: {
    position: 'absolute',
    left: -18,
    bottom: -36,
    width: 112,
    height: 112,
    borderRadius: 999,
    backgroundColor: 'rgba(147,197,253,0.18)',
  },
  accountHeroMeta: {
    flex: 1,
    gap: 8,
  },
  accountHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountHeroBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  accountContentShell: {
    gap: 14,
  },
  accountContentShellSingleColumn: {
    flexDirection: 'column',
  },
  accountPrimaryPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.card,
    padding: 16,
    gap: 12,
  },
  accountPrimaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  accountDetailCard: {
    borderWidth: 1,
    borderColor: '#E3EBFB',
    borderRadius: 18,
    backgroundColor: '#FBFDFF',
    overflow: 'hidden',
  },
  rowSkeleton: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E7EEFC',
  },
  rowSkeletonLast: {
    borderBottomWidth: 0,
  },
});
