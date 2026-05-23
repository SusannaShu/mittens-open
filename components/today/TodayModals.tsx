import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity, Modal, TextInput, Image, Pressable, Alert, KeyboardAvoidingView, Platform, Keyboard
} from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import ItemNutritionModal from './ItemNutritionModal';
import { NutrientGap, PantryItem } from '../../lib/types';
import MealTypePicker from './MealTypePicker';

/* ───────────── Types ───────────── */

interface EditModalProps {
  visible: boolean;
  onClose: () => void;
  imageUrl: string | null;
  imageUrls: string[];
  mealType: string;
  items: any[];
  itemText: string;
  savingEdit: boolean;
  displayTitle: string;
  itemId: number | null;
  loggedAt?: Date;
  onLoggedAtChange?: (d: Date) => void;
  onMealTypeChange: (t: string) => void;
  onItemChange: (idx: number, key: string, val: any) => void;
  onRemoveItem: (idx: number) => void;
  onItemTextChange: (t: string) => void;
  onDirectSave: () => void;
  onAIUpdate: () => void;
  onDelete: () => void;
  failureLogs?: any[];
}

interface SourcesModalProps {
  visible: boolean;
  onClose: () => void;
  gaps: NutrientGap[];
  recs: any[];
  pantry?: PantryItem[];
  onAskMittens: (prompt: string) => Promise<string>;
  onDislike?: (food: string, reason?: string) => void;
  onAddToPantry?: (food: string) => void;
}

/* ───────────── Edit Modal ───────────── */

