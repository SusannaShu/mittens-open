import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useGetDailySummaryQuery, useGetTodayMealPlanQuery, useGenerateMealPlanAsyncMutation, useLazyCheckMealPlanJobStatusQuery } from '../../lib/services/nutritionApi';
import { nutritionApi } from '../../lib/services/nutritionApi';
import { useGetProfileQuery } from '../../lib/services/profileApi';
import { colors, spacing } from '../../lib/theme';
import { getUserDisplayName } from '../../lib/userContext';
import { todayStyles as styles } from '../../styles/todayStyles';
import { useTodayHandlers } from '../../hooks/useTodayHandlers';
import { useDispatch } from 'react-redux';
import { baseApi } from '../../lib/services/baseApi';
import { Feather } from '@expo/vector-icons';
import { fetchWeather } from '../../lib/services/schedule/alarmScheduler';

// Section components
import LifeBalanceSection from '../../components/today/sections/LifeBalanceSection';
import ActivityTimerSection from '../../components/today/sections/ActivityTimerSection';
import { useFocusTimer } from '../../hooks/useFocusTimer';
import MetabolicStoryCard from '../../components/today/sections/MetabolicStoryCard';
import LoggedTodaySection from '../../components/today/sections/LoggedTodaySection';
import NutrientStatusSection from '../../components/today/sections/NutrientStatusSection';
import MealPlanSection from '../../components/today/sections/MealPlanSection';
import PantrySection from '../../components/today/sections/PantrySection';

// Modal components
import { EditModal, SourcesModal } from '../../components/today/TodayModals';
import { ManualEntryModal } from '../../components/today/ManualEntryModal';
import PastLogsModal from '../../components/today/PastLogsModal';
import PantryEditModal from '../../components/today/PantryEditModal';
import ActivityEditModal from '../../components/common/ActivityEditModal';
import { MealDetailModal, GroceryListModal, ProjectedNutrientsModal } from '../../components/today/MealPlanModals';

// API hooks
import { useGetDashboardGaugesQuery, useGetDailyActivitiesQuery, ActivityEntry } from '../../lib/services/activityApi';
import { HealthPillarService, PillarScore } from '../../lib/services/healthPillarService';

