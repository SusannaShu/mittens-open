/**
 * NutrientDetailSheet -- Bottom sheet showing full nutrient breakdown.
 *
 * Sections:
 *   1. Macro grid (cal, pro, carb, fat, fib, water)
 *   2. Vitamins & minerals (collapsible)
 *   3. v USDA References (accordion)
 *   4. v AI Adjustments (accordion)
 *   5. v Cooking & Absorption (accordion)
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { FoodPipelineItem, USDARefWithData } from './MealPipelineCard';
import { scaleNutrients } from '../../lib/services/food/nutrientEstimator';
import { TRIGGER_EDUCATION } from '../../lib/data/nutrientInteractions';

// ──────────── Props ────────────

interface NutrientDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Single food detail, or aggregated meal */
  food?: FoodPipelineItem;
  /** All foods for aggregated view */
  allFoods?: FoodPipelineItem[];
}

// ──────────── Nutrient labels ────────────

const NUTRIENT_INFO: Record<string, { label: string; unit: string }> = {
  calories: { label: 'Calories', unit: 'kcal' },
  protein: { label: 'Protein', unit: 'g' },
  carbs: { label: 'Carbs', unit: 'g' },
  fat: { label: 'Fat', unit: 'g' },
  fiber: { label: 'Fiber', unit: 'g' },
  water: { label: 'Water', unit: 'g' },
  vitamin_a: { label: 'Vitamin A', unit: 'mcg' },
  vitamin_c: { label: 'Vitamin C', unit: 'mg' },
  vitamin_d: { label: 'Vitamin D', unit: 'mcg' },
  vitamin_e: { label: 'Vitamin E', unit: 'mg' },
  vitamin_k: { label: 'Vitamin K', unit: 'mcg' },
  vitamin_b6: { label: 'Vitamin B6', unit: 'mg' },
  vitamin_b12: { label: 'Vitamin B12', unit: 'mcg' },
  folate: { label: 'Folate', unit: 'mcg' },
  calcium: { label: 'Calcium', unit: 'mg' },
  iron: { label: 'Iron', unit: 'mg' },
  magnesium: { label: 'Magnesium', unit: 'mg' },
  potassium: { label: 'Potassium', unit: 'mg' },
  zinc: { label: 'Zinc', unit: 'mg' },
  omega3: { label: 'Omega-3', unit: 'g' },
};

const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'water'];
const MICRO_KEYS = Object.keys(NUTRIENT_INFO).filter(k => !MACRO_KEYS.includes(k));

function fmt(val: number | undefined, unit: string): string {
  if (val === undefined || val === null) return '--';
  if (val === 0) return `0${unit}`;
  if (val < 0.01) return `<0.01${unit}`;
  if (val < 1) return `${val.toFixed(2)}${unit}`;
  if (val < 10) return `${val.toFixed(1)}${unit}`;
  return `${Math.round(val)}${unit}`;
}

// ──────────── Accordion Section ────────────

function Accordion({ title, icon, children, defaultOpen = false }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={s.accordion}>
      <TouchableOpacity style={s.accordionHeader} onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <Feather name={icon as any} size={13} color={colors.textSecondary} />
        <Text style={s.accordionTitle}>{title}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textMuted} />
      </TouchableOpacity>
      {open && <View style={s.accordionBody}>{children}</View>}
    </View>
  );
}

// ──────────── Main Component ────────────

