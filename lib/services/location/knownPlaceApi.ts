/**
 * RTK Query API for known places -- Local SQLite implementation.
 */

import { localApi } from '../localApi';
import { getDb } from '../../database';

export interface KnownPlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  placeType: 'home' | 'work' | 'school' | 'gym' | 'social' | 'park' | 'other';
  icon?: string;
}

export const knownPlaceApi = localApi.injectEndpoints({
  endpoints: (build) => ({
    getKnownPlaces: build.query<KnownPlace[], void>({
      queryFn: async () => {
        try {
          const db = getDb();
          const rows = db.getAllSync(`SELECT * FROM known_places`);
          return { data: rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            latitude: r.latitude,
            longitude: r.longitude,
            radius: r.radius_m,
            placeType: r.place_type,
            icon: r.icon
          }))};
        } catch(e) {
          return { error: { status: 500, data: String(e) } };
        }
      },
      providesTags: ['LocationLog'],
    }),

    addKnownPlace: build.mutation<KnownPlace, Omit<KnownPlace, 'id'>>({
      queryFn: async (args) => {
        const db = getDb();
        db.runSync(
          `INSERT INTO known_places (name, latitude, longitude, radius_m, place_type, icon) VALUES (?, ?, ?, ?, ?, ?)`,
          [args.name, args.latitude, args.longitude, args.radius, args.placeType, args.icon]
        );
        return { data: { ...args, id: -1 } as KnownPlace };
      },
      invalidatesTags: ['LocationLog'],
    }),

    updateKnownPlace: build.mutation<KnownPlace, { id: number } & Partial<KnownPlace>>({
      queryFn: async (args) => ({ data: args as KnownPlace }),
      invalidatesTags: ['LocationLog'],
    }),

    deleteKnownPlace: build.mutation<{ status: string }, number>({
      queryFn: async (id) => {
        getDb().runSync(`DELETE FROM known_places WHERE id = ?`, [id]);
        return { data: { status: 'deleted' } };
      },
      invalidatesTags: ['LocationLog'],
    }),
  }),
});

export const {
  useGetKnownPlacesQuery,
  useAddKnownPlaceMutation,
  useUpdateKnownPlaceMutation,
  useDeleteKnownPlaceMutation,
} = knownPlaceApi;
