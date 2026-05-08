import { ManualEntryType } from './types';

/* ───────────── Entry Type Tab Config ───────────── */

export const ENTRY_TABS: { key: ManualEntryType; label: string; icon: string }[] = [
  { key: 'meal', label: 'Meal', icon: 'coffee' },
  { key: 'activity', label: 'Activity', icon: 'activity' },
  { key: 'sleep', label: 'Sleep', icon: 'moon' },
];

/* ───────────── Activity ───────────── */

export const ACTIVITY_TYPES = ['walk', 'workout', 'run', 'bike', 'sun', 'work', 'social', 'rest', 'cooking', 'commute', 'other'];

export const COVERAGE_PRESETS = [
  { value: 10, label: 'Face' },
  { value: 25, label: '+Arms' },
  { value: 50, label: '+Legs' },
  { value: 75, label: 'Swim' },
  { value: 90, label: 'Full' },
];

/* ───────────── Sleep ───────────── */

export const SLEEP_QUALITIES: { key: string; label: string }[] = [
  { key: 'poor', label: 'Poor' },
  { key: 'fair', label: 'Fair' },
  { key: 'good', label: 'Good' },
  { key: 'great', label: 'Great' },
];

export const SLEEP_TEMP_PILLS = [
  { key: 'too_hot', label: 'Too hot' },
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'too_cold', label: 'Too cold' },
];

export const SLEEP_LIGHT_PILLS = [
  { key: 'dark', label: 'Dark' },
  { key: 'some_light', label: 'Some light' },
  { key: 'bright', label: 'Bright' },
];

export const SLEEP_NOISE_PILLS = [
  { key: 'quiet', label: 'Quiet' },
  { key: 'some_noise', label: 'Some noise' },
  { key: 'loud', label: 'Loud' },
];

export const SLEEP_SCREEN_PILLS = [
  { key: 'none', label: 'None' },
  { key: 'under_30', label: '<30min' },
  { key: 'over_30', label: '30min+' },
];

export const SLEEP_CAFFEINE_PILLS = [
  { key: 'none', label: 'None' },
  { key: 'before_2pm', label: 'Before 2pm' },
  { key: 'after_2pm', label: 'After 2pm' },
];

/* ───────────── Meal Eating Context ───────────── */

export const MEAL_PACE_PILLS = [
  { key: 'rushed', label: 'Rushed' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'slow', label: 'Slow' },
];

export const MEAL_CHEWING_PILLS = [
  { key: 'minimal', label: 'Minimal' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'thorough', label: 'Thorough' },
];

export const MEAL_DISTRACTION_PILLS = [
  { key: 'focused', label: 'Focused' },
  { key: 'some', label: 'Some' },
  { key: 'distracted', label: 'Distracted' },
];

export const MEAL_STRESS_PILLS = [
  { key: 'calm', label: 'Calm' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'stressed', label: 'Stressed' },
];

export const MEAL_SOCIAL_PILLS = [
  { key: 'alone', label: 'Alone' },
  { key: 'with_others', label: 'With others' },
];
