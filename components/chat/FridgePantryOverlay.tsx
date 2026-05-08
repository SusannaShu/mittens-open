/**
 * Fridge Pantry Overlay -- Full-screen inventory view
 * shown after a fridge photo is analyzed.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const FRESHNESS_COLORS: Record<string, string> = {
  fresh: '#2ECC71', good: '#27AE60', use_soon: '#F39C12', questionable: '#E74C3C',
};
const FRESHNESS_LABELS: Record<string, string> = {
  fresh: 'Fresh', good: 'Good', use_soon: 'Use Soon', questionable: 'Check',
};

interface FridgePantryOverlayProps {
  pantryItems: any[];
  fridgeResult: any;
  onClose: () => void;
}

export default function FridgePantryOverlay({ pantryItems, fridgeResult, onClose }: FridgePantryOverlayProps) {
  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.pantryTitle}>Fridge Inventory</Text>
        <Text style={styles.pantrySubtitle}>
          {pantryItems.length} item{pantryItems.length !== 1 ? 's' : ''} detected
        </Text>

        {pantryItems.map((item: any, idx: number) => {
          const freshColor = FRESHNESS_COLORS[item.freshness] || '#999';
          const freshLabel = FRESHNESS_LABELS[item.freshness] || item.freshness;
          return (
            <View key={idx} style={styles.pantryItemCard}>
              <View style={styles.pantryItemHeader}>
                <View style={[styles.freshDot, { backgroundColor: freshColor }]} />
                <Text style={styles.pantryItemName}>{item.foodName || item.name}</Text>
                <Text style={[styles.freshTag, { color: freshColor }]}>{freshLabel}</Text>
              </View>
              {item.quantity && <Text style={styles.pantryQty}>{item.quantity}</Text>}
            </View>
          );
        })}

        {fridgeResult?.grocerySuggestions?.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionLabel}>GROCERY SUGGESTIONS</Text>
            {fridgeResult.grocerySuggestions.map((s: any, i: number) => (
              <View key={i} style={styles.groceryRow}>
                <Text style={styles.groceryFood}>{s.food}</Text>
                <Text style={styles.groceryHelps}>{s.helpsWith}</Text>
              </View>
            ))}
          </View>
        )}

        {fridgeResult?.nutrientGaps?.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionLabel}>NUTRIENT GAPS TO FILL</Text>
            {fridgeResult.nutrientGaps.slice(0, 5).map((g: any, i: number) => (
              <View key={i} style={styles.gapRow}>
                <Text style={styles.gapName}>{g.name}</Text>
                <Text style={[styles.gapPct, { color: g.status === 'low' ? '#E74C3C' : '#F39C12' }]}>
                  {g.pct}%
                </Text>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 30 }} />
      </ScrollView>

      <View style={styles.pantryActions}>
        <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={onClose}>
          <Text style={styles.actionBtnText}>Back to Chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pantryTitle: {
    fontFamily: fonts.heading,
    fontSize: 24,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  pantrySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  pantryItemCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pantryItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  freshDot: {
    width: 8, height: 8, borderRadius: 4, marginRight: 10,
  },
  pantryItemName: {
    flex: 1, fontSize: 15, fontWeight: '500',
    color: colors.textPrimary, textTransform: 'capitalize',
  },
  freshTag: { fontSize: 12, fontWeight: '600' },
  pantryQty: {
    fontSize: 13, color: colors.textMuted, marginTop: 2, marginLeft: 18,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 1.5, marginBottom: spacing.md,
  },
  groceryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  groceryFood: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize',
  },
  groceryHelps: { fontSize: 12, color: colors.textMuted },
  gapRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6,
  },
  gapName: { fontSize: 14, color: colors.textPrimary },
  gapPct: { fontSize: 14, fontWeight: '600' },
  pantryActions: {
    flexDirection: 'row', padding: spacing.lg, paddingBottom: 40,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  actionBtn: {
    backgroundColor: '#000',
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
