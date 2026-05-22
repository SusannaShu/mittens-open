/**
 * activityTypeApi.ts -- RTK Query endpoints for Activity Type CRUD.
 * Wraps ActivityTypeService (local SQLite) with tag-based cache invalidation.
 */

import { baseApi } from './baseApi';
import { ActivityTypeService } from './activityTypeService';
import type { ActivityTypeModel } from '../pipelines/types';

export const activityTypeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getActivityTypes: build.query<{ types: ActivityTypeModel[] }, void>({
      queryFn: async () => {
        try {
          const types = await ActivityTypeService.getAll();
          return { data: { types } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['ActivityTypes'],
    }),

    createActivityType: build.mutation<{ status: string }, Partial<ActivityTypeModel> & { key: string; label: string }>({
      queryFn: async (body) => {
        try {
          await ActivityTypeService.create(body);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['ActivityTypes'],
    }),

    updateActivityType: build.mutation<{ status: string }, { key: string; updates: Partial<ActivityTypeModel> }>({
      queryFn: async ({ key, updates }) => {
        try {
          await ActivityTypeService.update(key, updates);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['ActivityTypes'],
    }),

    deleteActivityType: build.mutation<{ status: string }, string>({
      queryFn: async (key) => {
        try {
          await ActivityTypeService.delete(key);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['ActivityTypes'],
    }),
  }),
});

export const {
  useGetActivityTypesQuery,
  useCreateActivityTypeMutation,
  useUpdateActivityTypeMutation,
  useDeleteActivityTypeMutation,
} = activityTypeApi;
