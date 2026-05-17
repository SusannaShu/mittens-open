import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';

export const LIFE_CATS = ['work', 'health', 'play', 'love'] as const;
export const LIFE_ICONS: Record<string, string> = {
  work: 'monitor', health: 'activity', play: 'music', love: 'heart',
};

interface LifeDesignSelectorProps {
  lifeCats: Record<string, number>;
  onChange: (cat: string, val: number) => void;
}

export function LifeDesignSelector({ lifeCats, onChange }: LifeDesignSelectorProps) {
  return (
    <View style={styles.lifeCatContainer}>
      {LIFE_CATS.map((cat) => {
        const val = lifeCats[cat] || 0;
        return (
          <View key={cat} style={styles.lifeCatRow}>
            <Feather name={LIFE_ICONS[cat] as any} size={14} color={colors.textSecondary} />
            <Text style={styles.lifeCatLabel}>{cat}</Text>
            <View style={styles.lifeCatBar}>
              {[0, 2, 4, 6, 8, 10].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.lifeCatDot, val >= v && v > 0 && styles.lifeCatDotActive]}
                  onPress={() => onChange(cat, v === val ? 0 : v)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.lifeCatDotText, val >= v && v > 0 && styles.lifeCatDotTextActive]}>
                    {v === 0 ? '-' : v / 2}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  lifeCatContainer: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  lifeCatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lifeCatLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    width: 50,
    textTransform: 'capitalize',
  },
  lifeCatBar: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lifeCatDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lifeCatDotActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  lifeCatDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
  },
  lifeCatDotTextActive: {
    color: colors.bg,
  },
});
