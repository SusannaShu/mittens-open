import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useUpdateEntryMutation, useUpdateEntryDirectMutation, useDeleteEntryMutation,
  useAnalyzeTextMutation, useSmartSnapAsyncMutation, useChatWithMittensMutation,
  useDislikeFoodMutation, useLazyCheckJobStatusQuery,
} from '../lib/services/nutritionApi';
import { useAddPantryItemMutation, useDeletePantryItemMutation, useUpdatePantryItemMutation } from '../lib/services/profileApi';
import { useLogActivityMutation, useReflectActivityMutation, useDeleteActivityMutation, ActivityEntry } from '../lib/services/activityApi';
import { useLogSleepMutation } from '../lib/services/schedule/sleepApi';

export function useTodayHandlers(refetch: () => void) {
  const router = useRouter();

  // RTK mutations
  const [updateEntry] = useUpdateEntryMutation();
  const [updateEntryDirect] = useUpdateEntryDirectMutation();
  const [deleteEntry] = useDeleteEntryMutation();
  const [analyzeText] = useAnalyzeTextMutation();
  const [smartSnapAsync] = useSmartSnapAsyncMutation();
  const [checkJobStatus] = useLazyCheckJobStatusQuery();
  const [chatWithMittens] = useChatWithMittensMutation();
  const [dislikeFoodMutation] = useDislikeFoodMutation();
  const [addPantryItem] = useAddPantryItemMutation();
  const [deletePantryItem] = useDeletePantryItemMutation();
  const [updatePantryItem] = useUpdatePantryItemMutation();
  const [logActivity] = useLogActivityMutation();
  const [reflectActivity] = useReflectActivityMutation();
  const [deleteActivity] = useDeleteActivityMutation();
  const [logSleep] = useLogSleepMutation();

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editItemText, setEditItemText] = useState('');
  const [editDisplayTitle, setEditDisplayTitle] = useState('');
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editMealType, setEditMealType] = useState('snack');
  const [editLoggedAt, setEditLoggedAt] = useState<Date>(new Date());
  const [savingEdit, setSavingEdit] = useState(false);
  const [editFailureLogs, setEditFailureLogs] = useState<any[]>([]);

  // Manual entry modal state
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualPhotos, setManualPhotos] = useState<string[]>([]);
  const [analyzingManual, setAnalyzingManual] = useState(false);
  const [manualMealType, setManualMealType] = useState('snack');
  const [manualLoggedAt, setManualLoggedAt] = useState(new Date());
  const [manualUsdaFoods, setManualUsdaFoods] = useState<any[]>([]);

  // Other modal states
  const [sourcesModalVisible, setSourcesModalVisible] = useState(false);
  const [pastLogsVisible, setPastLogsVisible] = useState(false);
  const [pantryEditItem, setPantryEditItem] = useState<{ id: number; foodName: string; quantity?: string; freshness: string } | null>(null);

  // Activity edit modal state
  const [activityEditVisible, setActivityEditVisible] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityEntry | null>(null);

  // Meal plan modal states
  const [mealDetailModal, setMealDetailModal] = useState<{ key: string; label: string; meal: any } | null>(null);
  const [groceryModalVisible, setGroceryModalVisible] = useState(false);
  const [projectionExpanded, setProjectionExpanded] = useState(false);
  const [hiddenGroceryItems, setHiddenGroceryItems] = useState<string[]>([]);
  const [dislikedMealItems, setDislikedMealItems] = useState<string[]>([]);

  /* ── Edit handlers ── */

  const handleEditItem = (idx: number, key: string, value: string) => {
    const updated = [...editItems];
    const item = { ...updated[idx] };

    // Common setup for scaling
    if (!item._originalPortionG) {
      item._originalPortionG = parseFloat(item.portion_g || item.portionG || '0') || 1;
      item._originalHousehold = item.household_portion || '';
      item._originalNutrients = { ...(item.nutrients || {}) };
    }

    if (key === 'portion_g') {
      const origG = item._originalPortionG;
      const newG = parseFloat(value) || 0;
      
      if (origG > 0 && newG > 0) {
        const ratio = newG / origG;
        // Scale nutrients
        if (item._originalNutrients) {
          const scaled: Record<string, number> = {};
          for (const [k, v] of Object.entries(item._originalNutrients)) {
            scaled[k] = Math.round(((v as number) * ratio) * 100) / 100;
          }
          item.nutrients = scaled;
        }
        // Scale household text
        const match = item._originalHousehold.match(/^([\d.]+)\s*(.*)/);
        if (match) {
          const origQty = parseFloat(match[1]);
          if (!isNaN(origQty) && origQty > 0) {
            const newQty = Math.round((origQty * ratio) * 100) / 100;
            item.household_portion = `${newQty} ${match[2]}`.trim();
          }
        }
      }
      item.portion_g = value;
    } else if (key === 'household_portion') {
      item[key] = value;
      const origMatch = item._originalHousehold.match(/^([\d.]+)/);
      const newMatch = value.match(/^([\d.]+)/);
      if (origMatch && newMatch) {
         const origQty = parseFloat(origMatch[1]);
         const newQty = parseFloat(newMatch[1]);
         if (origQty > 0 && newQty > 0 && !isNaN(newQty)) {
           const ratio = newQty / origQty;
           // Scale portion_g
           const origG = item._originalPortionG;
           item.portion_g = String(Math.round((origG * ratio) * 10) / 10);
           // Scale nutrients
           if (item._originalNutrients) {
             const scaled: Record<string, number> = {};
             for (const [k, v] of Object.entries(item._originalNutrients)) {
               scaled[k] = Math.round(((v as number) * ratio) * 100) / 100;
             }
             item.nutrients = scaled;
           }
         }
      }
    } else if (key === 'name') {
      if (!item._originalName) item._originalName = item.name || item.foodName || '';
      item.name = value;
      item._nameChanged = (value.toLowerCase().trim() !== (item._originalName || '').toLowerCase().trim());
    } else {
      item[key] = value;
    }

    updated[idx] = item;
    setEditItems(updated);
  };

  const handleRemoveEditItem = (idx: number) => {
    setEditItems(editItems.filter((_, i) => i !== idx));
  };

  const handleDirectSave = async () => {
    if (!editItemId || editItems.length === 0) return;
    setSavingEdit(true);
    try {
      let finalItems = [...editItems];

      // Re-analyze items with changed names via AI
      const changedItems = finalItems.filter((i: any) => i._nameChanged);
      if (changedItems.length > 0) {
        for (let i = 0; i < finalItems.length; i++) {
          const item = finalItems[i];
          if (!item._nameChanged) continue;

          // Use AI to get nutrients for the new food name
          const desc = `${item.name}, ${item.portion_g || 100}g`;
          const result: any = await analyzeText({ text: desc }).unwrap();
          const newItems = result.items || [];
          if (newItems.length > 0) {
            const reanalyzed = newItems[0];
            finalItems[i] = {
              ...item,
              nutrients: reanalyzed.nutrients || item.nutrients,
              cooking: reanalyzed.cooking || item.cooking,
              household_portion: reanalyzed.household_portion || `${item.portion_g || 100}g`,
              nutrient_source: reanalyzed.nutrient_source || 'ai',
              _nameChanged: undefined,
              _originalName: undefined,
            };
          }
        }
      }

      // Clean up internal tracking fields before sending
      finalItems = finalItems.map((item: any) => {
        const { _nameChanged, _originalName, _originalPortionG, _originalNutrients, ...clean } = item;
        return clean;
      });

      const names = finalItems.map((i: any) => i.name || i.foodName).filter(Boolean);
      await updateEntryDirect({
        id: editItemId,
        items: finalItems,
        logName: names.join(', '),
        mealType: editMealType,
        loggedAt: editLoggedAt.toISOString(),
      }).unwrap();
      setEditModalVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e.data?.message || 'Failed to save changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!editItemId || !editItemText.trim()) return;
    setSavingEdit(true);
    try {
      await updateEntry({ id: editItemId, text: editItemText.trim() }).unwrap();
      setEditModalVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e.data?.message || 'Failed to update entry.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteEntry = (id: number, name: string) => {
    Alert.alert('Delete Entry', `Remove ${name} from today's log?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try { await deleteEntry(id).unwrap(); } catch { Alert.alert('Error', 'Failed to delete entry'); }
        },
      },
    ]);
  };

  /* ── Manual entry handler ── */

  const handleManualSubmit = async () => {
    if (!manualText.trim() && manualPhotos.length === 0 && manualUsdaFoods.length === 0) return;
    
    // Bypass AI if we ONLY have manual USDA foods
    if (!manualText.trim() && manualPhotos.length === 0 && manualUsdaFoods.length > 0) {
      const items = manualUsdaFoods.map(f => {
        const ratio = (f.amountGram || 100) / 100;
        const scaledNutrients: any = {};
        if (f.nutrients) {
          for (const [k, v] of Object.entries(f.nutrients)) {
            scaledNutrients[k] = Math.round(((v as number) * ratio) * 100) / 100;
          }
        }
        return {
          name: f.customName || f.name,
          portion_g: f.amountGram || 100,
          household_portion: f.amountGram ? `${f.amountGram}g` : '100g',
          nutrients: scaledNutrients,
          usda_match: f.name,
          nutrient_source: 'usda',
        };
      });
      
      setManualModalVisible(false);
      setManualUsdaFoods([]);
      
      router.push({
        pathname: '/results',
        params: { data: JSON.stringify({ items, mealName: 'Manual Entry' }), mealType: manualMealType, photoTimestamp: manualLoggedAt.toISOString() },
      });
      return;
    }

    setAnalyzingManual(true);
    try {
      let result: any;
      if (manualPhotos.length > 0) {
        const { jobId } = await smartSnapAsync({ image: manualPhotos[0], extraImages: manualPhotos.slice(1) }).unwrap();
        // Poll for result
        const pollForResult = async (id: string, maxAttempts = 60, intervalMs = 3000): Promise<any> => {
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            const { data } = await checkJobStatus(id, false);
            if (data?.status === 'completed') return data.result;
            if (data?.status === 'failed') throw new Error(data.error || 'Job failed');
          }
          throw new Error('Request timed out');
        };
        result = await pollForResult(jobId);
      } else {
        result = await analyzeText({ text: manualText.trim(), mealType: manualMealType }).unwrap();
      }
      
      // If we have manual USDA foods, merge them with the AI result
      if (manualUsdaFoods.length > 0 && result) {
        const manualItems = manualUsdaFoods.map(f => {
          const ratio = (f.amountGram || 100) / 100;
          const scaledNutrients: any = {};
          if (f.nutrients) {
            for (const [k, v] of Object.entries(f.nutrients)) {
              scaledNutrients[k] = Math.round(((v as number) * ratio) * 100) / 100;
            }
          }
          return {
            name: f.customName || f.name,
            portion_g: f.amountGram || 100,
            household_portion: f.amountGram ? `${f.amountGram}g` : '100g',
            nutrients: scaledNutrients,
            usda_match: f.name,
            nutrient_source: 'usda',
          };
        });
        result.items = [...(result.items || []), ...manualItems];
      }

      if (manualText.trim() && result) {
        result = { ...result, mealName: result.mealName || manualText.trim() };
      }
      setManualModalVisible(false);
      setManualText('');
      setManualPhotos([]);
      setManualUsdaFoods([]);
      router.push({
        pathname: '/results',
        params: { data: JSON.stringify(result), mealType: manualMealType, imageId: result.imageId || undefined, photoTimestamp: manualLoggedAt.toISOString() },
      });
    } catch (e: any) {
      const msg = e?.data?.message || e?.data?.error || e?.error || e?.message || 'Unknown error';
      Alert.alert('Error', `Failed to analyze: ${msg}`);
    } finally {
      setAnalyzingManual(false);
    }
  };

  const handleSkipManual = () => {
    setManualModalVisible(false);
    setManualText('');
    setManualPhotos([]);
    setManualUsdaFoods([]);
    router.push({
      pathname: '/results',
      params: { 
        data: JSON.stringify({ items: [] }), 
        mealType: manualMealType, 
        photoTimestamp: manualLoggedAt.toISOString() 
      },
    });
  };

  /* ── Ask Mittens handler ── */

  const handleAskMittens = async (prompt: string): Promise<string> => {
    const res = await chatWithMittens(prompt).unwrap();
    return res.reply;
  };

  /* ── Open edit modal from meal ── */

  const openEditModal = (m: any, title: string) => {
    setEditItemId(m.id);
    setEditDisplayTitle(title);
    setEditItems(m.items || []);
    setEditImageUrl(m.imageUrl || null);
    setEditImageUrls(m.imageUrls || (m.imageUrl ? [m.imageUrl] : []));
    setEditMealType(m.mealType || 'snack');
    setEditLoggedAt(m.loggedAt ? new Date(m.loggedAt) : new Date());
    setEditFailureLogs(m.failure_logs || []);
    setEditItemText('');
    setEditModalVisible(true);
  };

  return {
    // Mutations exposed for inline use
    dislikeFoodMutation,
    addPantryItem,
    deletePantryItem,
    updatePantryItem,
    logActivity,
    reflectActivity,
    deleteActivity,
    logSleep,

    // Edit modal state + handlers
    editModalVisible, setEditModalVisible,
    editItemId, editItemText, editDisplayTitle, editItems,
    editImageUrl, editImageUrls, editMealType, editLoggedAt,
    editFailureLogs,
    savingEdit,
    setEditMealType, setEditLoggedAt, setEditItemText,
    handleEditItem, handleRemoveEditItem, handleDirectSave, handleEditSubmit, handleDeleteEntry,
    openEditModal,

    // Manual entry state + handlers
    manualModalVisible, setManualModalVisible,
    manualText, setManualText,
    manualPhotos, setManualPhotos,
    manualUsdaFoods, setManualUsdaFoods,
    analyzingManual, manualMealType, setManualMealType,
    manualLoggedAt, setManualLoggedAt,
    handleManualSubmit, handleSkipManual,

    // Other modal states
    sourcesModalVisible, setSourcesModalVisible,
    pastLogsVisible, setPastLogsVisible,
    pantryEditItem, setPantryEditItem,

    // Activity edit
    activityEditVisible, setActivityEditVisible,
    editingActivity, setEditingActivity,

    // Meal plan modals
    mealDetailModal, setMealDetailModal,
    groceryModalVisible, setGroceryModalVisible,
    projectionExpanded, setProjectionExpanded,
    hiddenGroceryItems, setHiddenGroceryItems,
    dislikedMealItems, setDislikedMealItems,

    // Ask Mittens
    handleAskMittens,
  };
}
