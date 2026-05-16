/**
 * MealPipelineCard -- Per-food async pipeline card in chat.
 *
 * Shows each food's independent pipeline status:
 *   idle -> estimating -> complete | error
 *
 * Each completed food has "View >" to open nutrient detail.
 * User can edit food name -> cancels and restarts only that food.
 */

import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { NutrientAdjustment, USDARef } from '../../lib/providers/inferenceProvider';
import type { USDAReference } from '../../lib/services/food/nutrientEstimator';
import USDAFoodSearch from '../common/USDAFoodSearch';

// ──────────── Types ────────────

export type FoodPipelineStatus = 'idle' | 'estimating' | 'complete' | 'error';

export interface FoodPipelineItem {
  name: string;
  portion_g: number;
  household_portion?: string;
  cooking?: string;
  confidence: number;
  /** Per-food pipeline status */
  status: FoodPipelineStatus;
  /** Nutrient results (populated when status = 'complete') */
  nutrients?: Record<string, number>;
  /** Raw USDA-scaled nutrients for the selected reference (for comparison column) */
  usdaNutrients?: Record<string, number>;
  /** USDA reference used */
  usedRef?: USDARef;
  /** All USDA candidates (with per100g data for switching) */
  allRefs?: USDARefWithData[];
  /** AI adjustments from USDA reference */
  adjustments?: NutrientAdjustment[];
  /** AI reasoning */
  reasoning?: string;
  /** Retention factors applied */
  retentionChanges?: Array<{ nutrient: string; before: number; after: number; factor: number }>;
  /** Cooking severity (0=raw, 100=deep fried) */
  cookingSeverity?: number;
  /** Matched cooking method */
  cookingMethod?: string;
  /** Interaction effects */
  interactionChanges?: Array<{ target: string; trigger: string; type: string; beforeValue: number; afterValue: number; reason: string; sourceFoods?: string[] }>;
}

/** Extended USDA ref with per100g data for local switching */
export interface USDARefWithData {
  fdcId: number;
  name: string;
  score: number;
  per100g?: Record<string, number | null>;
}

interface MealPipelineCardProps {
  foods: FoodPipelineItem[];
  /** Called when user taps "View >" on a completed food */
  onViewNutrients?: (food: FoodPipelineItem, index: number) => void;
  /** Called when user edits a food name (triggers cancel + restart) */
  onFoodEdit?: (index: number, newName: string) => void;
  /** Called when user edits a food portion (triggers cancel + restart) */
  onPortionEdit?: (index: number, newPortionG: number) => void;
  /** Called to remove a food */
  onFoodRemove?: (index: number) => void;
  /** Called to add a new food item */
  onAddFood?: (name: string) => void;
  /** Called to directly replace a food with a USDA match */
  onUsdaReplace?: (index: number, food: USDAReference & { amountGram: number, customName?: string }) => void;
  /** Called when user taps "View all nutrients" */
  onViewAll?: () => void;
  /** Scroll parent to bottom (for keyboard visibility) */
  onScrollToEnd?: () => void;
}

// ──────────── Status indicator ────────────

function StatusBadge({ status }: { status: FoodPipelineStatus }) {
  if (status === 'estimating') {
    return <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 6 }} />;
  }
  if (status === 'error') {
    return (
      <View style={[s.statusDot, { backgroundColor: '#CCC' }]}>
        <Feather name="alert-circle" size={10} color="#999" />
      </View>
    );
  }
  if (status === 'complete') {
    return (
      <View style={[s.statusDot, { backgroundColor: '#E8E8E8' }]}>
        <Feather name="check" size={10} color={colors.textPrimary} />
      </View>
    );
  }
  // idle
  return <View style={[s.statusDot, { backgroundColor: '#F0F0F0' }]} />;
}

// ──────────── Food Row ────────────

