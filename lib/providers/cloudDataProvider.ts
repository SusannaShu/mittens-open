/**
 * CloudDataProvider -- wraps existing Backend API / RTK Query calls
 * to conform to the DataProvider interface.
 *
 * No behavior change -- purely structural wrapper around existing functions.
 */

import { DataProvider, MealInput, DailySummaryResult, SyncManifest } from './dataProvider';
import { MealEntry } from '../types';
import {
  getDailySummary as apiGetDailySummary,
  loadMessages,
  saveMessage as apiSaveMessage,
  saveMessageBatch as apiSaveMessageBatch,
  logConfirmed,
  updateEntryDirect,
  deleteEntry,
  getProfile,
  updateProfile,
} from '../api';

export class CloudDataProvider implements DataProvider {
  // ─── Messages ───

  async loadMessages(limit = 100, start = 0): Promise<{ messages: any[]; total: number }> {
    return loadMessages(limit, start);
  }

  async saveMessage(msg: { role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }): Promise<{ id: number }> {
    return apiSaveMessage(msg);
  }

  async saveMessageBatch(messages: Array<{ role: 'user' | 'mittens'; text: string; photos?: string[]; activityType?: string; metadata?: any }>): Promise<{ saved: number }> {
    return apiSaveMessageBatch(messages);
  }

  // ─── Nutrition ───

  async logMeal(meal: MealInput): Promise<{ id: number }> {
    const result: any = await logConfirmed(meal.logName, meal.items, meal.mealType, meal.imageId);
    return { id: result?.ids?.[0] || 0 };
  }

  async getMeal(id: number): Promise<MealEntry> {
    // Direct fetch for single meal
    const { getApiBase, getAuthToken } = require('../api');
    const base = getApiBase();
    const token = getAuthToken();
    const res = await fetch(`${base}/nutrition-logs/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Meal not found');
    return res.json();
  }

  async updateMeal(id: number, updates: Partial<MealEntry>): Promise<void> {
    if (updates.items) {
      await updateEntryDirect(id, updates.items, updates.logName);
    }
  }

  async deleteMeal(id: number): Promise<void> {
    await deleteEntry(id);
  }

  async getDailyMeals(date: string): Promise<MealEntry[]> {
    const summary = await apiGetDailySummary(date);
    return summary.meals || [];
  }

  async getDailySummary(date: string): Promise<DailySummaryResult> {
    const data = await apiGetDailySummary(date);
    return {
      date,
      meals: data.meals || [],
      totals: data.totals || {},
      gaps: data.gaps || [],
      recommendations: data.recommendations || [],
    };
  }

  // ─── Sync (no-op for cloud, already synced) ───

  async getUnsyncedRecords(): Promise<SyncManifest[]> {
    return [];
  }

  async markSynced(_table: string, _ids: number[]): Promise<void> {
    // No-op: cloud is always synced
  }
}
