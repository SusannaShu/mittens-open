/**
 * Profile API -- user profile and pantry/fridge inventory.
 */

import { baseApi } from './baseApi';

export const profileApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** GET /nutrition-profile */
    getProfile: build.query<any, void>({
      query: () => '/nutrition-profile',
      providesTags: ['Profile'],
    }),

    /** PUT /nutrition-profile */
    updateProfile: build.mutation<any, any>({
      query: (data) => ({
        url: '/nutrition-profile',
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['Profile'],
    }),

    /** POST /nutrition-pantry/scan */
    scanFridge: build.mutation<{ pantry: any[]; nutrientGaps: any[]; grocerySuggestions: any[] }, string>({
      query: (image) => ({
        url: '/nutrition-pantry/scan',
        method: 'POST',
        body: { image },
      }),
      invalidatesTags: ['Pantry'],
    }),

    /** GET /nutrition-pantry */
    getPantry: build.query<{ pantry: any[] }, void>({
      query: () => '/nutrition-pantry',
      providesTags: ['Pantry'],
    }),

    /** GET /nutrition-pantry/grocery-list */
    getGroceryList: build.query<{ gaps: any[]; groceryList: any[] }, void>({
      query: () => '/nutrition-pantry/grocery-list',
    }),

    /** POST /nutrition-pantry/add */
    addPantryItem: build.mutation<any, { foodName: string; quantity?: string; freshness?: string }>({
      query: (data) => ({
        url: '/nutrition-pantry/add',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['Pantry'],
    }),

    /** DELETE /nutrition-pantry/:id */
    deletePantryItem: build.mutation<any, number>({
      query: (id) => ({
        url: `/nutrition-pantry/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Pantry'],
    }),

    /** PUT /nutrition-pantry/:id */
    updatePantryItem: build.mutation<any, { id: number; foodName?: string; quantity?: string; freshness?: string }>({
      query: ({ id, ...data }) => ({
        url: `/nutrition-pantry/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['Pantry'],
    }),
  }),
});

export const {
  useGetProfileQuery,
  useUpdateProfileMutation,
  useScanFridgeMutation,
  useGetPantryQuery,
  useGetGroceryListQuery,
  useAddPantryItemMutation,
  useDeletePantryItemMutation,
  useUpdatePantryItemMutation,
} = profileApi;
