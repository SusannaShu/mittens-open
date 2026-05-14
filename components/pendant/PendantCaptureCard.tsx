/**
 * PendantCaptureCard -- Displays a single pendant capture event.
 *
 * Shows the frame thumbnail (if captured), event type badge,
 * timestamp, and any brain response or transcript.
 */

import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { PendantCapture } from '../../lib/services/pendant/pendantStore';

interface Props {
  capture: PendantCapture;
  onPress?: (capture: PendantCapture) => void;
  /** When true, show selection checkbox */
  selectionMode?: boolean;
  /** Whether this card is selected */
  selected?: boolean;
  /** Toggle selection on tap in selection mode */
  onToggleSelect?: (id: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return formatTime(ts);
}

export function PendantCaptureCard({
  capture,
  onPress,
  selectionMode,
  selected,
  onToggleSelect,
}: Props) {
  const isAudio = capture.type === 'BUTTON_PRESS';
  const icon = isAudio ? 'mic' : 'camera';
  const label = isAudio ? 'Voice' : 'Vision';

  const handlePress = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(capture.id);
    } else {
      onPress?.(capture);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      activeOpacity={0.7}
      onPress={handlePress}
      disabled={!onPress && !selectionMode}
    >
      {/* Selection checkbox */}
      {selectionMode && (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Feather name="check" size={12} color="#FFF" />}
        </View>
      )}

      {/* Frame thumbnail */}
      {capture.framePath ? (
        <Image
          source={{ uri: `file://${capture.framePath}` }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumbnail, styles.placeholderThumb]}>
          <Feather name={icon} size={20} color={colors.textMuted} />
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {/* Header: badge + time */}
        <View style={styles.header}>
          <View style={[styles.badge, isAudio ? styles.badgeAudio : styles.badgeVision]}>
            <Feather name={icon} size={10} color="#FFF" />
            <Text style={styles.badgeText}>{label}</Text>
          </View>
          <Text style={styles.time}>{formatRelative(capture.timestamp)}</Text>
        </View>

        {/* Transcript (audio) */}
        {capture.transcript && (
          <Text style={styles.transcript} numberOfLines={2}>
            "{capture.transcript}"
          </Text>
        )}

        {/* Brain response */}
        {capture.brainResponse ? (
          <Text style={styles.response} numberOfLines={2}>
            {capture.brainResponse}
          </Text>
        ) : (
          <Text style={styles.pending}>
            {capture.processed ? 'Tap to view' : 'Processing...'}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardSelected: {
    borderColor: '#555',
    backgroundColor: '#1A1A1A',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#333',
    borderColor: '#666',
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: '#EDEDED',
  },
  placeholderThumb: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeVision: {
    backgroundColor: '#333',
  },
  badgeAudio: {
    backgroundColor: '#666',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 11,
    color: colors.textMuted,
  },
  transcript: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  response: {
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 16,
  },
  pending: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