export function EditModal({
  visible, onClose, imageUrl, imageUrls, mealType, items, itemText,
  savingEdit, displayTitle, itemId, loggedAt, onLoggedAtChange,
  onMealTypeChange, onItemChange, failureLogs,
  onRemoveItem, onItemTextChange, onDirectSave, onAIUpdate, onDelete,
}: EditModalProps) {
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('');
  const [editAmPm, setEditAmPm] = useState<'AM' | 'PM'>('AM');
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // Init time picker from loggedAt when modal opens
  useEffect(() => {
    if (visible && loggedAt) {
      const h = loggedAt.getHours();
      setEditHour(String(h === 0 ? 12 : h > 12 ? h - 12 : h));
      setEditMinute(String(loggedAt.getMinutes()).padStart(2, '0'));
      setEditAmPm(h >= 12 ? 'PM' : 'AM');
      setShowTimePicker(false);
    }
  }, [visible, loggedAt]);

  // Auto-apply time when fields change (no checkmark needed)
  const autoApplyTime = (hour: string, minute: string, ampm: 'AM' | 'PM') => {
    if (!loggedAt || !onLoggedAtChange) return;
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || h < 1 || h > 12 || isNaN(m) || m < 0 || m > 59) return;
    const newDate = new Date(loggedAt);
    let hour24 = h === 12 ? 0 : h;
    if (ampm === 'PM') hour24 += 12;
    newDate.setHours(hour24, m, 0, 0);
    onLoggedAtChange(newDate);
  };

  const handleEditHour = (v: string) => { setEditHour(v); autoApplyTime(v, editMinute, editAmPm); };
  const handleEditMinute = (v: string) => { setEditMinute(v); autoApplyTime(editHour, v, editAmPm); };
  const handleEditAmPm = (v: 'AM' | 'PM') => { setEditAmPm(v); autoApplyTime(editHour, editMinute, v); };

  const timeStr = loggedAt
    ? loggedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.modalOverlay} onPress={onClose}>
          <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View onStartShouldSetResponder={() => true} onResponderRelease={() => Keyboard.dismiss()}>
              <View style={s.modalContent}>
                <Text style={s.modalTitle}>Edit Logged Food</Text>

          {/* Meal photos */}
          {imageUrls.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {imageUrls.map((url, idx) => (
                <Image key={idx} source={{ uri: url }}
                  style={{ width: 140, height: 140, borderRadius: radius.md, marginRight: 8 }}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          ) : imageUrl ? (
            <Image source={{ uri: imageUrl }}
              style={{ width: '100%', height: 160, borderRadius: radius.md, marginBottom: spacing.md }}
              resizeMode="cover"
            />
          ) : null}

          {/* Meal type selector */}
          <MealTypePicker value={mealType} onChange={onMealTypeChange} />

          {/* Time picker */}
          {loggedAt && onLoggedAtChange && (
            <View style={{ marginBottom: spacing.md }}>
              <TouchableOpacity
                style={s.timePickerBtn}
                onPress={() => setShowTimePicker(!showTimePicker)}
                activeOpacity={0.6}
              >
                <Feather name="clock" size={14} color={colors.textPrimary} />
                <Text style={s.timePickerLabel}>Time</Text>
                <Text style={s.timePickerValue}>{timeStr}</Text>
                <Feather name={showTimePicker ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
              </TouchableOpacity>

              {showTimePicker && (
                <View style={s.timePickerInline}>
                  <View style={s.timePickerRow}>
                    <TextInput
                      style={s.timePickerInput}
                      value={editHour}
                      onChangeText={handleEditHour}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="12"
                      placeholderTextColor={colors.textMuted}
                      selectTextOnFocus
                    />
                    <Text style={s.timePickerColon}>:</Text>
                    <TextInput
                      style={s.timePickerInput}
                      value={editMinute}
                      onChangeText={handleEditMinute}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="00"
                      placeholderTextColor={colors.textMuted}
                      selectTextOnFocus
                    />
                    <View style={s.ampmRow}>
                      <TouchableOpacity
                        style={[s.ampmBtn, editAmPm === 'AM' && s.ampmBtnActive]}
                        onPress={() => handleEditAmPm('AM')}
                        activeOpacity={0.6}
                      >
                        <Text style={[s.ampmText, editAmPm === 'AM' && s.ampmTextActive]}>AM</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.ampmBtn, editAmPm === 'PM' && s.ampmBtnActive]}
                        onPress={() => handleEditAmPm('PM')}
                        activeOpacity={0.6}
                      >
                        <Text style={[s.ampmText, editAmPm === 'PM' && s.ampmTextActive]}>PM</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Failure Logs Insight */}
          {failureLogs && failureLogs.length > 0 && (
            <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: '#FFF0F0', borderRadius: radius.md, borderWidth: 1, borderColor: '#FFCDD2' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#D32F2F', marginBottom: spacing.xs }}>
                <Feather name="target" size={12} /> FAILURE INSIGHTS
              </Text>
              {failureLogs.map((f: any) => (
                <View key={f.id} style={{ marginTop: 4 }}>
                  <Text style={{ fontSize: 13, color: '#D32F2F', fontWeight: '600' }}>
                    {f.category === 'screwup' ? 'Screwup' : f.category === 'weakness' ? 'Weakness' : 'Opportunity'}: {f.failure}
                  </Text>
                  {f.insight && (
                    <Text style={{ fontSize: 12, color: '#D32F2F', fontStyle: 'italic', marginTop: 2 }}>{f.insight}</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Editable items */}
          {items.length > 0 && (
            <View style={s.editItemsList}>
              {items.map((item: any, idx: number) => (
                <View key={idx} style={{ marginBottom: 12 }}>
                  <View style={s.editItemRow}>
                    <TouchableOpacity onPress={() => onRemoveItem(idx)} style={s.editItemRemove}>
                      <Text style={{ color: '#D32F2F', fontSize: 14, fontWeight: '700' }}>x</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={s.editItemNameInput}
                      value={item.name || item.foodName || ''}
                      onChangeText={(val) => onItemChange(idx, 'name', val)}
                      placeholder="Food name"
                      placeholderTextColor="#BBB"
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput
                        style={s.editItemPortionInput}
                        value={String(item.portion_g || item.portionG || '')}
                        onChangeText={(val) => onItemChange(idx, 'portion_g', val)}
                        keyboardType="numeric"
                        placeholder="0"
                      />
                      <Text style={{ fontSize: 13, color: colors.textMuted }}>g</Text>
                    </View>
                  </View>
                  {(item.usdaMatch || item.nutrient_source === 'usda' || item.usdaRef || item.meta?.usedRef || item.meta?.source === 'usda_ref' || item.meta?.primarySource === 'usda') && (
                    <TouchableOpacity onPress={() => setSelectedItem(item)} style={{ marginLeft: 28, marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.primary, textDecorationLine: 'underline' }}>
                        USDA Match: {item.usdaMatch || item.usdaRef?.name || item.meta?.usedRef?.name || item.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {(!item.usdaMatch && item.nutrient_source !== 'usda' && !item.usdaRef && !item.meta?.usedRef && item.meta?.source !== 'usda_ref' && item.meta?.primarySource !== 'usda' && item.nutrients) && (
                    <TouchableOpacity onPress={() => setSelectedItem(item)} style={{ marginLeft: 28, marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.textSecondary, textDecorationLine: 'underline' }}>
                        AI Estimate
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Direct save */}
          <TouchableOpacity
            style={[s.modalBtnSave, { width: '100%', alignItems: 'center', marginBottom: spacing.md }]}
            onPress={onDirectSave}
            disabled={savingEdit || items.length === 0}
          >
            {savingEdit && !itemText.trim() ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>Save Changes</Text>}
          </TouchableOpacity>

          {/* AI re-analyze */}
          <Text style={s.editHint}>Or describe changes for AI to recalculate nutrients:</Text>
          <TextInput
            style={[s.modalInput, { minHeight: 50 }]}
            value={itemText}
            onChangeText={onItemTextChange}
            placeholder="e.g. It was salmon not chicken"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <View style={[s.modalActions, { justifyContent: 'space-between' }]}>
            <TouchableOpacity style={s.modalBtnDelete} onPress={onDelete} disabled={savingEdit}>
              <Text style={s.modalBtnTextDelete}>Delete</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <TouchableOpacity style={s.modalBtnCancel} onPress={onClose} disabled={savingEdit}>
                <Text style={s.modalBtnTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalBtnSave} onPress={onAIUpdate} disabled={savingEdit || !itemText.trim()}>
                {savingEdit && itemText.trim() ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>AI Update</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </View>
      </ScrollView>
      </Pressable>
      <ItemNutritionModal
        visible={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        onUpdate={(updatedItem) => {
          // Find the index of the selected item in the items list
          const idx = items.findIndex((it: any) =>
            it === selectedItem ||
            (it.name === selectedItem?.name && it.portion_g === selectedItem?.portion_g)
          );
          if (idx >= 0) {
            onItemChange(idx, 'object_override', updatedItem);
          }
          setSelectedItem(null);
        }}
      />
    </KeyboardAvoidingView>
  </Modal>
  );
}

/* ───────────── Nutrient Sources Modal ───────────── */

export function SourcesModal({ visible, onClose, gaps, recs, pantry = [], onAskMittens, onDislike, onAddToPantry }: SourcesModalProps) {
  const pantryNames = pantry.map(p => (p.foodName || '').toLowerCase().trim());
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [hiddenFoods, setHiddenFoods] = useState<Set<string>>(new Set());

  const handleClose = () => {
    onClose();
    setQuestion('');
    setAnswer('');
    setHiddenFoods(new Set());
  };

  const handleDislike = (foodName: string) => {
    Alert.prompt(
      `Don't like ${foodName}?`,
      "We won't recommend this again. Add a reason? (optional)",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: (reason?: string) => {
            setHiddenFoods(prev => new Set([...prev, foodName.toLowerCase()]));
            onDislike?.(foodName, reason?.trim() || undefined);
          },
        },
      ],
      'plain-text',
      '',
      'default'
    );
  };

  const getPortionHint = (food: string): string => {
    const hints: Record<string, string> = {
      'chicken breast': '100g / 1 fillet', 'salmon': '100g / 1 fillet', 'sardines': '80g / 1 can',
      'eggs': '2 large', 'tofu': '100g / 1/2 block', 'lentils': '100g cooked / 1/2 cup',
      'greek yogurt': '170g / 1 cup', 'yogurt': '170g / 1 cup', 'kefir': '250ml / 1 cup',
      'spinach': '80g / 2 cups raw', 'kale': '70g / 2 cups', 'broccoli': '80g / 1 cup',
      'sweet potato': '130g / 1 medium', 'carrot': '70g / 1 medium', 'bell pepper': '120g / 1 medium',
      'banana': '120g / 1 medium', 'orange': '130g / 1 medium', 'kiwi': '75g / 1 medium',
      'strawberry': '150g / 1 cup', 'mango': '165g / 1 cup', 'avocado': '70g / 1/2 fruit',
      'almonds': '28g / ~23 nuts', 'walnuts': '28g / ~14 halves', 'cashews': '28g / ~18 nuts',
      'pumpkin seeds': '28g / 2 tbsp', 'sunflower seeds': '28g / 2 tbsp', 'chia seeds': '15g / 1 tbsp',
      'flaxseeds': '10g / 1 tbsp', 'oats': '40g / 1/2 cup dry', 'rice': '150g / 1 cup cooked',
      'quinoa': '185g / 1 cup cooked', 'black beans': '130g / 3/4 cup', 'chickpeas': '120g / 3/4 cup',
      'olive oil': '14g / 1 tbsp', 'peanut butter': '32g / 2 tbsp', 'dark chocolate': '30g / 1 oz',
      'potato': '150g / 1 medium', 'asparagus': '90g / 6 spears', 'beet': '80g / 1 medium',
      'brussels sprouts': '80g / 4 sprouts', 'lettuce': '50g / 2 cups',
      'nutritional yeast': '15g / 2 tbsp', 'beef': '85g / 3 oz', 'fortified milk': '250ml / 1 cup',
      'mushrooms (uv-exposed)': '80g / 1 cup',
    };
    return hints[food.toLowerCase()] || '1 serving';
  };

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer('');
    try {
      const gapContext = gaps.filter(g => g.status !== 'good').map(g => `${g.name}: ${g.pct}% of RDA`).join(', ');
      const reply = await onAskMittens(`User's nutrient gaps: ${gapContext}. User question: ${question}`);
      setAnswer(reply);
    } catch {
      setAnswer('Sorry, I couldn\'t answer that right now.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.modalOverlay} onPress={handleClose}>
          <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View onStartShouldSetResponder={() => true} onResponderRelease={() => Keyboard.dismiss()}>
              <View style={s.modalContent}>
                <Text style={s.modalTitle}>Food Sources</Text>
                <Text style={s.modalSub}>Top foods to fill your nutrient gaps</Text>

          {gaps.filter(g => g.status !== 'good').slice(0, 8).map((gap) => {
            const matchingRec = recs.find((r: any) => r.nutrientKey === gap.nutrient || r.helpsWith === gap.name);
            const foods: any[] = matchingRec?.allSources || (matchingRec?.food ? [{ food: matchingRec.food }] : []);
            if (foods.length === 0) return null;
            return (
              <View key={gap.nutrient} style={{ marginBottom: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textPrimary }}>{gap.name}</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>{gap.pct}% of daily</Text>
                </View>
                {foods.map((entry: any, idx: number) => {
                  const foodName = typeof entry === 'string' ? entry : entry.food;
                  if (hiddenFoods.has(foodName.toLowerCase())) return null;
                  const portion = typeof entry === 'string' ? getPortionHint(entry) : (entry.portion || getPortionHint(entry.food || ''));
                  return (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: idx < foods.length - 1 ? 1 : 0, borderBottomColor: '#F0F0F0' }}>
                      {pantryNames.some(pn => pn.includes(foodName.toLowerCase()) || foodName.toLowerCase().includes(pn)) ? (
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center', marginRight: 6 }}>
                          <Feather name="check" size={10} color="#34C759" />
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => onAddToPantry?.(foodName)}
                          style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: '#C8E6C9', backgroundColor: '#F1F8E9', justifyContent: 'center', alignItems: 'center', marginRight: 6 }}
                          activeOpacity={0.5}
                        >
                          <Text style={{ fontSize: 12, color: '#34C759', fontWeight: '700', marginTop: -1 }}>+</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={{ fontSize: 14, color: colors.textPrimary, textTransform: 'capitalize', flex: 1 }}>{foodName}</Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted, marginLeft: 8, flexShrink: 0 }}>{portion}</Text>
                      <TouchableOpacity
                        onPress={() => handleDislike(foodName)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        activeOpacity={0.5}
                        style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#FFCDD2', backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center', marginLeft: 8 }}
                      >
                        <Text style={{ fontSize: 11, color: '#D32F2F', fontWeight: '700', marginTop: -1 }}>x</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {/* Vitamin D source priority */}
          {gaps.some(g => g.nutrient === 'vitamin_d' && g.status !== 'good') && (
            <View style={{ backgroundColor: '#FFFBEB', borderRadius: 8, padding: 12, marginBottom: spacing.lg, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#92400E', marginBottom: 4 }}>
                <Feather name="sun" size={12} /> Vitamin D
              </Text>
              <Text style={{ fontSize: 12, color: '#78350F', lineHeight: 18 }}>
                Best source: outdoor UV exposure (10-30 min midday sun).{'\n'}
                Food helps but can't fully cover Vitamin D alone -- even 8 oz salmon is only ~15 mcg.{'\n'}
                If clinically low or very dark skin with limited sun: D3 supplement (1000-4000 IU/day).{'\n'}
                UVB lamp as last resort for those always indoors.
              </Text>
            </View>
          )}

          {/* Ask Mittens */}
          <View style={{ borderTopWidth: 1, borderTopColor: '#E5E5E5', paddingTop: spacing.md, marginTop: spacing.sm }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 }}>Ask Mittens</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={{ flex: 1, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.textPrimary }}
                placeholder="e.g. Can fish oil cover my vitamin A gap too?"
                placeholderTextColor={colors.textMuted}
                value={question}
                onChangeText={setQuestion}
                editable={!asking}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#000', borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', opacity: asking || !question.trim() ? 0.5 : 1 }}
                onPress={handleAsk}
                disabled={asking || !question.trim()}
              >
                {asking ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>Ask</Text>}
              </TouchableOpacity>
            </View>
            {answer ? (
              <View style={{ backgroundColor: '#F8F8F8', borderRadius: 8, padding: 12, marginTop: 10 }}>
                <Text style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 19 }}>{answer}</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity style={[s.modalBtnSave, { width: '100%', alignItems: 'center', marginTop: spacing.lg }]} onPress={handleClose}>
            <Text style={s.modalBtnTextSave}>Done</Text>
          </TouchableOpacity>
        </View>
        </View>
        </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ───────────── Shared Modal Styles ───────────── */

export const s = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalContent: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.xl },
  modalTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.xs },
  modalSub: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.lg },
  modalInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: spacing.md, fontSize: 15, color: colors.textPrimary,
    minHeight: 80, textAlignVertical: 'top', marginBottom: spacing.lg,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  modalBtnCancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  modalBtnDelete: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  modalBtnSave: { backgroundColor: colors.textPrimary, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.full },
  modalBtnTextCancel: { color: colors.textSecondary, fontWeight: '600' },
  modalBtnTextDelete: { color: '#D32F2F', fontWeight: '600' },
  modalBtnTextSave: { color: colors.bg, fontWeight: '600' },
  editItemsList: { backgroundColor: '#F7F7F7', borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md },
  editItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  editItemRemove: { width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  editItemNameInput: { flex: 1, fontSize: 14, color: colors.textPrimary, borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingVertical: 2, textTransform: 'capitalize' },
  editItemPortionInput: { fontSize: 14, color: colors.textPrimary, minWidth: 35, textAlign: 'right', borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingVertical: 2 },
  editHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, fontWeight: '500' },
  // Entry type tabs
  entryTabRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  entryTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  entryTabActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  entryTabText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  entryTabTextActive: { color: colors.bg, fontWeight: '600' },
  // Reusable type pills (activity type, sleep quality)
  typePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  typePillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  typePillText: { fontSize: 13, color: colors.textSecondary },
  typePillTextActive: { color: colors.bg, fontWeight: '600' },
  // Sleep duration input
  sleepDurationInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    width: 48, height: 40, textAlign: 'center',
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
  },
  // Time picker
  timePickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: '#FAFAFA',
  },
  timePickerLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  timePickerValue: { fontSize: 13, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  timePickerInline: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  timePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timePickerInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    width: 44, height: 36, textAlign: 'center',
    fontSize: 15, fontWeight: '600', color: colors.textPrimary,
  },
  timePickerColon: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  ampmRow: { flexDirection: 'row', marginLeft: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  ampmBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  ampmBtnActive: { backgroundColor: colors.textPrimary },
  ampmText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  ampmTextActive: { color: colors.bg },
});
