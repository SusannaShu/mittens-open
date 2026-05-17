import { useState } from 'react';
import { View, Text, TextInput, Image, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../../lib/theme';
import PhotoCapture from '../../common/PhotoCapture';
import VoiceMealInput from '../../common/VoiceMealInput';
import MealTypePicker from '../MealTypePicker';
import USDAFoodSearch from '../../common/USDAFoodSearch';
import { PillRow } from './PillRow';
import { MEAL_PACE_PILLS, MEAL_CHEWING_PILLS, MEAL_DISTRACTION_PILLS, MEAL_STRESS_PILLS, MEAL_SOCIAL_PILLS } from './constants';

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
  /** AI-detected foods from pipeline results */
  detectedFoods?: any[];
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
  analyzing, onSubmit, onClose, isFuture, detectedFoods,
}: MealFormProps) {
  const [mealPace, setMealPace] = useState('');
  const [mealChewing, setMealChewing] = useState('');
  const [mealDistraction, setMealDistraction] = useState('');
  const [mealStress, setMealStress] = useState('');
  const [mealSocial, setMealSocial] = useState('');
  const [showEatingContext, setShowEatingContext] = useState(false);

  const handleVoiceTranscript = (transcript: string) => {
    const separator = text.trim() ? ', ' : '';
    onTextChange(text + separator + transcript);
  };

  const hasInput = text.trim() || photos.length > 0;
  const hasUsdaFoods = usdaFoods && usdaFoods.length > 0;

  return (
    <>
      {/* Subtitle */}
      <Text style={f.subtitle}>
        Type what you ate, speak it, or add a photo.
      </Text>

      <MealTypePicker value={mealType} onChange={onMealTypeChange} />

      {/* Photo strip + voice input */}
      <View style={f.mediaRow}>
        {photos.length < 4 && (
          <PhotoCapture onCapture={(p) => onPhotosChange([...photos, ...p].slice(0, 4))} />
        )}
        <VoiceMealInput onTranscript={handleVoiceTranscript} />
        {photos.map((photo, idx) => (
          <View key={idx} style={f.photoThumb}>
            <Image source={photoSource(photo)} style={f.photoImg} />
            <TouchableOpacity
              onPress={() => onPhotosChange(photos.filter((_, i) => i !== idx))}
              style={f.photoRemove}
            >
              <Text style={f.photoRemoveText}>x</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      {/* Text input */}
      <TextInput
        style={f.textInput}
        value={text}
        onChangeText={onTextChange}
        placeholder="e.g. 2 eggs, avocado toast..."
        placeholderTextColor={colors.textMuted}
        multiline
      />

      {/* Analyze button -- right below the text input */}
      {hasInput && (
        <TouchableOpacity
          style={[f.analyzeBtn, analyzing && f.analyzeBtnDisabled]}
          onPress={onSubmit}
          disabled={analyzing}
          activeOpacity={0.7}
        >
          {analyzing ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <>
              <Feather name="zap" size={14} color={colors.bg} />
              <Text style={f.analyzeBtnText}>Analyze</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Detected foods list (from AI analysis) */}
      {detectedFoods && detectedFoods.length > 0 && (
        <View style={f.detectedSection}>
          <Text style={f.sectionLabel}>Detected Foods</Text>
          {detectedFoods.map((food, idx) => (
            <View key={idx} style={f.foodCard}>
              <View style={f.foodCardLeft}>
                <Text style={f.foodName}>{food.name}</Text>
                <Text style={f.foodMeta}>
                  {food.household_portion || `${food.portion_g}g`}
                  {food.household_portion ? ` (${food.portion_g}g)` : ''}
                  {food.cooking ? ` -- ${food.cooking}` : ''}
                </Text>
              </View>
              {food.usdaMatch && (
                <Text style={f.usdaTag} numberOfLines={1}>USDA: {food.usdaMatch}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Manual USDA search section */}
      {onUsdaFoodsChange && usdaFoods && (
        <>
          <View style={f.divider}>
            <View style={f.dividerLine} />
            <Text style={f.dividerText}>or search manually</Text>
            <View style={f.dividerLine} />
          </View>

          {/* USDA foods already added */}
          {usdaFoods.length > 0 && (
            <View style={f.usdaList}>
              {usdaFoods.map((food, i) => (
                <View key={i} style={f.foodCard}>
                  <View style={f.foodCardLeft}>
                    <Text style={f.foodName}>{food.customName || food.name}</Text>
                    <Text style={f.foodMeta}>
                      USDA: {food.name}
                    </Text>
                  </View>
                  <View style={f.usdaQtyRow}>
                    <TextInput
                      style={f.usdaQtyInput}
                      value={String(food.amountGram || 100)}
                      keyboardType="numeric"
                      onChangeText={(val) => {
                        const newFoods = [...usdaFoods];
                        newFoods[i] = { ...food, amountGram: parseFloat(val) || 0 };
                        onUsdaFoodsChange(newFoods);
                      }}
                    />
                    <Text style={f.usdaQtyUnit}>g</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => onUsdaFoodsChange(usdaFoods.filter((_, idx) => idx !== i))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Search always visible */}
          <USDAFoodSearch onAddFood={(food) => onUsdaFoodsChange([...usdaFoods, food])} />
        </>
      )}

      {/* Eating context -- collapsed by default */}
      {!isFuture && (
        <View style={f.contextSection}>
          <TouchableOpacity
            style={f.contextToggle}
            onPress={() => setShowEatingContext(!showEatingContext)}
            activeOpacity={0.6}
          >
            <Text style={f.contextToggleText}>Eating context</Text>
            <Feather
              name={showEatingContext ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textMuted}
            />
          </TouchableOpacity>

          {showEatingContext && (
            <View style={f.contextContent}>
              <Text style={f.pillLabel}>Eating pace</Text>
              <PillRow pills={MEAL_PACE_PILLS} value={mealPace} onChange={setMealPace} />

              <Text style={f.pillLabel}>Chewing</Text>
              <PillRow pills={MEAL_CHEWING_PILLS} value={mealChewing} onChange={setMealChewing} />

              <Text style={f.pillLabel}>Distraction level</Text>
              <PillRow pills={MEAL_DISTRACTION_PILLS} value={mealDistraction} onChange={setMealDistraction} />

              <Text style={f.pillLabel}>Stress level</Text>
              <PillRow pills={MEAL_STRESS_PILLS} value={mealStress} onChange={setMealStress} />

              <Text style={f.pillLabel}>Social context</Text>
              <PillRow pills={MEAL_SOCIAL_PILLS} value={mealSocial} onChange={setMealSocial} />
            </View>
          )}
        </View>
      )}
    </>
  );
}

const f = StyleSheet.create({
  subtitle: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontWeight: '500',
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  photoThumb: { position: 'relative' },
  photoImg: { width: 52, height: 52, borderRadius: 8 },
  photoRemove: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#000',
    justifyContent: 'center', alignItems: 'center',
  },
  photoRemoveText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    paddingTop: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    minHeight: 56,
    textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.textPrimary,
    paddingVertical: 10,
    borderRadius: radius.full,
    marginBottom: spacing.sm,
  },
  analyzeBtnDisabled: { opacity: 0.6 },
  analyzeBtnText: { color: colors.bg, fontWeight: '600', fontSize: 13 },
  detectedSection: { marginBottom: spacing.sm },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  foodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: 4,
    gap: 8,
  },
  foodCardLeft: { flex: 1 },
  foodName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  foodMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  usdaTag: {
    fontSize: 10,
    color: colors.textMuted,
    maxWidth: 100,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: spacing.sm,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  usdaList: { marginBottom: spacing.xs },
  usdaQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAEAEA',
    borderRadius: 4,
    paddingHorizontal: 6,
  },
  usdaQtyInput: {
    fontSize: 13,
    color: colors.textPrimary,
    minWidth: 30,
    textAlign: 'right',
    paddingVertical: 4,
    fontWeight: '600',
  },
  usdaQtyUnit: { fontSize: 12, color: colors.textMuted, marginLeft: 2 },
  contextSection: {
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  contextToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  contextToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contextContent: { marginTop: spacing.sm },
  pillLabel: { fontSize: 10, color: colors.textMuted, marginBottom: 4 },
});
