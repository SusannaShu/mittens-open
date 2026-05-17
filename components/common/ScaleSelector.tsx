import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing } from '../../lib/theme';

interface ScaleSelectorProps {
  label: string;
  value: number | null;
  onChange: (val: number | null) => void;
  min: number;
  max: number;
  step?: number;
  labels: { start: string; center?: string; end: string };
  formatValue?: (val: number) => string;
}

export function ScaleSelector({
  label, value, onChange, min, max, step = 1, labels, formatValue
}: ScaleSelectorProps) {
  const options = [];
  for (let i = min; i <= max; i += step) {
    options.push(i);
  }

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dotsContainer}>
        {options.map((n) => {
          const isActive = value === n;
          return (
            <TouchableOpacity
              key={n}
              style={[styles.dot, isActive && styles.dotActive]}
              onPress={() => onChange(isActive ? null : n)}
              activeOpacity={0.6}
            >
              <Text style={[styles.dotText, isActive && styles.dotTextActive]}>
                {formatValue ? formatValue(n) : n}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.labelsContainer}>
        <Text style={styles.edgeLabel}>{labels.start}</Text>
        {labels.center && <Text style={styles.edgeLabel}>{labels.center}</Text>}
        <Text style={styles.edgeLabel}>{labels.end}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600'
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center'
  },
  dotActive: {
    backgroundColor: colors.textPrimary
  },
  dotText: {
    fontSize: 8,
    fontWeight: '700',
    color: colors.textMuted
  },
  dotTextActive: {
    color: colors.bg
  },
  labelsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  edgeLabel: {
    fontSize: 8,
    color: colors.textMuted
  }
});