function FoodRow({ food, index, onView, onEdit, onPortionEdit, onRemove }: {
  food: FoodPipelineItem;
  index: number;
  onView?: (food: FoodPipelineItem, index: number) => void;
  onEdit?: (index: number, newName: string) => void;
  onPortionEdit?: (index: number, newPortionG: number) => void;
  onRemove?: (index: number) => void;
  onUsdaReplace?: (index: number, food: USDAReference & { amountGram: number, customName?: string }) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [searchingUsda, setSearchingUsda] = useState(false);
  const [editName, setEditName] = useState(food.name);
  const [editingPortion, setEditingPortion] = useState(false);
  const [editPortion, setEditPortion] = useState(food.portion_g != null ? String(food.portion_g) : '');

  const handleSubmitName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== food.name) {
      onEdit?.(index, trimmed);
    }
    setEditingName(false);
  }, [editName, food.name, index, onEdit]);

  const handleSubmitPortion = useCallback(() => {
    const val = parseInt(editPortion, 10);
    if (val > 0 && val !== food.portion_g) {
      onPortionEdit?.(index, val);
    }
    setEditingPortion(false);
  }, [editPortion, food.portion_g, index, onPortionEdit]);

  return (
    <View style={s.foodRow}>
      {/* Status indicator */}
      <StatusBadge status={food.status} />

      {/* Food name + details */}
      <View style={s.foodInfo}>
        {editingName ? (
          <View style={{ gap: 4, width: '100%', paddingVertical: 4 }}>
            <TextInput
              style={s.editInput}
              value={editName}
              onChangeText={setEditName}
              onSubmitEditing={handleSubmitName}
              onBlur={handleSubmitName}
              autoFocus
              selectTextOnFocus
            />
            <TouchableOpacity onPress={() => { setEditingName(false); setSearchingUsda(true); }} style={{ paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '500' }}>Search USDA database</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.nameRow}>
            {food.status === 'complete' ? (
              <TouchableOpacity
                onPress={() => { setEditName(food.name); setEditingName(true); }}
                activeOpacity={0.7}
                style={{ flexShrink: 1 }}
              >
                <Text style={s.foodNameEditable} numberOfLines={1}>{food.name}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[s.foodName, { flexShrink: 1 }]} numberOfLines={1}>{food.name}</Text>
            )}
            
            {food.confidence !== undefined && (
              <View style={[
                s.confBadge, 
                { backgroundColor: food.confidence >= 0.8 ? '#dcfce7' : food.confidence >= 0.5 ? '#fef08a' : '#fee2e2' }
              ]}>
                <Text style={[
                  s.confText, 
                  { color: food.confidence >= 0.8 ? '#166534' : food.confidence >= 0.5 ? '#854d0e' : '#991b1b' }
                ]}>
                  {Math.round(food.confidence * 100)}%
                </Text>
              </View>
            )}
          </View>
        )}
        {editingPortion ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 }}>
            <TextInput
              style={s.editPortionInput}
              value={editPortion}
              onChangeText={setEditPortion}
              onSubmitEditing={handleSubmitPortion}
              onBlur={handleSubmitPortion}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
            />
            <Text style={s.foodPortion}>g</Text>
          </View>
        ) : food.status === 'complete' ? (
          <TouchableOpacity onPress={() => { setEditPortion(food.portion_g != null ? String(food.portion_g) : ''); setEditingPortion(true); }}>
            <Text style={s.foodPortionEditable}>
              {food.household_portion ? `${food.portion_g ?? '?'}g -- ${food.household_portion}` : `${food.portion_g ?? '?'}g`}
              {food.cooking ? ` -- ${food.cooking}` : ''}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.foodPortion}>
            {food.household_portion ? `${food.portion_g ?? '?'}g -- ${food.household_portion}` : `${food.portion_g ?? '?'}g`}
            {food.cooking ? ` -- ${food.cooking}` : ''}
          </Text>
        )}
      </View>

      {/* Right side: View button or spinner */}
      <View style={s.foodActions}>
        {food.status === 'complete' && onView && (
          <TouchableOpacity
            style={s.viewBtn}
            onPress={() => onView(food, index)}
            activeOpacity={0.7}
          >
            <Text style={s.viewBtnText}>View</Text>
            <Feather name="chevron-right" size={12} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        {food.status === 'error' && (
          <Text style={s.errorText}>retry</Text>
        )}
        {onRemove && (
          <TouchableOpacity
            onPress={() => onRemove(index)}
            style={s.removeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={14} color="#CCC" />
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={searchingUsda} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSearchingUsda(false)}>
        <View style={{ flex: 1, backgroundColor: '#F8F8F8', paddingTop: 40, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.textPrimary }}>Search USDA Match</Text>
            <TouchableOpacity onPress={() => setSearchingUsda(false)} style={{ padding: 8 }}>
              <Feather name="x" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <USDAFoodSearch onAddFood={(usdaFood) => {
            setSearchingUsda(false);
            onUsdaReplace?.(index, usdaFood);
          }} />
        </View>
      </Modal>
    </View>
  );
}

// ──────────── Main Component ────────────

export default function MealPipelineCard({
  foods, onViewNutrients, onFoodEdit, onPortionEdit, onFoodRemove, onAddFood, onViewAll, onUsdaReplace, onScrollToEnd,
}: MealPipelineCardProps) {
  const [addingFood, setAddingFood] = useState(false);
  const [newFoodName, setNewFoodName] = useState('');
  const addInputRef = useRef<TextInput>(null);

  if (foods.length === 0) return null;

  const completedCount = foods.filter(f => f.status === 'complete').length;
  const allComplete = completedCount === foods.length;
  const estimatingCount = foods.filter(f => f.status === 'estimating').length;

  const handleAddSubmit = () => {
    const trimmed = newFoodName.trim();
    if (trimmed) {
      onAddFood?.(trimmed);
      setNewFoodName('');
      setAddingFood(false);
    }
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Feather name="eye" size={13} color={colors.textSecondary} />
        <Text style={s.headerTitle}>
          {allComplete
            ? `${foods.length} foods analyzed`
            : estimatingCount > 0
              ? `Estimating nutrients...`
              : `${foods.length} foods identified`
          }
        </Text>
        {!allComplete && estimatingCount > 0 && (
          <Text style={s.headerBadge}>{completedCount}/{foods.length}</Text>
        )}
      </View>

      {/* Food list */}
      <View style={s.foodList}>
        {foods.map((food, i) => (
          <FoodRow
            key={`${food.name}-${i}`}
            food={food}
            index={i}
            onView={onViewNutrients}
            onEdit={onFoodEdit}
            onPortionEdit={onPortionEdit}
            onRemove={onFoodRemove}
            onUsdaReplace={onUsdaReplace}
          />
        ))}

        {/* Add food inline input */}
        {addingFood ? (
          <View style={s.addFoodRow}>
            <Feather name="plus" size={14} color={colors.textMuted} />
            <TextInput
              ref={addInputRef}
              style={s.addFoodInput}
              value={newFoodName}
              onChangeText={setNewFoodName}
              onSubmitEditing={handleAddSubmit}
              onBlur={() => { if (!newFoodName.trim()) setAddingFood(false); }}
              onFocus={() => {
                // Scroll parent to bottom so input stays above keyboard
                setTimeout(() => onScrollToEnd?.(), 200);
              }}
              placeholder="Food name..."
              autoFocus
              returnKeyType="done"
            />
            <TouchableOpacity onPress={handleAddSubmit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="check" size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ) : onAddFood ? (
          <TouchableOpacity style={s.addFoodBtn} onPress={() => setAddingFood(true)} activeOpacity={0.7}>
            <Feather name="plus" size={13} color={colors.textMuted} />
            <Text style={s.addFoodText}>Add item</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Footer: View all nutrients when all done */}
      {allComplete && onViewAll && (
        <TouchableOpacity style={s.viewAllBtn} onPress={onViewAll} activeOpacity={0.7}>
          <Text style={s.viewAllText}>View all nutrients</Text>
          <Feather name="chevron-right" size={14} color={colors.textPrimary} />
        </TouchableOpacity>
      )}

      {/* Progress bar when estimating */}
      {!allComplete && estimatingCount > 0 && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${(completedCount / foods.length) * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

// ──────────── Styles ────────────

const s = StyleSheet.create({
  container: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerBadge: {
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: '#ECECEC',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },

  foodList: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },

  foodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },

  statusDot: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },

  foodInfo: {
    flex: 1,
  },
  foodName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  confText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  foodNameEditable: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  foodPortion: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  foodPortionEditable: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    alignSelf: 'flex-start',
  },
  editInput: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.textPrimary,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },

  foodActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#ECECEC',
  },
  viewBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 10,
    color: '#999',
    fontStyle: 'italic',
  },
  removeBtn: {
    padding: 2,
  },

  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  progressBar: {
    height: 2,
    backgroundColor: '#ECECEC',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.textPrimary,
  },

  // Portion editing
  editPortionInput: {
    fontSize: 11,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.textMuted,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minWidth: 40,
    fontVariant: ['tabular-nums'],
  },

  // Add food
  addFoodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  addFoodInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.textMuted,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  addFoodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    opacity: 0.6,
  },
  addFoodText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
