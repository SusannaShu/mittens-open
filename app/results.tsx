import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter as useExpoRouter } from 'expo-router';
import { useLogConfirmedMutation, useAnalyzeTextMutation, useUpdateEntryDirectMutation } from '../lib/services/nutritionApi';
import { colors, radius, spacing } from '../lib/theme';

export default function ConfirmScreen() {
  const router = useExpoRouter();
  const { data: dataStr, imageId, mealType, imageUrl: paramImageUrl, imageIds: imageIdsStr, photoTimestamp, existingLogId } = useLocalSearchParams<{ 
    data: string, imageId?: string, mealType?: string, imageUrl?: string, imageIds?: string, photoTimestamp?: string, existingLogId?: string 
  }>();

  const [logConfirmed] = useLogConfirmedMutation();
  const [analyzeText] = useAnalyzeTextMutation();
  const [updateEntryDirect] = useUpdateEntryDirectMutation();

  const isEditMode = !!existingLogId;

  const [mealName, setMealName] = useState<string>('');
  const [foods, setFoods] = useState<any[]>([]);
  const [imageUrl, setImageUrl] = useState<string | undefined>(paramImageUrl as string | undefined);
  const [logging, setLogging] = useState(false);
  const [addText, setAddText] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    try {
      const result = dataStr ? JSON.parse(dataStr) : null;
      if (result) {
        setFoods(result.items || result.foods || []);
        if (result.mealName) setMealName(result.mealName);
        if (result.imageUrl) setImageUrl(result.imageUrl);
      }
    } catch {
      // invalid
    }
  }, [dataStr]);

  if (!foods.length) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No foods identified.</Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.doneBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleUpdate = (index: number, key: string, value: string) => {
    const newFoods = [...foods];
    const updatedItem = { ...newFoods[index] };

    // Common setup for scaling
    if (!updatedItem._originalPortionG) {
      updatedItem._originalPortionG = parseFloat(String(updatedItem.portion_g)) || 1;
      updatedItem._originalHousehold = updatedItem.household_portion || '';
      updatedItem._originalNutrients = { ...(updatedItem.nutrients || {}) };
    }

    if (key === 'portion_g') {
      const origG = updatedItem._originalPortionG;
      const newG = parseFloat(value) || 0;
      
      if (origG > 0 && newG > 0) {
        const ratio = newG / origG;
        // Scale nutrients
        if (updatedItem._originalNutrients) {
          const scaledNutrients: Record<string, number> = {};
          for (const [nKey, nVal] of Object.entries(updatedItem._originalNutrients)) {
            if (typeof nVal === 'number') {
              scaledNutrients[nKey] = Math.round((nVal * ratio) * 10) / 10;
            }
          }
          updatedItem.nutrients = scaledNutrients;
        }
        // Scale household text 
        const match = updatedItem._originalHousehold.match(/^([\d.]+)\s*(.*)/);
        if (match) {
          const origQty = parseFloat(match[1]);
          if (!isNaN(origQty) && origQty > 0) {
            const newQty = Math.round((origQty * ratio) * 100) / 100;
            updatedItem.household_portion = `${newQty} ${match[2]}`.trim();
          }
        }
      }
      updatedItem[key] = value;
    } else if (key === 'household_portion') {
      updatedItem[key] = value;
      // Try to parse leading number to scale everything else automatically
      const origMatch = updatedItem._originalHousehold.match(/^([\d.]+)/);
      const newMatch = value.match(/^([\d.]+)/);
      if (origMatch && newMatch) {
         const origQty = parseFloat(origMatch[1]);
         const newQty = parseFloat(newMatch[1]);
         if (origQty > 0 && newQty > 0 && !isNaN(newQty)) {
           const ratio = newQty / origQty;
           // Scale portion_g
           const origG = updatedItem._originalPortionG;
           updatedItem.portion_g = String(Math.round((origG * ratio) * 10) / 10);
           // Scale nutrients
           if (updatedItem._originalNutrients) {
             const scaledNutrients: Record<string, number> = {};
             for (const [nKey, nVal] of Object.entries(updatedItem._originalNutrients)) {
               if (typeof nVal === 'number') {
                 scaledNutrients[nKey] = Math.round((nVal * ratio) * 10) / 10;
               }
             }
             updatedItem.nutrients = scaledNutrients;
           }
         }
      }
    } else {
      updatedItem[key] = value;
    }
    
    newFoods[index] = updatedItem;
    setFoods(newFoods);
  };

  const handleRemove = (index: number) => {
    const newFoods = [...foods];
    newFoods.splice(index, 1);
    setFoods(newFoods);
  };

  const handleAddItem = async () => {
    if (!addText.trim()) return;
    setAddingItem(true);
    try {
       const imageIdNum = imageId ? parseInt(imageId, 10) : undefined;
       const result: any = await analyzeText({ text: addText.trim(), imageId: imageIdNum }).unwrap();
       const newItems = result.items || [];
       if (newItems.length > 0) {
        setFoods([...foods, ...newItems]);
        setAddText('');
      } else {
        Alert.alert('Notice', 'AI could not track nutrition for that item.');
      }
    } catch (e: any) {
      Alert.alert('Error', 'Failed to add item: ' + (e.data?.message || e.message));
    } finally {
      setAddingItem(false);
    }
  };

  const handleConfirm = async () => {
    setLogging(true);
    try {
      let logId: number | undefined;
      // Ensure numeric fields are correctly typed before submitting
      const sanitizedFoods = foods.map(f => ({
        ...f,
        portion_g: typeof f.portion_g === 'string' ? (parseFloat(f.portion_g) || 0) : f.portion_g,
      }));

      if (sanitizedFoods.length > 0) {
        if (isEditMode) {
          // Edit mode: update existing entry
          const res = await updateEntryDirect({
            id: parseInt(existingLogId!, 10),
            items: sanitizedFoods,
            logName: mealName,
            mealType: mealType || 'snack',
          }).unwrap();
          logId = parseInt(existingLogId!, 10);
          
          const finalItems = res.entry && res.entry.items ? res.entry.items : sanitizedFoods;

          // Return to chat with edit-specific params so the card updates in-place
          router.replace({
            pathname: '/(tabs)/chat',
            params: {
              editedLogId: String(logId),
              editedItems: JSON.stringify(finalItems),
              editedMealName: mealName,
            },
          });
          return;
        } else {
          // Create mode: log new entry
          const parsedImageIds = imageIdsStr ? JSON.parse(imageIdsStr) : undefined;
          const res = await logConfirmed({
            mealName,
            foods: sanitizedFoods, 
            mealType: mealType || 'snack', 
            imageId: imageId ? parseInt(imageId, 10) : undefined,
            imageIds: parsedImageIds,
            loggedAt: photoTimestamp || undefined,
          }).unwrap();
          if (res && res.ids && res.ids.length > 0) logId = res.ids[0];
        }
      }
      router.replace({
        pathname: '/(tabs)/chat',
        params: {
          loggedMeal: mealName,
          loggedItemCount: String(sanitizedFoods.length),
          loggedImageUrl: imageUrl || '',
          loggedId: logId ? String(logId) : '',
        },
      });
    } catch (e: any) {
      Alert.alert('Error', `Failed to ${isEditMode ? 'update' : 'log'} items: ` + (e.data?.message || e.message));
      setLogging(false);
    }
  };

  let sumCal = 0;
  foods.forEach(f => { sumCal += f.nutrients?.calories || 0; });

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TextInput 
          style={styles.headerTitleInput}
          value={mealName}
          onChangeText={setMealName}
          placeholder="Main Meal Name"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.headerSub}>
          {foods.length} item(s) • ~{Math.round(sumCal)} kcal
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tap to edit before logging</Text>
        {foods.map((food, i) => {
          const isActivity = food.type === 'activity';
          return (
          <View key={i} style={[styles.foodCard, isActivity && styles.activityCard]}>
            <TouchableOpacity onPress={() => handleRemove(i)} style={styles.removeBtn}>
              <Text style={styles.removeIcon}>✕</Text>
            </TouchableOpacity>

            <View style={styles.foodHeader}>
              <TextInput 
                style={styles.foodNameInput} 
                value={food.name}
                onChangeText={(val) => handleUpdate(i, 'name', val)}
                placeholder={isActivity ? 'Activity' : 'Food name'}
                placeholderTextColor="#999"
              />
              <View style={styles.portionColumn}>
                {isActivity ? (
                  <Text style={styles.activityDuration}>{food.household_portion || 'activity'}</Text>
                ) : (
                  <>
                    <TextInput
                      style={styles.householdInput}
                      value={food.household_portion || ''}
                      onChangeText={(val) => handleUpdate(i, 'household_portion', val)}
                      placeholder="1 cup"
                      placeholderTextColor="#BBB"
                    />
                    <View style={styles.portionRow}>
                      <TextInput 
                        style={styles.foodPortionInput} 
                        value={String(food.portion_g || '')}
                        onChangeText={(val) => handleUpdate(i, 'portion_g', val)}
                        keyboardType="numeric"
                        placeholder="100"
                      />
                      <Text style={styles.portionLabel}>g</Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            {!isActivity && food.cooking && (
              <TextInput 
                style={styles.foodCookingInput} 
                value={food.cooking}
                onChangeText={(val) => handleUpdate(i, 'cooking', val)}
                placeholder="Cooking method"
              />
            )}

            <View style={styles.nutrientChips}>
              {isActivity ? (
                // Show only the relevant nutrients for activities
                Object.entries(food.nutrients || {}).filter(([, v]) => typeof v === 'number' && (v as number) > 0).map(([key, val]) => (
                  <Text key={key} style={[styles.chip, styles.activityChip]}>
                    +{Math.round(val as number)} {key.replace(/_/g, ' ')}
                  </Text>
                ))
              ) : (
                <>
                  <Text style={styles.chip}>{Math.round(food.nutrients?.calories || 0)} kcal</Text>
                  <Text style={styles.chip}>{Math.round(food.nutrients?.protein || 0)}g protein</Text>
                  <Text style={styles.chip}>{Math.round(food.nutrients?.carbs || 0)}g carbs</Text>
                  <Text style={styles.chip}>{Math.round(food.nutrients?.fat || 0)}g fat</Text>
                </>
              )}
            </View>
          </View>
          );
        })}
        
        <View style={styles.addCard}>
          <Text style={styles.addLabel}>Missed something? Type to add</Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={addText}
              onChangeText={setAddText}
              placeholder="e.g. 15g mixed nuts"
              placeholderTextColor={colors.textMuted}
              editable={!addingItem}
              onSubmitEditing={handleAddItem}
            />
            <TouchableOpacity style={[styles.addBtn, addingItem && { opacity: 0.5 }]} onPress={handleAddItem} disabled={addingItem}>
              {addingItem ? <ActivityIndicator size="small" color="#FFF"/> : <Text style={styles.addBtnText}>Add</Text>}
            </TouchableOpacity>
          </View>
        </View>

      </View>

      <TouchableOpacity
        style={[styles.doneBtn, logging && { opacity: 0.7 }]}
        onPress={handleConfirm}
        disabled={logging}
      >
        {logging ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.doneBtnText}>{isEditMode ? 'Save Changes' : 'Confirm & Log'}</Text>
        )}
      </TouchableOpacity>
      
      {/* Spacer so it doesn't hit bottom bar */}
      <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  emptyText: { color: colors.textMuted, fontSize: 16, marginBottom: spacing.lg },

  header: { alignItems: 'center', paddingVertical: spacing.lg, width: '100%' },
  headerTitleInput: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', minWidth: 200, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 8 },

  section: { marginBottom: spacing.lg + 4 },
  sectionTitle: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    marginBottom: spacing.md, textTransform: 'uppercase', letterSpacing: 1,
    textAlign: 'center',
  },

  foodCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.md, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
    position: 'relative',
  },
  removeBtn: {
    position: 'absolute', top: -10, right: -10, width: 28, height: 28,
    borderRadius: 14, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', zIndex: 10,
    borderWidth: 2, borderColor: colors.bg,
  },
  removeIcon: { color: '#FFF', fontSize: 12, fontWeight: '800' },

  foodHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: spacing.sm },
  foodNameInput: { 
    fontSize: 16, fontWeight: '600', color: colors.textPrimary, flex: 1, 
    borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingBottom: 2,
  },
  portionColumn: { alignItems: 'flex-end' },
  householdInput: {
    fontSize: 12, color: colors.textMuted, textAlign: 'right',
    paddingBottom: 0, fontWeight: '500',
  },
  portionRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingBottom: 2 },
  foodPortionInput: { fontSize: 14, color: '#000', minWidth: 30, textAlign: 'right' },
  portionLabel: { fontSize: 14, color: colors.textMuted, marginLeft: 2 },
  
  foodCookingInput: { 
    fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: '#E5E5E5', paddingBottom: 2,
  },
  
  activityCard: {
    borderColor: '#E8E8E8', borderStyle: 'dashed',
  },
  activityDuration: {
    fontSize: 13, color: colors.textSecondary, fontWeight: '500', fontStyle: 'italic',
  },
  nutrientChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: {
    fontSize: 11, color: colors.textSecondary, backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 6,
  },
  activityChip: {
    backgroundColor: '#F0F0F0', fontWeight: '600',
  },

  addCard: {
    backgroundColor: '#FAFAFA', borderRadius: radius.md, padding: 14,
    borderWidth: 1, borderColor: '#EEE',
    borderStyle: 'dashed',
  },
  addLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm, fontWeight: '500' },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  addInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  addBtn: {
    backgroundColor: colors.textPrimary, borderRadius: radius.sm,
    paddingHorizontal: spacing.lg, justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },

  doneBtn: {
    backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md,
    alignItems: 'center', width: '100%',
  },
  doneBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
});
