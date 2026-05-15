/**
 * PendantStatusBar -- Compact pendant connection + capture status.
 *
 * Shows connection state, today's capture count, and last event time.
 * Designed to sit inside a profile section card.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

interface Props {
  isConnected: boolean;
  todayMotionCount: number;
  todayAudioCount: number;
  lastEventTime?: number;
  onPress?: () => void;
}

function formatLastEvent(ts?: number): string {
  if (!ts) return 'No events';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return 'Yesterday';
}

export function PendantStatusBar({
  isConnected,
  todayMotionCount,
  todayAudioCount,
  lastEventTime,
  onPress,
}: Props) {
  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={0.7}
      onPress={onPress}
      disabled={!onPress}
    >
      {/* Connection status */}
      <View style={styles.statusRow}>
        <View style={styles.statusDotContainer}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#333' : '#CCC' },
            ]}
          />
          <Text style={styles.statusLabel}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.textMuted} />
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Feather name="camera" size={12} color={colors.textMuted} />
          <Text style={styles.statValue}>{todayMotionCount}</Text>
          <Text style={styles.statLabel}>vision</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Feather name="mic" size={12} color={colors.textMuted} />
          <Text style={styles.statValue}>{todayAudioCount}</Text>
          <Text style={styles.statLabel}>voice</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Feather name="clock" size={12} color={colors.textMuted} />
          <Text style={styles.statLabel}>{formatLastEvent(lastEventTime)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusDotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: spacing.xs,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: colors.border,
  },
});
