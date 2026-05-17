import { useState } from 'react';
import { View, Text, TextInput, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../lib/theme';
import PhotoCapture from '../../common/PhotoCapture';
import VoiceMealInput from '../../common/VoiceMealInput';
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

/** Detect whether a photo string is a file/content URI or raw base64 */
function photoSource(photo: string) {
  if (photo.startsWith('file://') || photo.startsWith('ph://') || photo.startsWith('content://') || photo.startsWith('http')) {
    return { uri: photo };
  }
  return { uri: `data:image/jpeg;base64,${photo}` };
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

  const handleVoiceTranscript = (transcript: string) => {
    const separator = text.trim() ? ', ' : '';
    onTextChange(text + separator + transcript);
  };

  return (
    <>
      <Text style={s.modalSub}>Type what you ate, speak it, or add a photo. AI will analyze and estimate portions.</Text>
      <MealTypePicker value={mealType} onChange={onMealTypeChange} />

      {/* Photo strip + voice input */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
        {photos.length < 4 && (
          <PhotoCapture onCapture={(p) => onPhotosChange([...photos, ...p].slice(0, 4))} />
        )}
        <VoiceMealInput onTranscript={handleVoiceTranscript} />
        {photos.map((photo, idx) => (
          <View key={idx} style={{ position: 'relative' }}>
            <Image source={photoSource(photo)} style={{ width: 56, height: 56, borderRadius: 8 }} />
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

      {/* Manual search divider */}
      {onUsdaFoodsChange && usdaFoods && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '500' }}>or search manually</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <USDAFoodSearch onAddFood={(f) => onUsdaFoodsChange([...usdaFoods, f])} />
          {usdaFoods.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              {usdaFoods.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8f9fa', padding: 8, borderRadius: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.textPrimary, flex: 1 }} numberOfLines={1}>{f.customName || f.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e0e0e0', borderRadius: 4, paddingHorizontal: 6, marginHorizontal: 8 }}>
                    <TextInput 
                      style={{ fontSize: 13, color: colors.textPrimary, minWidth: 30, textAlign: 'right', paddingVertical: 4, fontWeight: '600' }}
                      value={String(f.amountGram || 100)}
                      keyboardType="numeric"
                      onChangeText={(val) => {
                        const newFoods = [...usdaFoods];
                        newFoods[i] = { ...f, amountGram: parseFloat(val) || 0 };
                        onUsdaFoodsChange(newFoods);
                      }}
                    />
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginLeft: 2 }}>g</Text>
                  </View>
                  <TouchableOpacity onPress={() => onUsdaFoodsChange(usdaFoods.filter((_, idx) => idx !== i))}>
                    <Text style={{ color: '#D32F2F', fontSize: 14, fontWeight: '700', padding: 4 }}>x</Text>
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
        <TouchableOpacity
          style={s.modalBtnSave}
          onPress={onSubmit}
          disabled={analyzing || (!text.trim() && photos.length === 0 && (!usdaFoods || usdaFoods.length === 0))}
        >
          {analyzing ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>Analyze</Text>}
        </TouchableOpacity>
      </View>
    </>
  );
}
