import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useReflectActivityMutation,
  useDeleteActivityMutation,
  useLogActivityMutation,
  ActivityEntry,
} from '../lib/services/activityApi';
import {
  useUpdateEntryDirectMutation,
  useUpdateEntryMutation,
  useAnalyzeTextMutation,
  useSmartSnapAsyncMutation,
  useLazyCheckJobStatusQuery,
  useDeleteEntryMutation,
} from '../lib/services/nutritionApi';
import { useUpdateSleepLogMutation, useDeleteSleepLogMutation, useLogSleepMutation, SleepEntry } from '../lib/services/schedule/sleepApi';
import { useDeleteCalendarEventMutation, CalendarEvent as SyncedCalendarEvent } from '../lib/services/calendarEventApi';
import { PlannedBlock } from '../lib/services/schedule/plannedScheduleApi';
import { Meal } from '../lib/types';
import { CalendarEvent } from '../components/reflect/CalendarDayView';

export function useSyncHandlers(selectedDate: string, refetch: () => void) {
  const router = useRouter();

  // Mutations
  const [reflectActivity] = useReflectActivityMutation();
  const [deleteActivity] = useDeleteActivityMutation();
  const [logActivity] = useLogActivityMutation();
  const [updateEntryTime] = useUpdateEntryDirectMutation();
  const [updateEntryDirect] = useUpdateEntryDirectMutation();
  const [updateEntry] = useUpdateEntryMutation();
  const [analyzeText] = useAnalyzeTextMutation();
  const [smartSnapAsync] = useSmartSnapAsyncMutation();
  const [checkJobStatus] = useLazyCheckJobStatusQuery();
  const [deleteEntry] = useDeleteEntryMutation();
  const [updateSleepLog] = useUpdateSleepLogMutation();
  const [deleteSleepLog] = useDeleteSleepLogMutation();
  const [logSleep] = useLogSleepMutation();
  const [deleteCalendarEvent] = useDeleteCalendarEventMutation();

  // Activity modal state
  const [editingActivity, setEditingActivity] = useState<ActivityEntry | null>(null);
  const [activityEditVisible, setActivityEditVisible] = useState(false);
  const [isNewCalendarActivity, setIsNewCalendarActivity] = useState(false);

  // Meal edit modal state
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

  // Sleep edit modal state
  const [editingSleep, setEditingSleep] = useState<SleepEntry | null>(null);
  const [sleepEditVisible, setSleepEditVisible] = useState(false);

  // Manual entry modal (for adding new entries from Reflect)
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualLoggedAt, setManualLoggedAt] = useState(new Date());
  const [manualText, setManualText] = useState('');
  const [manualPhotos, setManualPhotos] = useState<string[]>([]);
  const [analyzingManual, setAnalyzingManual] = useState(false);
  const [manualMealType, setManualMealType] = useState('snack');

  const handleEditItem = (idx: number, key: string, value: string) => {
    const updated = [...editItems];
    const item = { ...updated[idx] };
    if (key === 'portion_g') {
      if (!item._originalPortionG) {
        item._originalPortionG = parseFloat(item.portion_g || item.portionG || '0') || 1;
        item._originalNutrients = { ...(item.nutrients || {}) };
      }
      const origG = item._originalPortionG;
      const newG = parseFloat(value) || 0;
      if (origG > 0 && newG > 0 && item._originalNutrients) {
        const ratio = newG / origG;
        const scaled: Record<string, number> = {};
        for (const [k, v] of Object.entries(item._originalNutrients)) {
          scaled[k] = Math.round(((v as number) * ratio) * 100) / 100;
        }
        item.nutrients = scaled;
      }
      item.portion_g = value;
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
      const changedItems = finalItems.filter((i: any) => i._nameChanged);
      if (changedItems.length > 0) {
        for (let i = 0; i < finalItems.length; i++) {
          const item = finalItems[i];
          if (!item._nameChanged) continue;
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
      refetch();
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
      refetch();
    } catch (e: any) {
      Alert.alert('Error', e.data?.message || 'Failed to update entry.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMealEntry = (id: number, name: string) => {
    Alert.alert('Delete Entry', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteEntry(id).unwrap();
        setEditModalVisible(false);
        refetch();
      }},
    ]);
  };

  const handleMealSubmit = async () => {
    if (!manualText.trim() && manualPhotos.length === 0) return;
    setAnalyzingManual(true);
    try {
      let result: any;
      if (manualPhotos.length > 0) {
        const { jobId } = await smartSnapAsync({ image: manualPhotos[0], extraImages: manualPhotos.slice(1) }).unwrap();
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
      if (manualText.trim() && result) {
        result = { ...result, mealName: result.mealName || manualText.trim() };
      }
      setManualModalVisible(false);
      setManualText('');
      setManualPhotos([]);
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

  const handleEdit = useCallback((evt: CalendarEvent) => {
    if (evt.type === 'activity') {
      setEditingActivity(evt.sourceData as ActivityEntry);
      setIsNewCalendarActivity(false);
      setActivityEditVisible(true);
    } else if (evt.type === 'meal') {
      const m = evt.sourceData as Meal;
      setEditItemId(m.id as number);
      setEditDisplayTitle(evt.title);
      setEditItems(m.items || []);
      setEditImageUrl(m.imageUrl || null);
      setEditImageUrls(m.imageUrls || (m.imageUrl ? [m.imageUrl] : []));
      setEditMealType(m.mealType || 'snack');
      setEditLoggedAt(m.loggedAt ? new Date(m.loggedAt) : new Date());
      setEditItemText('');
      setEditModalVisible(true);
    } else if (evt.type === 'calendar') {
      const cal = evt.sourceData as SyncedCalendarEvent;
      const startMs = new Date(cal.startTime).getTime();
      const endMs = cal.endTime ? new Date(cal.endTime).getTime() : startMs + 60 * 60 * 1000;
      const durationMin = Math.round((endMs - startMs) / 60000);

      const name = (cal.summary || '').toLowerCase();
      let actType = 'other';
      if (name.includes('walk')) actType = 'walk';
      else if (name.includes('bike') || name.includes('cycling') || name.includes('ride')) actType = 'bike';
      else if (name.includes('run') || name.includes('jog')) actType = 'run';
      else if (name.includes('gym') || name.includes('workout') || name.includes('exercise')) actType = 'workout';
      else if (name.includes('meet') || name.includes('coffee') || name.includes('dinner') || name.includes('lunch') || name.includes('hang')) actType = 'social';
      else if (name.includes('class') || name.includes('study') || name.includes('work') || /^d\d+/i.test(name)) actType = 'work';
      else if (name.includes('cook') || name.includes('bake') || name.includes('prep')) actType = 'cooking';
      else if (name.includes('commute') || name.includes('travel') || name.includes('train')) actType = 'commute';

      const syntheticActivity: ActivityEntry = {
        id: -1,
        loggedAt: cal.startTime,
        activityType: actType,
        logName: cal.summary || 'Calendar Event',
        duration_min: durationMin,
        location: cal.location || undefined,
        lifeCategories: null,
        aeiou: null,
        engagement: null,
        energy: null,
        intensity: 'moderate',
        outdoors: false,
        source: 'calendar',
        meta: { googleEventId: cal.googleEventId, syncedCalendarEventId: cal.id },
      };

      setEditingActivity(syntheticActivity);
      setIsNewCalendarActivity(true);
      setActivityEditVisible(true);
    } else if (evt.type === 'sleep') {
      const sl = evt.sourceData as SleepEntry;
      setEditingSleep(sl);
      setSleepEditVisible(true);
    } else if (evt.type === 'planned') {
      const pb = evt.sourceData as PlannedBlock;
      if (pb.blockType === 'wake' || pb.blockType === 'bedtime') {
        const h8 = 8 * 3600000;
        const plannedTime = new Date(pb.scheduledAt).getTime();
        const syntheticSleep: SleepEntry = {
          id: -1,
          sleepStart: pb.blockType === 'bedtime' ? new Date(plannedTime).toISOString() : new Date(plannedTime - h8).toISOString(),
          sleepEnd: pb.blockType === 'wake' ? new Date(plannedTime).toISOString() : new Date(plannedTime + h8).toISOString(),
          quality: 'good',
        };
        setEditingSleep(syntheticSleep);
        setSleepEditVisible(true);
      } else if (['breakfast', 'lunch', 'dinner'].includes(pb.blockType)) {
        setManualMealType(pb.blockType);
        setManualLoggedAt(new Date(pb.scheduledAt));
        setManualModalVisible(true);
      }
    }
  }, []);

  const handleTimeChange = useCallback(async (evt: CalendarEvent, newTime: Date) => {
    if (evt.type === 'activity') {
      await reflectActivity({ id: evt.id, loggedAt: newTime.toISOString() }).unwrap();
      refetch();
    } else if (evt.type === 'meal') {
      await updateEntryTime({ id: evt.id as number, loggedAt: newTime.toISOString() }).unwrap();
      refetch();
    }
  }, [reflectActivity, updateEntryTime, refetch]);

  return {
    // Activity
    editingActivity,
    setEditingActivity,
    activityEditVisible,
    setActivityEditVisible,
    isNewCalendarActivity,
    setIsNewCalendarActivity,
    logActivity,
    reflectActivity,
    deleteActivity,
    deleteCalendarEvent,
    
    // Meal
    editModalVisible,
    setEditModalVisible,
    editItemId,
    editItemText,
    setEditItemText,
    editDisplayTitle,
    editItems,
    editImageUrl,
    editImageUrls,
    editMealType,
    setEditMealType,
    editLoggedAt,
    setEditLoggedAt,
    savingEdit,
    handleEditItem,
    handleRemoveEditItem,
    handleDirectSave,
    handleEditSubmit,
    handleDeleteMealEntry,

    // Sleep
    editingSleep,
    setEditingSleep,
    sleepEditVisible,
    setSleepEditVisible,
    updateSleepLog,
    deleteSleepLog,
    logSleep,

    // Manual Entry
    manualModalVisible,
    setManualModalVisible,
    manualLoggedAt,
    setManualLoggedAt,
    manualText,
    setManualText,
    manualPhotos,
    setManualPhotos,
    analyzingManual,
    manualMealType,
    setManualMealType,
    handleMealSubmit,

    // UI Handlers
    handleEdit,
    handleTimeChange,
  };
}
