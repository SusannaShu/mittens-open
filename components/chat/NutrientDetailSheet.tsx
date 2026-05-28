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
import { View, Text, TouchableOpacity, ScrollView, Modal, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import type { FoodPipelineItem, USDARefWithData } from './MealPipelineCard';
import { scaleNutrients } from '../../lib/services/food/nutrientEstimator';
import type { USDAReference } from '../../lib/services/food/nutrientEstimator';
import { TRIGGER_EDUCATION } from '../../lib/data/nutrientInteractions';
import USDAFoodSearch from '../common/USDAFoodSearch';
import { s } from './nutrientDetailStyles';

// ──────────── Props ────────────

interface NutrientDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Single food detail, or aggregated meal */
  food?: FoodPipelineItem;
  /** All foods for aggregated view */
  allFoods?: FoodPipelineItem[];
  /** Called when user selects a USDA match from inline search (for foods with no match) */
  onUsdaSelect?: (usdaFood: USDAReference & { amountGram: number; customName?: string }) => void;
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
  visible, onClose, food, allFoods, onUsdaSelect,
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
  const hasNoNutrients = !nutrients;

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

  if (!visible) return null;

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
        {(() => {
          if (!food) return null;
          const hasUsdaMatch = !!(food.usedRef && (food.usedRef.fdcId || food.usedRef.name));
          if (hasUsdaMatch) {
            const refName = food.usedRef?.name || food.name;
            return (
              <Text style={s.sourceLabel}>
                Brain selected USDA reference: "{refName}"
              </Text>
            );
          } else {
            return (
              <Text style={s.sourceLabel}>
                AI Estimate
              </Text>
            );
          }
        })()}

        <ScrollView style={s.scrollBody} showsVerticalScrollIndicator={false}>
          {/* Empty state: no nutrients / no USDA match */}
          {hasNoNutrients && (
            <View style={s.emptyState}>
              <Feather name="search" size={28} color={colors.textMuted} />
              <Text style={s.emptyTitle}>No USDA match found</Text>
              <Text style={s.emptySubtext}>
                We could not automatically match "{title}" to a USDA reference.
                Search below to find and select a match.
              </Text>
              <View style={s.emptySearchWrap}>
                <USDAFoodSearch
                  onAddFood={(usdaFood) => {
                    onUsdaSelect?.(usdaFood);
                    onClose();
                  }}
                />
              </View>
            </View>
          )}

          {/* Normal nutrients view */}
          {!hasNoNutrients && (
            <>
          {/* Macros grid */}
          <View style={s.macroGrid}>
            {MACRO_KEYS.map(key => {
              const info = NUTRIENT_INFO[key];
              return (
                <View key={key} style={s.macroCell}>
                  <Text style={s.macroValue}>{fmt(nutrients![key], '')}</Text>
                  <Text style={s.macroLabel}>{info.label} {info.unit}</Text>
                </View>
              );
            })}
          </View>

          {/* AI-estimated indicator */}
          {!hasNoNutrients && food && !food.usedRef && (
            <View style={s.aiEstimateBanner}>
              <Feather name="cpu" size={13} color="#6B7280" />
              <View style={{ flex: 1 }}>
                <Text style={s.aiEstimateTitle}>AI Estimated</Text>
                <Text style={s.aiEstimateSubtext}>
                  No USDA match was found. Values are estimated by AI and may be approximate.
                </Text>
              </View>
            </View>
          )}

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
              const finalVal = nutrients![key];
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
                      {isSelected && onUsdaSelect && food.usedRef?.fdcId !== ref.fdcId && (
                        <TouchableOpacity
                          style={s.applyPill}
                          onPress={() => {
                            const scaled = scaleNutrients(ref.per100g as any, food.portion_g);
                            onUsdaSelect({
                              fdcId: ref.fdcId,
                              name: ref.name,
                              category: (ref as any).category || '',
                              score: ref.score,
                              per100g: ref.per100g as any,
                              amountGram: food.portion_g,
                              customName: ref.name.split(',')[0],
                            });
                          }}
                        >
                          <Text style={s.applyPillText}>Apply</Text>
                        </TouchableOpacity>
                      )}
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

          {/* Manual USDA search for ALL foods */}
          {food && !hasNoNutrients && (
            <Accordion title="Search & Choose USDA Reference" icon="search">
              <Text style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8 }}>
                Search the USDA database to replace current nutrients with reference values.
              </Text>
              <USDAFoodSearch
                onAddFood={(usdaFood) => {
                  onUsdaSelect?.(usdaFood);
                  onClose();
                }}
              />
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
            <Accordion title="Bioavailability & Interactions" icon="zap">
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
            </>
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



