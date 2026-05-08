import { useState } from 'react';
import { View, Text, TextInput, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../../lib/theme';
import PhotoCapture from '../../common/PhotoCapture';
import MealTypePicker from '../MealTypePicker';
import USDAFoodSearch from '../../common/USDAFoodSearch';
import { PillRow } from './PillRow';
import { MEAL_PACE_PILLS, MEAL_CHEWING_PILLS, MEAL_DISTRACTION_PILLS, MEAL_STRESS_PILLS, MEAL_SOCIAL_PILLS } from './constants';
import { s } from '../TodayModals';

interface MealFormProps {
  text: string;
  onTextChange: (t: string) => void;
  usdaFoods?: any[];
  onUsdaFoodsChange?: (foods: any[]) => void;
  photos: string[];
  onPhotosChange: (p: string[]) => void;
  mealType: string;
  onMealTypeChange: (t: string) => void;
  analyzing: boolean;
  onSubmit: () => void;
  onClose: () => void;
  isFuture: boolean;
}

export function MealForm({
  text, onTextChange, usdaFoods, onUsdaFoodsChange,
  photos, onPhotosChange, mealType, onMealTypeChange,
  analyzing, onSubmit, onClose, isFuture,
}: MealFormProps) {
  const [mealPace, setMealPace] = useState('');
  const [mealChewing, setMealChewing] = useState('');
  const [mealDistraction, setMealDistraction] = useState('');
  const [mealStress, setMealStress] = useState('');
  const [mealSocial, setMealSocial] = useState('');

  return (
    <>
      <Text style={s.modalSub}>Type what you ate or add a photo. AI will analyze and estimate portions.</Text>
      <MealTypePicker value={mealType} onChange={onMealTypeChange} />

      {/* Photo strip */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
        {photos.length < 4 && (
          <PhotoCapture onCapture={(p) => onPhotosChange([...photos, ...p].slice(0, 4))} />
        )}
        {photos.map((photo, idx) => (
          <View key={idx} style={{ position: 'relative' }}>
            <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={{ width: 56, height: 56, borderRadius: 8 }} />
            <TouchableOpacity
              onPress={() => onPhotosChange(photos.filter((_, i) => i !== idx))}
              style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>x</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <TextInput
        style={s.modalInput}
        value={text}
        onChangeText={onTextChange}
        placeholder="e.g. 2 eggs, avocado toast..."
        placeholderTextColor={colors.textMuted}
        multiline
      />

      {onUsdaFoodsChange && usdaFoods && (
        <>
          <USDAFoodSearch onAddFood={(f) => onUsdaFoodsChange([...usdaFoods, f])} />
          {usdaFoods.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              {usdaFoods.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8f9fa', padding: 8, borderRadius: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.textPrimary, flex: 1 }}>{f.customName || f.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, marginRight: 8 }}>{f.amountGram}g</Text>
                  <TouchableOpacity onPress={() => onUsdaFoodsChange(usdaFoods.filter((_, idx) => idx !== i))}>
                    <Text style={{ color: '#D32F2F', fontSize: 14, fontWeight: '700' }}>x</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Meal reflection pills -- only for past events */}
      {!isFuture && (
        <>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 }}>How did you eat?</Text>

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Eating pace</Text>
          <PillRow pills={MEAL_PACE_PILLS} value={mealPace} onChange={setMealPace} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Chewing</Text>
          <PillRow pills={MEAL_CHEWING_PILLS} value={mealChewing} onChange={setMealChewing} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Distraction level</Text>
          <PillRow pills={MEAL_DISTRACTION_PILLS} value={mealDistraction} onChange={setMealDistraction} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Stress level</Text>
          <PillRow pills={MEAL_STRESS_PILLS} value={mealStress} onChange={setMealStress} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Social context</Text>
          <PillRow pills={MEAL_SOCIAL_PILLS} value={mealSocial} onChange={setMealSocial} />
        </>
      )}

      <View style={s.modalActions}>
        <TouchableOpacity style={s.modalBtnCancel} onPress={onClose} disabled={analyzing}>
          <Text style={s.modalBtnTextCancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.modalBtnSave} onPress={onSubmit} disabled={analyzing || (!text.trim() && photos.length === 0)}>
          {analyzing ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>Analyze</Text>}
        </TouchableOpacity>
      </View>
    </>
  );
}
