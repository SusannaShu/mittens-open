/**
 * Pendant Feed Screen -- Full capture timeline.
 *
 * Shows all pendant captures (frames + audio) in reverse chronological order.
 * Accessible from the Profile tab's Pendant section.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../lib/theme';
import { usePendantFeed } from '../lib/hooks/pendant/usePendantFeed';
import { PendantCaptureCard } from '../components/pendant/PendantCaptureCard';
import { CaptureDetailModal } from '../components/pendant/CaptureDetailModal';
import { PendantCapture } from '../lib/services/pendant/pendantStore';

type FilterType = 'all' | 'vision' | 'voice';

export default function PendantFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { captures, todayStats, isLoading } = usePendantFeed();
  const [filter, setFilter] = React.useState<FilterType>('all');
  const [selectedCapture, setSelectedCapture] = useState<PendantCapture | null>(null);

  const filteredCaptures = React.useMemo(() => {
    if (filter === 'vision') return captures.filter((c) => c.type === 'MOTION');
    if (filter === 'voice') return captures.filter((c) => c.type === 'DOUBLE_TAP');
    return captures;
  }, [captures, filter]);

  const handleCapturePress = useCallback((capture: PendantCapture) => {
    setSelectedCapture(capture);
  }, []);

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{todayStats.motionCount}</Text>
          <Text style={styles.statLabel}>Frames</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{todayStats.audioCount}</Text>
          <Text style={styles.statLabel}>Recordings</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{todayStats.totalCount}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        {(['all', 'vision', 'voice'] as FilterType[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterText,
                filter === f && styles.filterTextActive,
              ]}
            >
              {f === 'all' ? 'All' : f === 'vision' ? 'Vision' : 'Voice'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  ), [todayStats, filter]);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Feather name="disc" size={32} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>No captures yet</Text>
      <Text style={styles.emptyBody}>
        Your Mittens pendant will capture frames on motion and audio on
        double-tap. They will appear here in real time.
      </Text>
    </View>
  ), []);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <View style={styles.container}>
        {/* Custom Header */}
        <View style={[styles.customHeader, { paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 40 : 20) }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Feather name="chevron-left" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Mittens Pendant</Text>
          </View>
          <View style={styles.headerRight}>
            <Image source={require('../assets/icon.png')} style={{ width: 26, height: 26, borderRadius: 13 }} />
          </View>
        </View>

        <FlatList
          data={filteredCaptures}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PendantCaptureCard capture={item} onPress={handleCapturePress} />
          )}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <CaptureDetailModal
        capture={selectedCapture}
        visible={!!selectedCapture}
        onClose={() => setSelectedCapture(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xs,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterBtnActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: '#FFF',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },
});