export default function NutrientDetailSheet({
  visible, onClose, food, allFoods,
}: NutrientDetailSheetProps) {
  // Default to AI-picked ref, not first in list
  const defaultIdx = food?.usedRef && food.allRefs
    ? Math.max(0, food.allRefs.findIndex(r => r.fdcId === food.usedRef!.fdcId))
    : 0;
  const [selectedRefIdx, setSelectedRefIdx] = useState(defaultIdx);

  // Reset when food changes
  const foodId = food?.name;
  const [lastFoodId, setLastFoodId] = useState(foodId);
  if (foodId !== lastFoodId) {
    setLastFoodId(foodId);
    const newIdx = food?.usedRef && food.allRefs
      ? Math.max(0, food.allRefs.findIndex(r => r.fdcId === food.usedRef!.fdcId))
      : 0;
    setSelectedRefIdx(newIdx);
  }

  // Aggregate nutrients if viewing all foods
  const nutrients = food?.nutrients || aggregateNutrients(allFoods);
  const title = food ? food.name : 'Meal Total';
  const insets = useSafeAreaInsets();

  // Compute USDA column from selected reference
  const selectedRef = food?.allRefs?.[selectedRefIdx];
  const displayedUsda = (() => {
    if (!food || !selectedRef?.per100g) return food?.usdaNutrients;
    // Scale selected reference to this food's portion
    const scaled = scaleNutrients(selectedRef.per100g as any, food.portion_g);
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(scaled)) result[k] = v ?? 0;
    return result;
  })();

  if (!nutrients) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.sheet, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
        {/* Header */}
        <View style={s.sheetHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="chevron-down" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.sheetTitle} numberOfLines={1}>{title}</Text>
          <View style={{ width: 22 }} />
        </View>
        {food?.reasoning && (
          <Text style={s.sourceLabel}>{food.reasoning}</Text>
        )}

        <ScrollView style={s.scrollBody} showsVerticalScrollIndicator={false}>
          {/* Macros grid */}
          <View style={s.macroGrid}>
            {MACRO_KEYS.map(key => {
              const info = NUTRIENT_INFO[key];
              return (
                <View key={key} style={s.macroCell}>
                  <Text style={s.macroValue}>{fmt(nutrients[key], '')}</Text>
                  <Text style={s.macroLabel}>{info.label} {info.unit}</Text>
                </View>
              );
            })}
          </View>

          {/* Vitamins & minerals -- two-column: USDA ref vs Final */}
          <View style={s.microSection}>
            <Text style={s.sectionLabel}>Vitamins & Minerals</Text>
            {/* Column headers */}
            {displayedUsda && (
              <View style={s.microHeaderRow}>
                <Text style={s.microHeaderLabel}>Nutrient</Text>
                <Text style={s.microHeaderVal}>USDA</Text>
                <Text style={s.microHeaderVal}>Final</Text>
              </View>
            )}
            {MICRO_KEYS.map(key => {
              const info = NUTRIENT_INFO[key];
              const finalVal = nutrients[key];
              const usdaVal = displayedUsda?.[key];

              // Show tags
              const hasRetention = food?.retentionChanges?.some(c => c.nutrient === key);
              const hasInteraction = food?.interactionChanges?.some(c => c.target === key);

              // Flag: USDA and Final differ significantly (from cooking/interactions)
              const diffPct = usdaVal != null && usdaVal > 0 ? Math.abs((finalVal - usdaVal) / usdaVal) : 0;
              const hasDiff = usdaVal != null && diffPct > 0.05;

              return (
                <View key={key} style={s.microRow}>
                  <View style={s.microLabelCol}>
                    <Text style={s.microLabel}>{info.label}</Text>
                    {hasRetention && <Text style={s.tag}>cooking</Text>}
                    {hasInteraction && <Text style={s.tag}>synergy</Text>}
                  </View>
                  {displayedUsda && (
                    <Text style={s.microValueUsda}>
                      {usdaVal != null ? fmt(usdaVal, info.unit) : '--'}
                    </Text>
                  )}
                  <Text style={[s.microValue, hasDiff && s.microValueAdjusted]}>
                    {fmt(finalVal, info.unit)}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Accordion: USDA references */}
          {food?.allRefs && food.allRefs.length > 0 && (
            <Accordion title="USDA Reference" icon="book-open" defaultOpen>
              {food.allRefs && food.allRefs.map((ref, refIdx) => {
                const isSelected = refIdx === selectedRefIdx;
                return (
                  <TouchableOpacity
                    key={refIdx}
                    style={[s.refRow, isSelected && s.refRowSelected]}
                    onPress={() => setSelectedRefIdx(refIdx)}
                    activeOpacity={0.6}
                  >
                    <View style={s.refNameRow}>
                      {isSelected && <Feather name="check" size={12} color={colors.textPrimary} style={{ marginRight: 4 }} />}
                      <Text style={isSelected ? s.refNameSelected : s.refNameLink} numberOfLines={1}>
                        {ref.name}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.refScore}>{Math.round(ref.score * 100)}%</Text>
                      <TouchableOpacity
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => {
                          const url = ref.fdcId
                            ? `https://fdc.nal.usda.gov/food-details/${ref.fdcId}/nutrients`
                            : `https://fdc.nal.usda.gov/search?query=${encodeURIComponent(ref.name)}`;
                          Linking.openURL(url);
                        }}
                      >
                        <Feather name="external-link" size={10} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Accordion>
          )}

          {/* AI reasoning (if no USDA ref was used) */}
          {food?.reasoning && !food?.usedRef && (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={s.reasoning}>{food.reasoning}</Text>
            </View>
          )}

          {/* Accordion: Cooking & absorption */}
          {food?.retentionChanges && food.retentionChanges.length > 0 && (
            <Accordion title="Cooking Retention" icon="thermometer">
              {/* Severity indicator */}
              {food.cookingSeverity !== undefined && (
                <View style={s.severityRow}>
                  <Text style={s.severityLabel}>
                    {food.cookingMethod || food.cooking || 'cooked'}
                  </Text>
                  <View style={s.severityBar}>
                    <View style={[s.severityFill, { width: `${food.cookingSeverity}%` }]} />
                  </View>
                  <Text style={s.severityValue}>{food.cookingSeverity}/100</Text>
                </View>
              )}
              {food.retentionChanges.map((ch, i) => {
                const info = NUTRIENT_INFO[ch.nutrient] || { label: ch.nutrient, unit: '' };
                const pct = Math.round(ch.factor * 100);
                return (
                  <View key={i} style={s.retentionRow}>
                    <Text style={s.retLabel}>{info.label}</Text>
                    <Text style={s.retValues}>
                      {fmt(ch.before, '')} {'->'} {fmt(ch.after, info.unit)}
                    </Text>
                    <Text style={s.retPct}>{pct}% retained</Text>
                  </View>
                );
              })}
            </Accordion>
          )}

          {food?.interactionChanges && food.interactionChanges.length > 0 && (
            <Accordion title="Nutrient Interactions" icon="zap">
              {food.interactionChanges.map((ch, i) => {
                const info = NUTRIENT_INFO[ch.target] || { label: ch.target, unit: '' };
                const triggerLabel = ch.trigger.startsWith('_')
                  ? ch.trigger.slice(1).replace('_', ' ')
                  : (NUTRIENT_INFO[ch.trigger]?.label || ch.trigger);
                return (
                  <View key={i} style={s.interRow}>
                    <View style={s.interHeader}>
                      <Text style={s.interLabel}>{info.label}</Text>
                      <Text style={[s.interType, ch.type === 'synergy' ? s.synergy : s.inhibitor]}>
                        {ch.type === 'synergy' ? '+' : '-'}{triggerLabel}
                      </Text>
                    </View>
                    <Text style={s.interValues}>
                      {fmt(ch.beforeValue, '')} {'->'} {fmt(ch.afterValue, info.unit)}
                    </Text>
                    <Text style={s.interReason}>{ch.reason}</Text>
                    {ch.sourceFoods && ch.sourceFoods.length > 0 && (
                      <Text style={s.interSource}>
                        from {ch.sourceFoods.join(', ')}
                      </Text>
                    )}
                  </View>
                );
              })}

              {/* Educational callouts for triggers */}
              {(() => {
                const triggers = new Set(food.interactionChanges.map(ch => ch.trigger));
                const eduCards = Array.from(triggers)
                  .filter(t => TRIGGER_EDUCATION[t])
                  .map(t => TRIGGER_EDUCATION[t]);
                if (eduCards.length === 0) return null;
                return eduCards.map((edu, i) => (
                  <View key={i} style={s.eduCard}>
                    <Text style={s.eduTitle}>{edu.name}</Text>
                    <Text style={s.eduBody}>{edu.what}</Text>
                    <Text style={s.eduFoods}>Found in: {edu.foods.join(', ')}</Text>
                    {edu.tip && <Text style={s.eduTip}>{edu.tip}</Text>}
                  </View>
                ));
              })()}
            </Accordion>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ──────────── Helpers ────────────

function aggregateNutrients(foods?: FoodPipelineItem[]): Record<string, number> | null {
  if (!foods || foods.length === 0) return null;
  const total: Record<string, number> = {};
  for (const food of foods) {
    if (!food.nutrients) continue;
    for (const [key, val] of Object.entries(food.nutrients)) {
      total[key] = (total[key] || 0) + val;
    }
  }
  return Object.keys(total).length > 0 ? total : null;
}

// ──────────── Styles ────────────

const s = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  sourceLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
    fontStyle: 'italic',
  },

  scrollBody: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },

  // Macros
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing.md,
  },
  macroCell: {
    width: '31%',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  macroLabel: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
  },

  // Micros
  microSection: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  microHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    marginBottom: 2,
  },
  microHeaderLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  microHeaderVal: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    minWidth: 60,
    textAlign: 'right',
  },
  microRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  flaggedRow: {
    backgroundColor: '#FFF8F0',
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  microLabelCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  microLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  microValueUsda: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  microValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  microValueAdjusted: {
    color: '#1a73e8',
  },
  microRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  microValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  tag: {
    fontSize: 8,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  flagTag: {
    fontSize: 7,
    fontWeight: '700',
    color: '#B45309',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  adjTag: {
    fontSize: 7,
    fontWeight: '700',
    color: '#1a73e8',
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },

  // Accordion
  accordion: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    backgroundColor: '#FAFAFA',
  },
  accordionTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  accordionBody: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },

  // USDA ref
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  refRowSelected: {
    backgroundColor: '#F0F7FF',
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  refNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  refNameLink: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
  },
  refNameSelected: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  refName: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  refScore: {
    fontSize: 11,
    color: colors.textMuted,
  },
  otherRefsLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 4,
  },
  otherRefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  otherRefName: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  otherRefNameLink: {
    fontSize: 11,
    color: colors.accent || '#1a73e8',
    textDecorationLine: 'underline',
    flex: 1,
  },
  otherRefScore: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // AI adjustments
  adjRow: { marginBottom: 8 },
  adjHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  adjValues: { fontSize: 11, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  adjReason: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  reasoning: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },

  // Retention
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  severityLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
    width: 70,
  },
  severityBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#F0F0F0',
    borderRadius: 2,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  severityFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4A574',
  },
  severityValue: {
    fontSize: 10,
    color: colors.textMuted,
    width: 36,
    textAlign: 'right',
  },
  retentionRow: { marginBottom: 6 },
  retLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  retValues: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
  retPct: { fontSize: 10, color: colors.textMuted },

  // Interactions
  interRow: { marginBottom: 8 },
  interHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  interLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  interType: { fontSize: 9, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  synergy: { backgroundColor: '#E8E8E8', color: '#333' },
  inhibitor: { backgroundColor: '#F0F0F0', color: '#999' },
  interValues: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
  interReason: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  interSource: { fontSize: 10, color: colors.textMuted, marginTop: 1, fontWeight: '500' },

  // Education cards
  eduCard: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#F8F6F0',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#D4C9A8',
  },
  eduTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  eduBody: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  eduFoods: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  eduTip: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E0D4',
  },
});