const cleanFoodName = (name: string): string => {
  if (!name) return name;
  let cleaned = name.trim();
  const pattern = /^([\d\.\/]+(-[\d\.\/]+)?\s*)?((cups?|oz|ounces?|tbsp|tsp|tablespoons?|teaspoons?|medium|large|small|slices?|pieces?|grams?|g|ml|lbs?|pounds?)\s+)?((cooked|steamed|baked|raw|boiled|roasted|fried|grilled|chopped|diced|sliced)\s+)?/i;
  cleaned = cleaned.replace(pattern, '').trim();
  if (!cleaned) return name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export default function TodayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ openManual?: string }>();
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();

  // RTK Query hooks
  const { data, isLoading, isFetching, refetch } = useGetDailySummaryQuery();
  const { data: profile } = useGetProfileQuery();
  const { data: dashboardData } = useGetDashboardGaugesQuery();
  const { data: activityData } = useGetDailyActivitiesQuery();
  const { data: mealPlanData } = useGetTodayMealPlanQuery();
  const todayActivities: ActivityEntry[] = activityData?.activities || [];
  const rawMealPlan = mealPlanData?.plan || null;
  const gapCoverage = rawMealPlan?.gapCoverage || null;


  // Async meal plan generation + polling
  const [generateMealPlanAsync] = useGenerateMealPlanAsyncMutation();
  const [checkStatus] = useLazyCheckMealPlanJobStatusQuery();
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoGenTriggeredRef = useRef(false);

  // Weather state
  const [weatherData, setWeatherData] = useState<{ temp: number; description: string; uv: number } | null>(null);

  // All handlers + modal state from custom hook
  const h = useTodayHandlers(refetch);
  
  // Handle openManual URL parameter
  const [initialManualTab, setInitialManualTab] = useState<any>('meal');
  useEffect(() => {
    if (params.openManual) {
      setInitialManualTab(params.openManual);
      h.setManualModalVisible(true);
      router.setParams({ openManual: undefined });
    }
  }, [params.openManual]);

  // Filter out disliked items from meal plan
  const mealPlan = useMemo(() => {
    if (!rawMealPlan) return null;
    const clone = JSON.parse(JSON.stringify(rawMealPlan));
    ['breakfast', 'lunch', 'dinner'].forEach(k => {
      if (clone[k] && clone[k].items) {
        // filter by raw food strings to match what's in the arrays
        clone[k].items = clone[k].items.filter((item: string) => !h.dislikedMealItems.includes(item));
      }
    });
    return clone;
  }, [rawMealPlan, h.dislikedMealItems]);

  // Section collapse state
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({ pantry: false, stores: true, metabolic: true, today: true });
  const [expandedGauge, setExpandedGauge] = useState<string | null>(null);
  const toggle = (key: string) => setSectionCollapsed(p => ({ ...p, [key]: !p[key] }));

  // Local health pillar computation (fallback when cloud doesn't provide)
  const [localPillars, setLocalPillars] = useState<PillarScore[] | null>(null);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    HealthPillarService.computeForDate(today)
      .then(setLocalPillars)
      .catch(() => {});
  }, [todayActivities.length]);

  // Activity Timer -- auto-logs when stopped
  const profileIntervalMins = profile?.workIntervalMins || 45;
  const [breakIntervalMins, setBreakIntervalMins] = useState(profileIntervalMins);
  const activityTimer = useFocusTimer(breakIntervalMins, {
    onStart: () => {
      refetch();
      dispatch(baseApi.util.invalidateTags(['DailySummary', 'UnifiedCalendar']));
    },
    onComplete: () => {
      refetch();
      dispatch(baseApi.util.invalidateTags(['DailySummary', 'UnifiedCalendar']));
    },
  });

  // Auto-generate meal plan via async polling (mirrors VTO pattern)
  const triggerMealPlanRegeneration = () => {
    if (isGeneratingPlan) return;
    setIsGeneratingPlan(true);

    generateMealPlanAsync().unwrap().then((res) => {
      if (!res.jobId) {
        setIsGeneratingPlan(false);
        return;
      }

      // Poll for result every 3s
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await checkStatus(res.jobId, false).unwrap();

          if (statusRes.status === 'completed') {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setIsGeneratingPlan(false);
            // Invalidate MealPlan tag to refetch via RTK Query
            dispatch(nutritionApi.util.invalidateTags(['MealPlan']));
          } else if (statusRes.status === 'failed') {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            setIsGeneratingPlan(false);
          }
        } catch {
          // Keep polling on transient errors
        }
      }, 3000);
    }).catch(() => {
      setIsGeneratingPlan(false);
    });
  };

  const regenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRegeneratePlan = () => {
    if (regenTimeoutRef.current) clearTimeout(regenTimeoutRef.current);
    regenTimeoutRef.current = setTimeout(() => {
      triggerMealPlanRegeneration();
    }, 1500);
  };

  useEffect(() => {
    if (mealPlanData?.plan) {
      autoGenTriggeredRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsGeneratingPlan(false);
    }
  }, [mealPlanData]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Redirect to onboarding if not completed
  useEffect(() => {
    if (profile && profile.onboarded === false) router.replace('/onboarding');
  }, [profile]);

  // Fetch weather
  useEffect(() => {
    async function loadWeather() {
      if (profile && profile.homeLatitude !== null && profile.homeLongitude !== null) {
        const w = await fetchWeather(profile.homeLatitude, profile.homeLongitude);
        if (w) setWeatherData(w);
      }
    }
    loadWeather();
  }, [profile?.homeLatitude, profile?.homeLongitude]);

  /* ── Render ── */

  if (isLoading && !data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const profileName = profile?.name || getUserDisplayName();
  const gaps = data?.gaps || [];
  const meals = data?.meals || [];
  const recs = data?.recommendations || [];
  const pantry = data?.pantry || [];
  const storedSources = data?.storedSources || {};
  const metabolicStory = data?.metabolicStory || null;
  const activitySummary = data?.activitySummary || null;
  const hr = new Date().getHours();
  const greeting = `${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}, ${profileName}`;
  const now = new Date();

  return (
    <View style={[styles.fullContainer, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {/* Greeting Row */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={styles.greeting}>{greeting}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Text style={styles.date}>
                {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
              {weatherData && (
                <>
                  <View style={{ width: 1, height: 12, backgroundColor: colors.border }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: 0.7 }}>
                    <Feather name={weatherData.uv > 5 ? 'sun' : weatherData.description.toLowerCase().includes('cloud') ? 'cloud' : weatherData.description.toLowerCase().includes('rain') ? 'cloud-rain' : 'wind'} size={12} color={colors.textSecondary} />
                    <Text style={{ fontSize: 13, color: colors.textSecondary }}>{weatherData.temp}° · UV {weatherData.uv}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
          <TouchableOpacity style={styles.headAddBtn} onPress={() => h.setManualModalVisible(true)}>
            <Text style={styles.headAddBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <ActivityTimerSection
          collapsed={!!sectionCollapsed.timer}
          onToggle={() => toggle('timer')}
          isRunning={activityTimer.isRunning}
          timeLeft={activityTimer.timeLeft}
          category={activityTimer.category}
          activityName={activityTimer.activityName}
          startedAt={activityTimer.startedAt}
          getElapsed={activityTimer.getElapsed}
          onStart={activityTimer.startTimer}
          onStop={activityTimer.clearTimer}
          onCategoryChange={activityTimer.setCategory}
          onNameChange={activityTimer.setActivityName}
          breakIntervalMins={breakIntervalMins}
          onBreakIntervalChange={setBreakIntervalMins}
          dynamicCategories={activityTimer.dynamicCategories}
        />

        <LifeBalanceSection
          collapsed={!!sectionCollapsed.dashboard}
          onToggle={() => toggle('dashboard')}
          dashboardGauges={dashboardData?.gauges || null}
          dashboardBreakdown={dashboardData?.breakdown || null}
          healthPillars={dashboardData?.healthPillars || localPillars}
          pillarContributors={dashboardData?.pillarContributors}
          expandedGauge={expandedGauge}
          onExpandGauge={setExpandedGauge}
          todayActivities={todayActivities}
          onEditActivity={(act) => { h.setEditingActivity(act); h.setActivityEditVisible(true); }}
          onAskMittens={h.handleAskMittens}
        />

        {metabolicStory && (
          <MetabolicStoryCard
            metabolicStory={metabolicStory}
            activitySummary={activitySummary}
            collapsed={!!sectionCollapsed.metabolic}
            onToggle={() => toggle('metabolic')}
          />
        )}

        <LoggedTodaySection
          meals={meals}
          todayActivities={todayActivities}
          collapsed={!!sectionCollapsed.logged}
          onToggle={() => toggle('logged')}
          onEditMeal={(m, title) => h.openEditModal(m, title)}
          onEditActivity={(act) => { h.setEditingActivity(act); h.setActivityEditVisible(true); }}
        />

        <NutrientStatusSection
          gaps={gaps}
          meals={meals}
          pantry={pantry}
          storedSources={storedSources}
          collapsed={!!sectionCollapsed.today}
          onToggle={() => toggle('today')}
          onRefetch={refetch}
        />

        <MealPlanSection
          mealPlan={mealPlan}
          gapCoverage={gapCoverage}
          isGeneratingPlan={isGeneratingPlan}
          collapsed={!!sectionCollapsed.mealPlan}
          onToggle={() => toggle('mealPlan')}
          onOpenMealDetail={h.setMealDetailModal}
          onOpenGrocery={() => h.setGroceryModalVisible(true)}
          onOpenProjection={() => h.setProjectionExpanded(true)}
          onGenerate={triggerMealPlanRegeneration}
        />

        <PantrySection
          pantry={pantry}
          collapsed={!!sectionCollapsed.pantry}
          onToggle={() => toggle('pantry')}
          onAddItem={(food) => {
            h.addPantryItem({ foodName: food }).then(() => {
              refetch();
              debouncedRegeneratePlan();
            });
          }}
          onEditItem={h.setPantryEditItem}
        />

        {/* Empty state */}
        {meals.length === 0 && gaps.length === 0 && !isLoading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptyText}>
              Snap a photo of your meal to start tracking vitamins and minerals
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modals */}
      <EditModal
        visible={h.editModalVisible}
        onClose={() => h.setEditModalVisible(false)}
        imageUrl={h.editImageUrl}
        imageUrls={h.editImageUrls}
        mealType={h.editMealType}
        items={h.editItems}
        itemText={h.editItemText}
        savingEdit={h.savingEdit}
        displayTitle={h.editDisplayTitle}
        itemId={h.editItemId}
        loggedAt={h.editLoggedAt}
        failureLogs={h.editFailureLogs}
        onLoggedAtChange={h.setEditLoggedAt}
        onMealTypeChange={h.setEditMealType}
        onItemChange={h.handleEditItem}
        onRemoveItem={h.handleRemoveEditItem}
        onItemTextChange={h.setEditItemText}
        onDirectSave={h.handleDirectSave}
        onAIUpdate={h.handleEditSubmit}
        onDelete={() => {
          if (h.editItemId) {
            h.setEditModalVisible(false);
            h.handleDeleteEntry(h.editItemId, h.editDisplayTitle);
          }
        }}
      />

      <ManualEntryModal
        visible={h.manualModalVisible}
        onClose={() => { h.setManualModalVisible(false); h.setManualPhotos([]); }}
        initialTab={initialManualTab}
        loggedAt={h.manualLoggedAt}
        onLoggedAtChange={h.setManualLoggedAt}
        text={h.manualText}
        onTextChange={h.setManualText}
        photos={h.manualPhotos}
        onPhotosChange={h.setManualPhotos}
        mealType={h.manualMealType}
        onMealTypeChange={h.setManualMealType}
        analyzing={h.analyzingManual}
        onSubmit={h.handleManualSubmit}
        onActivitySubmit={async (data) => {
          await h.logActivity({ ...data, loggedAt: data.loggedAt || new Date().toISOString() }).unwrap();
          refetch();
        }}
        onSleepSubmit={async (data) => {
          await h.logSleep(data).unwrap();
          refetch();
        }}
      />

      <SourcesModal
        visible={h.sourcesModalVisible}
        onClose={() => h.setSourcesModalVisible(false)}
        gaps={gaps}
        recs={recs}
        pantry={pantry}
        onAskMittens={h.handleAskMittens}
        onDislike={(food, reason) => {
          h.setDislikedMealItems(prev => [...prev, food]);
          h.dislikeFoodMutation({ food: cleanFoodName(food), reason }).then(() => {
            debouncedRegeneratePlan();
          });
        }}
        onAddToPantry={(food) => {
          h.setHiddenGroceryItems(prev => [...prev, food]);
          h.addPantryItem({ foodName: cleanFoodName(food) }).then(() => {
            refetch();
            debouncedRegeneratePlan();
          });
        }}
      />

      <PastLogsModal
        visible={h.pastLogsVisible}
        onClose={() => h.setPastLogsVisible(false)}
        onEditMeal={(meal) => {
          h.setPastLogsVisible(false);
          setTimeout(() => h.openEditModal(meal, meal.logName), 350);
        }}
      />

      <PantryEditModal
        visible={!!h.pantryEditItem}
        onClose={() => h.setPantryEditItem(null)}
        item={h.pantryEditItem}
        onSave={(id, data) => {
          h.updatePantryItem({ id, ...data }).then(() => {
            h.setPantryEditItem(null);
            refetch();
            debouncedRegeneratePlan();
          });
        }}
        onDelete={(id) => {
          h.deletePantryItem(id).then(() => {
            h.setPantryEditItem(null);
            refetch();
            debouncedRegeneratePlan();
          });
        }}
      />

      <MealDetailModal
        visible={!!h.mealDetailModal}
        onClose={() => h.setMealDetailModal(null)}
        mealDetailData={h.mealDetailModal}
        gapCoverage={gapCoverage}
        mealPlan={mealPlan}
      />

      <GroceryListModal
        visible={h.groceryModalVisible}
        onClose={() => h.setGroceryModalVisible(false)}
        groceryList={(mealPlan?.groceryList || []).filter((item: any) => !h.hiddenGroceryItems.includes(item.food))}
        onAddToPantry={(food) => {
          h.setHiddenGroceryItems(prev => [...prev, food]);
          h.addPantryItem({ foodName: cleanFoodName(food) }).then(() => {
            refetch();
            debouncedRegeneratePlan();
          });
        }}
        onDislike={(food) => {
          h.setHiddenGroceryItems(prev => [...prev, food]);
          h.setDislikedMealItems(prev => [...prev, food]);
          h.dislikeFoodMutation({ food: cleanFoodName(food) }).then(() => {
            refetch();
            debouncedRegeneratePlan();
          });
        }}
      />

      <ProjectedNutrientsModal
        visible={h.projectionExpanded}
        onClose={() => h.setProjectionExpanded(false)}
        gapCoverage={gapCoverage}
        mealPlan={mealPlan}
      />

      <ActivityEditModal
        visible={h.activityEditVisible}
        activity={h.editingActivity}
        onClose={() => { h.setActivityEditVisible(false); h.setEditingActivity(null); }}
        onSave={async (id, data) => {
          await h.reflectActivity({ id, ...data }).unwrap();
          refetch();
        }}
        onDelete={async (id) => {
          await h.deleteActivity(id).unwrap();
          refetch();
        }}
      />
    </View>
  );
}
