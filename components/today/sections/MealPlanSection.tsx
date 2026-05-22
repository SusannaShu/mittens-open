import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, fonts } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';

interface Props {
  mealPlan: any;
  meals?: any[];
  gapCoverage: any;
  isGeneratingPlan: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpenMealDetail: (data: { key: string; label: string; meal: any }) => void;
  onOpenGrocery: () => void;
  onOpenProjection: () => void;
  onGenerate?: () => void;
  onDislikeFood?: (food: string) => void;
}

const MEAL_SLOTS: [string, string, string][] = [
  ['breakfast', 'Breakfast', 'sunrise'],
  ['lunch', 'Lunch', 'sun'],
  ['dinner', 'Dinner', 'sunset'],
];

export default function MealPlanSection({
  mealPlan, meals, gapCoverage, isGeneratingPlan, collapsed, onToggle,
  onOpenMealDetail, onOpenGrocery, onOpenProjection, onGenerate, onDislikeFood,
}: Props) {
  const router = useRouter();

  if (!mealPlan) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MEAL PLAN</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 8 }}>
          {isGeneratingPlan ? (
            <>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.textMuted }}>
                Generating meal plan...
              </Text>
            </>
          ) : (
            <TouchableOpacity onPress={onGenerate} style={{ alignItems: 'center' }}>
              <Feather name="refresh-cw" size={16} color={colors.accent} style={{ marginBottom: 4 }} />
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.accent }}>
                Tap to generate plan
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>MEAL PLAN</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <View style={{ gap: 10 }}>
          {/* Meal cards */}
          {MEAL_SLOTS.map(([key, label, icon]) => {
            const meal = mealPlan[key];
            if (!meal) return null;
            const mealItems: string[] = meal.items || [];
            return (
              <View
                key={key}
                style={{ backgroundColor: colors.bgCard, borderRadius: 10, padding: 12, gap: 6 }}
              >
                <TouchableOpacity
                  onPress={() => onOpenMealDetail({ key, label, meal })}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name={icon as any} size={14} color={colors.textPrimary} />
                      <Text style={{ fontSize: 14, fontWeight: '700', fontFamily: fonts.heading, color: colors.textPrimary }}>{label}</Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>

                {/* Individual food items with dislike button */}
                <View style={{ gap: 2 }}>
                  {mealItems.map((item: string, idx: number) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 }}>
                      <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18, flex: 1, marginRight: 8 }} numberOfLines={2}>
                        {item}
                      </Text>
                      {onDislikeFood && (
                        <TouchableOpacity
                          onPress={() => onDislikeFood(item)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.5}
                          style={{ padding: 4 }}
                        >
                          <Feather name="thumbs-down" size={12} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>

                {meal.prepTip && (
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 }}>{meal.prepTip}</Text>
                )}
              </View>
            );
          })}

          {/* Action row */}
          <View style={{ gap: 6, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            {mealPlan.groceryList && mealPlan.groceryList.length > 0 && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
                onPress={onOpenGrocery}
                activeOpacity={0.6}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="shopping-cart" size={13} color={colors.textPrimary} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>Grocery List</Text>
                  <View style={{ backgroundColor: colors.bgCard, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted }}>{mealPlan.groceryList.length}</Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {gapCoverage && (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}
                onPress={onOpenProjection}
                activeOpacity={0.6}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Feather name="bar-chart-2" size={13} color={colors.textPrimary} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>Projected Nutrients</Text>
                </View>
                <Feather name="chevron-right" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
              onPress={() => router.push({ pathname: '/(tabs)/chat', params: { prompt: 'I have some questions about today\'s meal plan' } })}
              activeOpacity={0.6}
            >
              <Feather name="message-circle" size={13} color={colors.textMuted} />
              <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '500' }}>Discuss with Mittens</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
