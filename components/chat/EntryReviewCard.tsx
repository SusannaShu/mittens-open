/**
 * EntryReviewCard -- Inline cards for logged entries (meals + activities).
 * No confirm step -- entries are auto-logged. Cards show Edit + Delete always.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

export interface PendingEntry {
  entryType: 'meal' | 'activity' | 'fridge' | 'supplement' | 'selfie' | 'other' | 'place';
  activitySubtype?: string;
  name: string;
  mealType?: string;
  placeType?: string;
  items?: Array<{ name: string; portion_g?: number; household_portion?: string; nutrients?: Record<string, number> }>;
  itemCount?: number;
  imageUrl?: string | null;
  imageId?: number | null;
  imageIds?: number[] | null;
  vitaminD?: number;
  duration_min?: number;
  coverage_pct?: number;
  sunscreen?: boolean;
  needsFollowUp?: string[];
  reasoning?: string;
  _confirmed?: boolean;
  _activityId?: number;
}

interface EntryReviewCardProps {
  entries: PendingEntry[];
  onEdit?: (entry: PendingEntry, index: number) => void;
  onDismiss?: (index: number) => void;
  // Legacy -- kept for compat but unused
  onConfirm?: (entries: PendingEntry[]) => void;
  confirmed?: boolean;
}

const ENTRY_ICONS: Record<string, string> = {
  meal: 'circle', activity: 'zap', fridge: 'package', supplement: 'plus-circle',
  sun: 'sun', bike: 'navigation', run: 'trending-up', walk: 'map-pin',
  work: 'monitor', social: 'users', rest: 'moon', stress: 'alert-circle',
  soul: 'heart', commute: 'truck', cooking: 'coffee', workout: 'zap', place: 'map-pin', other: 'circle',
};

function EntryCard({ entry, index, onEdit, onDismiss }: {
  entry: PendingEntry; index: number;
  onEdit?: (entry: PendingEntry, index: number) => void;
  onDismiss?: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActivity = entry.entryType === 'activity';
  const isFridge = entry.entryType === 'fridge';

  const iconName = isActivity
    ? (ENTRY_ICONS[entry.activitySubtype || ''] || 'circle')
    : (entry.entryType === 'other' && entry.activitySubtype === 'rest' 
        ? 'moon' 
        : (ENTRY_ICONS[entry.entryType] || 'circle'));

  // Summary line
  let summary = '';
  if (isFridge) {
    summary = `${entry.itemCount || 0} items detected`;
  } else if (entry.entryType === 'place') {
    summary = `${entry.placeType || 'Location'}`;
  } else if (isActivity && entry.vitaminD) {
    summary = `~${entry.duration_min || '?'} min -- +${Math.round((entry.vitaminD || 0) * 10) / 10} mcg Vitamin D`;
  } else if (isActivity) {
    summary = entry.duration_min ? `~${entry.duration_min} min` : 'Duration unknown';
  } else if (entry.entryType === 'other' && entry.activitySubtype === 'rest') {
    summary = entry.name.includes('(') ? entry.name.split('(')[1].replace(')', '') : 'Sleep logged';
  } else {
    const itemCount = entry.items?.length || entry.itemCount || 0;
    const totalG = entry.items?.reduce((sum, i) => sum + (i.portion_g || 0), 0) || 0;
    summary = `${itemCount} item${itemCount !== 1 ? 's' : ''} -- ${totalG}g total`;
  }

  // Label
  const dateLabel = (entry as any)._dateLabel || '';
  const isSleep = entry.entryType === 'other' && entry.activitySubtype === 'rest';
  const label = isActivity || entry.entryType === 'place'
    ? entry.name
    : isFridge
      ? 'Pantry Update'
      : isSleep
        ? 'Sleep Log'
        : `${entry.mealType || 'meal'}${dateLabel} -- ${entry.name}`;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => entry.items && entry.items.length > 0 && setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Feather name={iconName as any} size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardLabel} numberOfLines={1}>{label}</Text>
          <Text style={styles.cardSummary}>{summary}</Text>
        </View>
        {entry.imageUrl && (
          <Image source={{ uri: entry.imageUrl }} style={styles.thumb} />
        )}
      </TouchableOpacity>

      {/* Expanded items list */}
      {expanded && entry.items && entry.items.length > 0 && (
        <View style={styles.itemsList}>
          {entry.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPortion}>{item.household_portion || `${item.portion_g}g`}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Actions: Edit + Delete */}
      <View style={styles.actions}>
        {onEdit && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(entry, index)}>
            <Feather name="edit-2" size={13} color={colors.textPrimary} />
            <Text style={styles.actionText}>Edit</Text>
          </TouchableOpacity>
        )}
        {onDismiss && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => onDismiss(index)}>
            <Feather name="x" size={13} color="#999" />
            <Text style={[styles.actionText, { color: '#999' }]}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function EntryReviewCard({ entries, onEdit, onDismiss }: EntryReviewCardProps) {
  if (entries.length === 0) return null;

  const useHorizontal = entries.length >= 2;

  const renderCards = () =>
    entries.map((entry, i) => (
      <View key={i} style={useHorizontal ? styles.hCard : undefined}>
        <EntryCard
          entry={entry}
          index={i}
          onEdit={onEdit}
          onDismiss={onDismiss}
        />
      </View>
    ));

  return (
    <View style={styles.container}>
      {useHorizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hScroll}
        >
          {renderCards()}
        </ScrollView>
      ) : (
        renderCards()
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginTop: 8,
  },
  hScroll: {
    gap: 8,
    paddingRight: 8,
  },
  hCard: {
    width: 220,
  },
  card: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  cardSummary: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    marginLeft: 8,
  },
  itemsList: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  itemName: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  itemPortion: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
