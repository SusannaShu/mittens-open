/**
 * Pendant Feed Screen -- Full capture timeline.
 *
 * Shows all pendant captures (frames + audio) in reverse chronological order.
 * Accessible from the Profile tab's Pendant section.
 *
 * Filtering:
 *   - Stat cards (Vision / Voice / Total) act as type filters
 *   - Time buttons (Today / Yesterday / Custom) act as date filters
 */

import React, { useCallback, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../lib/theme';
import { usePendantFeed } from '../lib/hooks/pendant/usePendantFeed';
import { PendantCaptureCard } from '../components/pendant/PendantCaptureCard';
import { CaptureDetailModal } from '../components/pendant/CaptureDetailModal';
import { PendantCapture, removeCaptures, updateCapture } from '../lib/services/pendant/pendantStore';
import { DateRangePicker } from '../components/pendant/DateRangePicker';

type TypeFilter = 'all' | 'vision' | 'voice';
type TimeFilter = 'today' | 'yesterday' | 'custom';

/** Get midnight timestamp for the start of today */
function getStartOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Get end-of-day timestamp (23:59:59.999) */
function getEndOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export default function PendantFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { captures, isLoading } = usePendantFeed();

  // Type filter (from tapping stat cards)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // Time filter
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');
  const [customRange, setCustomRange] = useState<{ start: number; end: number } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [selectedCapture, setSelectedCapture] = useState<PendantCapture | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Compute time range based on timeFilter
  const timeRange = useMemo(() => {
    const now = new Date();
    if (timeFilter === 'today') {
      return { start: getStartOfDay(now), end: getEndOfDay(now) };
    }
    if (timeFilter === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: getStartOfDay(yesterday), end: getEndOfDay(yesterday) };
    }
    if (timeFilter === 'custom' && customRange) {
      return customRange;
    }
    // Fallback: show everything
    return { start: 0, end: Date.now() };
  }, [timeFilter, customRange]);

  // Filter by time first
  const timeFilteredCaptures = useMemo(() => {
    return captures.filter(
      (c) => c.timestamp >= timeRange.start && c.timestamp <= timeRange.end
    );
  }, [captures, timeRange]);

  // Compute stats from the time-filtered set (not type-filtered)
  const stats = useMemo(() => {
    const vision = timeFilteredCaptures.filter((c) => c.type === 'MOTION').length;
    const voice = timeFilteredCaptures.filter((c) => c.type === 'BUTTON_PRESS').length;
    return { vision, voice, total: vision + voice };
  }, [timeFilteredCaptures]);

  // Then filter by type
  const filteredCaptures = useMemo(() => {
    if (typeFilter === 'vision') return timeFilteredCaptures.filter((c) => c.type === 'MOTION');
    if (typeFilter === 'voice') return timeFilteredCaptures.filter((c) => c.type === 'BUTTON_PRESS');
    return timeFilteredCaptures;
  }, [timeFilteredCaptures, typeFilter]);

  const handleCapturePress = useCallback((capture: PendantCapture) => {
    setSelectedCapture(capture);
  }, []);

  /** Retry a capture that failed with "Brain offline" */
  const handleRetry = useCallback(async (capture: PendantCapture) => {
    if (!capture.framePath) return;

    // Reset state to show processing
    updateCapture(capture.id, {
      brainResponse: undefined,
      processed: false,
      pipelineLog: undefined,
      title: undefined,
      description: undefined,
    });

    try {
      const { getSceneStreamManager } = require('../lib/services/ambient/sceneStreamManager');
      const manager = getSceneStreamManager();
      const result = await manager.onPendantFrame(capture.framePath, capture.timestamp);

      if (result) {
        if (result.summary.toLowerCase().includes('skipped')) {
          updateCapture(capture.id, {
            processed: true,
            brainResponse: result.summary,
          });
        } else {
          updateCapture(capture.id, {
            processed: true,
            brainResponse: result.summary,
            pipelineLog: result.log,
            title: result.title,
            description: result.description,
          });
        }
      }
    } catch (err: any) {
      updateCapture(capture.id, {
        processed: true,
        brainResponse: `Retry failed: ${err?.message}`,
      });
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      'Delete Selected',
      `Delete ${selectedIds.size} capture${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await removeCaptures(Array.from(selectedIds));
            setSelectedIds(new Set());
            setSelectionMode(false);
          },
        },
      ],
    );
  }, [selectedIds]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleStatCardPress = useCallback((type: TypeFilter) => {
    setTypeFilter((prev) => (prev === type ? 'all' : type));
  }, []);

  const handleTimeFilter = useCallback((tf: TimeFilter) => {
    if (tf === 'custom') {
      setShowDatePicker(true);
      return;
    }
    setTimeFilter(tf);
    setCustomRange(null);
  }, []);

  const handleCustomRangeSelected = useCallback((start: Date, end: Date) => {
    setCustomRange({ start: getStartOfDay(start), end: getEndOfDay(end) });
    setTimeFilter('custom');
    setShowDatePicker(false);
  }, []);

  // Time filter label for custom range
  const customLabel = useMemo(() => {
    if (!customRange) return 'Custom';
    const fmt = (ts: number) => {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const startStr = fmt(customRange.start);
    const endStr = fmt(customRange.end);
    return startStr === endStr ? startStr : `${startStr} - ${endStr}`;
  }, [customRange]);

  const renderHeader = useCallback(() => (
    <View style={styles.header}>
      {/* Stat cards -- act as type filter */}
      <View style={styles.statsRow}>
        <TouchableOpacity
          style={[styles.statBox, typeFilter === 'vision' && styles.statBoxActive]}
          activeOpacity={0.7}
          onPress={() => handleStatCardPress('vision')}
        >
          <Text style={[styles.statNumber, typeFilter === 'vision' && styles.statNumberActive]}>
            {stats.vision}
          </Text>
          <Text style={[styles.statLabel, typeFilter === 'vision' && styles.statLabelActive]}>
            Vision
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.statBox, typeFilter === 'voice' && styles.statBoxActive]}
          activeOpacity={0.7}
          onPress={() => handleStatCardPress('voice')}
        >
          <Text style={[styles.statNumber, typeFilter === 'voice' && styles.statNumberActive]}>
            {stats.voice}
          </Text>
          <Text style={[styles.statLabel, typeFilter === 'voice' && styles.statLabelActive]}>
            Voice
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.statBox, typeFilter === 'all' && styles.statBoxActive]}
          activeOpacity={0.7}
          onPress={() => handleStatCardPress('all')}
        >
          <Text style={[styles.statNumber, typeFilter === 'all' && styles.statNumberActive]}>
            {stats.total}
          </Text>
          <Text style={[styles.statLabel, typeFilter === 'all' && styles.statLabelActive]}>
            Total
          </Text>
        </TouchableOpacity>
      </View>

      {/* Time filter buttons */}
      <View style={styles.filterRow}>
        {(['today', 'yesterday', 'custom'] as TimeFilter[]).map((tf) => (
          <TouchableOpacity
            key={tf}
            style={[styles.filterBtn, timeFilter === tf && styles.filterBtnActive]}
            onPress={() => handleTimeFilter(tf)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.filterText,
                timeFilter === tf && styles.filterTextActive,
              ]}
            >
              {tf === 'today'
                ? 'Today'
                : tf === 'yesterday'
                  ? 'Yesterday'
                  : customLabel}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  ), [stats, typeFilter, timeFilter, customLabel, handleStatCardPress, handleTimeFilter]);

  const renderEmpty = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Feather name="disc" size={32} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>
        {timeFilter === 'today'
          ? 'No captures today'
          : timeFilter === 'yesterday'
            ? 'No captures yesterday'
            : 'No captures in this range'}
      </Text>
      <Text style={styles.emptyBody}>
        Your Mittens pendant will capture frames on motion and audio on
        button-press. They will appear here in real time.
      </Text>
    </View>
  ), [timeFilter]);

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
            {selectionMode ? (
              <TouchableOpacity onPress={exitSelectionMode}>
                <Text style={styles.selectBtnText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setSelectionMode(true)}>
                <Text style={styles.selectBtnText}>Select</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <FlatList
          data={filteredCaptures}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PendantCaptureCard
              capture={item}
              onPress={handleCapturePress}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelect}
              onRetry={handleRetry}
            />
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
        onRetry={handleRetry}
      />

      {/* Selection Action Bar */}
      {selectionMode && selectedIds.size > 0 && (
        <View style={[styles.selectionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.selectionCount}>
            {selectedIds.size} selected
          </Text>
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteSelected}>
            <Feather name="trash-2" size={16} color="#FF4444" />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Date Range Picker Modal */}
      <DateRangePicker
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        onSelect={handleCustomRangeSelected}
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
  statBoxActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statNumberActive: {
    color: '#FFF',
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  statLabelActive: {
    color: 'rgba(255,255,255,0.7)',
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
  selectBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  selectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FF4444',
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF4444',
  },
});
