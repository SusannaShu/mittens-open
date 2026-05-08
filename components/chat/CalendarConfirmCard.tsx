/**
 * CalendarConfirmCard -- confirmation card for events extracted from email.
 * Shows event details with Add to Calendar / Edit / Skip actions.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { EmailExtractedEvent } from '../../lib/pipelines/types';

interface CalendarConfirmCardProps {
  event: EmailExtractedEvent;
  onAddToCalendar?: (event: EmailExtractedEvent) => void;
  onSkip?: () => void;
}

function formatEventTime(event: EmailExtractedEvent): string {
  const parts: string[] = [];

  if (event.date) {
    try {
      const d = new Date(event.date);
      parts.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    } catch {
      parts.push(event.date);
    }
  }

  if (event.startTime) {
    const timeStr = event.endTime
      ? `${event.startTime} - ${event.endTime}`
      : event.startTime;
    parts.push(timeStr);
  }

  return parts.join(' at ');
}

export default function CalendarConfirmCard({ event, onAddToCalendar, onSkip }: CalendarConfirmCardProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [skipped, setSkipped] = useState(false);

  if (skipped) return null;

  const timeStr = formatEventTime(event);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Feather name="calendar" size={16} color={colors.textPrimary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
          {timeStr ? <Text style={styles.eventTime}>{timeStr}</Text> : null}
        </View>
      </View>

      {/* Details */}
      <View style={styles.details}>
        {event.location ? (
          <View style={styles.detailRow}>
            <Feather name="map-pin" size={12} color={colors.textMuted} />
            <Text style={styles.detailText}>{event.location}</Text>
          </View>
        ) : null}
        {event.participants && event.participants.length > 0 ? (
          <View style={styles.detailRow}>
            <Feather name="users" size={12} color={colors.textMuted} />
            <Text style={styles.detailText}>{event.participants.join(', ')}</Text>
          </View>
        ) : null}
      </View>

      {/* Actions */}
      {!added ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => {
              setSkipped(true);
              onSkip?.();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, adding && styles.addBtnDisabled]}
            onPress={async () => {
              if (adding) return;
              setAdding(true);
              try {
                await onAddToCalendar?.(event);
                setAdded(true);
              } catch {
                setAdding(false);
              }
            }}
            activeOpacity={0.7}
            disabled={adding}
          >
            {adding ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="plus" size={13} color="#fff" />
                <Text style={styles.addText}>Add to calendar</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.addedBadge}>
          <Feather name="check-circle" size={14} color="#4CAF50" />
          <Text style={styles.addedText}>Added to calendar</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#ECECEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 19,
  },
  eventTime: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  details: {
    marginTop: 8,
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addedText: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '600',
  },
});
