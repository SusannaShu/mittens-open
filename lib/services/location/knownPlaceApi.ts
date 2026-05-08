/**
 * RTK Query API for known places (geofence targets).
 */

import { baseApi } from '../baseApi';

export interface KnownPlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  placeType: 'home' | 'work' | 'school' | 'gym' | 'social' | 'park' | 'other';
  icon?: string;
}

export const knownPlaceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getKnownPlaces: build.query<KnownPlace[], void>({
      query: () => '/known-places',
      providesTags: ['KnownPlace'],
    }),

    addKnownPlace: build.mutation<KnownPlace, Omit<KnownPlace, 'id'>>({
      query: (body) => ({ url: '/known-places', method: 'POST', body }),
      invalidatesTags: ['KnownPlace'],
    }),

    updateKnownPlace: build.mutation<KnownPlace, { id: number } & Partial<KnownPlace>>({
      query: ({ id, ...body }) => ({ url: `/known-places/${id}`, method: 'PUT', body }),
      invalidatesTags: ['KnownPlace'],
    }),

    deleteKnownPlace: build.mutation<{ status: string }, number>({
      query: (id) => ({ url: `/known-places/${id}`, method: 'DELETE' }),
      invalidatesTags: ['KnownPlace'],
    }),
  }),
});

export const {
  useGetKnownPlacesQuery,
  useAddKnownPlaceMutation,
  useUpdateKnownPlaceMutation,
  useDeleteKnownPlaceMutation,
} = knownPlaceApi;
