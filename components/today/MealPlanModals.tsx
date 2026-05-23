import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, SafeAreaView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts } from '../../lib/theme';
import ProjectionRow from './ProjectionRow';
import ItemNutritionModal from './ItemNutritionModal';

/* ── Meal Detail Modal ── */
export function MealDetailModal({ visible, onClose, mealDetailData, gapCoverage, mealPlan, onUpdateMeal }: {
  visible: boolean;
  onClose: () => void;
  mealDetailData: { key: string; label: string; meal: any } | null;
  gapCoverage: any;
  mealPlan: any;
  onUpdateMeal?: (slot: string, updatedFoods: any[]) => void;
}) {
  const [selectedFood, setSelectedFood] = useState<any>(null);
  if (!mealDetailData) return null;

  const { label, meal, key: mealKey } = mealDetailData;
  const mealItems: string[] = meal.items || [];
  const nutrients = meal.nutrients || {};
  const bioNotes: any[] = (mealPlan?.bioavailabilityNotes || []).filter((n: any) => n.meal === mealKey);

  // Gap closure info
  const gapChips = gapCoverage ? Object.entries(gapCoverage)
    .filter(([k, v]: [string, any]) => {
      const mealAdds = nutrients[k] || 0;
      if (mealAdds <= 0) return false;
      // Show if it closes a gap OR if it provides a significant contribution (>= 10% RDA)
      const addPct = (v as any).rda ? Math.round((mealAdds / (v as any).rda) * 100) : 0;
      return v.currentPct < 90 || addPct >= 10;
    })
    .map(([k, v]: [string, any]) => {
      const mealAdds = nutrients[k] || 0;
      const addPct = (v as any).rda ? Math.round((mealAdds / (v as any).rda) * 100) : 0;
      return { key: k, name: v.name, addPct: Math.min(addPct, 100), amount: Math.round(mealAdds * 10) / 10, unit: v.unit };
    })
    .filter(c => c.addPct >= 3)
    .sort((a, b) => b.addPct - a.addPct)
    : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 18, fontWeight: '700', fontFamily: fonts.heading, color: colors.textPrimary }}>{label}</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1, padding: 20 }} contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
          {/* Ingredients — tappable for nutrition detail & USDA override */}
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Ingredients</Text>
            {(meal.foods && meal.foods.length > 0 ? meal.foods : mealItems.map((name: string) => ({ name }))).map((food: any, i: number) => (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedFood({ ...food, name: food.name || mealItems[i] || '' })}
                activeOpacity={0.6}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}
              >
                <Text style={{ flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
                  - {food.name || mealItems[i] || ''}
                </Text>
                {food.portion_g ? (
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{food.portion_g}g</Text>
                ) : null}
                <Feather name="chevron-right" size={12} color={colors.textMuted} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Prep tip */}
          {meal.prepTip && (
            <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>How to prepare</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>{meal.prepTip}</Text>
            </View>
          )}

          {/* Nutrient contributions */}
          {gapChips.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Nutrient Coverage</Text>
              {gapChips.map(c => (
                <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{c.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>{c.amount}{c.unit}</Text>
                    <View style={{ backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#2E7D32' }}>+{c.addPct}%</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Bioavailability notes */}
          {bioNotes.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Absorption Notes</Text>
              {bioNotes.map((n: any, idx: number) => (
                <View key={idx} style={{
                  backgroundColor: n.effect === 'positive' ? '#E8F5E9' : '#FFF3E0',
                  borderRadius: 8, padding: 10,
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: n.effect === 'positive' ? '#2E7D32' : '#E65100' }}>
                    {n.note}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Pantry/store source */}
          {(meal.fromPantry?.length > 0 || meal.fromStore?.length > 0) && (
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Sourcing</Text>
              {(meal.fromPantry || []).map((p: any, i: number) => (
                <View key={`p${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="check" size={12} color="#34C759" />
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{p.food} -- from fridge</Text>
                </View>
              ))}
              {(meal.fromStore || []).map((s: any, i: number) => (
                <View key={`s${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="shopping-bag" size={12} color={colors.textMuted} />
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>{s.food} -- buy</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Ingredient nutrition detail / USDA override */}
        <ItemNutritionModal
          visible={!!selectedFood}
          onClose={() => setSelectedFood(null)}
          item={selectedFood}
          onUpdate={onUpdateMeal ? (updatedItem) => {
            const foods = meal.foods || mealItems.map((name: string) => ({ name }));
            const updatedFoods = foods.map((f: any) => {
              if (f === selectedFood || f.name === selectedFood?.name) {
                return { ...f, ...updatedItem, _nameChanged: false };
              }
              return f;
            });
            onUpdateMeal(mealKey, updatedFoods);
            setSelectedFood(null);
          } : undefined}
        />
      </SafeAreaView>
    </Modal>
  );
}

/* ── Grocery List Modal ── */
export function GroceryListModal({ visible, onClose, groceryList, onAddToPantry, onDislike }: {
  visible: boolean;
  onClose: () => void;
  groceryList: any[];
  onAddToPantry: (food: string) => void;
  onDislike: (food: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 18, fontWeight: '700', fontFamily: fonts.heading, color: colors.textPrimary }}>Grocery List</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1, padding: 20 }} contentContainerStyle={{ gap: 8, paddingBottom: 40 }}>
          {groceryList.map((item: any, i: number) => {
            const food = typeof item === 'string' ? item : item.food;
            const forMeals = item.forMeals || [];
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.textMuted }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.textPrimary }}>{food}</Text>
                  {forMeals.length > 0 && (
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>for {forMeals.join(', ')}</Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => { if (food) onAddToPantry(food); }}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#E8F5E9' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#2E7D32' }}>Have it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { if (food) onDislike(food); }}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#FFF3E0' }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#E65100' }}>Dislike</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/* ── Projected Nutrients Modal ── */
export function ProjectedNutrientsModal({ visible, onClose, gapCoverage, mealPlan }: {
  visible: boolean;
  onClose: () => void;
  gapCoverage: any;
  mealPlan: any;
}) {
  const SAFETY: Record<string, number> = {
    calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
    vitamin_k: 1, vitamin_b12: 1, potassium: 1, magnesium: 1, omega3: 1,
    vitamin_c: 2, vitamin_b6: 2, folate: 2, vitamin_e: 2, calcium: 2, vitamin_d: 2,
    vitamin_a: 3, iron: 3, zinc: 3,
  };
  const MEAL_ICONS: Record<string, string> = { breakfast: 'sunrise', lunch: 'sun', dinner: 'sunset' };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 18, fontWeight: '700', fontFamily: fonts.heading, color: colors.textPrimary }}>Projected Nutrients</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 }}>
          If you eat all planned meals today. Tap a nutrient to see sources.
        </Text>
        <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} contentContainerStyle={{ gap: 2, paddingBottom: 40, paddingTop: 8 }}>
          {gapCoverage && (() => {
            const entries = Object.entries(gapCoverage)
              .map(([k, v]: [string, any]) => ({ key: k, ...v, tier: SAFETY[k] ?? 2 }))
              .sort((a, b) => b.afterPlanPct - a.afterPlanPct);

            return entries.map(e => {
              const pct = Math.min(e.afterPlanPct, 999);
              const currentPct = Math.min(e.currentPct, 100);
              const isOver = pct > 100;
              const isExcess = e.isUlExcess !== undefined ? e.isUlExcess : (e.tier === 3 && pct > 100);

              const barColor = isExcess ? '#E65100'
                : pct >= 90 ? colors.statusGood
                : pct >= 50 ? colors.statusModerate
                : colors.statusLow;
              const safetyLabel = isExcess ? 'caution'
                : (isOver ? (e.tier <= 1 ? 'safe' : e.tier === 2 ? 'ok' : 'safe') : null);
              const safetyColor = safetyLabel === 'safe' ? '#2E7D32'
                : safetyLabel === 'ok' ? colors.textMuted
                : '#E65100';

              // Per-meal breakdown
              const mealContributions: { meal: string; amount: number; unit: string }[] = [];
              for (const slot of ['breakfast', 'lunch', 'dinner']) {
                const meal = mealPlan?.[slot];
                if (meal?.nutrients && meal.nutrients[e.key]) {
                  mealContributions.push({
                    meal: slot.charAt(0).toUpperCase() + slot.slice(1),
                    amount: Math.round(meal.nutrients[e.key] * 10) / 10,
                    unit: e.unit,
                  });
                }
              }

              return (
                <ProjectionRow
                  key={e.key}
                  nutrientKey={e.key}
                  name={e.name}
                  currentPct={currentPct}
                  projectedPct={pct}
                  barColor={barColor}
                  safetyLabel={safetyLabel}
                  safetyColor={safetyColor}
                  unit={e.unit}
                  rda={e.rda}
                  planAdds={e.planAdds}
                  mealContributions={mealContributions}
                  mealIcons={MEAL_ICONS}
                />
              );
            });
          })()}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
