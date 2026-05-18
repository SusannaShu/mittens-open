/**
 * DataProvider interface -- abstraction over data persistence.
 *
 * Two implementations:
 * - CloudDataProvider: wraps existing RTK Query / Backend REST calls
 * - LocalDataProvider: SQLite via expo-sqlite
 */

import { MealEntry, NutrientValues, NutrientGap, FoodRecommendation } from '../types';

export interface MealInput {
  logName: string;
  mealType: string;
  items: any[];
  source: 'vision' | 'manual';
  imageId?: number;
  loggedAt?: string;
}

export interface DailySummaryResult {
  date: string;
  meals: MealEntry[];
  totals: NutrientValues;
  gaps: NutrientGap[];
  recommendations: FoodRecommendation[];
}

export interface SyncManifest {
  table: string;
  ids: number[];
  lastSyncedAt: string | null;
}

export interface DataProvider {
  // Messages
  loadMessages(limit?: number, start?: number): Promise<{ messages: any[]; total: number }>;
  saveMessage(msg: { role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }): Promise<{ id: number }>;
  saveMessageBatch?(messages: Array<{ role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }>): Promise<{ saved: number }>;
  deleteMessagesSince?(id: number): Promise<void>;
  getRecentMessages?(limit: number): Promise<any[]>;
  updateMessage?(id: number, updates: { metadata?: any }): Promise<void>;

  // Nutrition
  logMeal(meal: MealInput): Promise<{ id: number }>;
  getMeal(id: number): Promise<MealEntry>;
  updateMeal(id: number, updates: Partial<MealEntry>): Promise<void>;
  deleteMeal(id: number): Promise<void>;
  getDailyMeals(date: string): Promise<MealEntry[]>;
  getDailySummary(date: string): Promise<DailySummaryResult>;

  // Activities
  logActivity?(data: any): Promise<{ id: number }>;
  updateActivity?(id: number, data: any): Promise<void>;
  deleteActivity?(id: number): Promise<void>;
  getDailyActivities?(date: string): Promise<any[]>;

  // Sleep
  logSleep?(data: any): Promise<{ id: number }>;
  updateSleep?(id: number, data: any): Promise<void>;
  deleteSleep?(id: number): Promise<void>;

  // Profile
  getProfile?(): Promise<any>;
  updateProfile?(updates: any): Promise<void>;

  // Sync (local -> cloud)
  getUnsyncedRecords?(): Promise<SyncManifest[]>;
  markSynced?(table: string, ids: number[]): Promise<void>;
}
