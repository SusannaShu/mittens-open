/**
 * knownPlaceApi.ts -- Local SQLite-backed known places (geofences).
 */

import { baseApi } from '../baseApi';
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

function rowToPlace(r: any): KnownPlace {
  return {
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    radius: r.radius_m || 100,
    placeType: r.place_type || 'other',
    icon: r.icon,
  };
}

export const knownPlaceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getKnownPlaces: build.query<KnownPlace[], void>({
      queryFn: () => {
        try {
          const db = getDb();
          const rows = db.getAllSync('SELECT * FROM known_places ORDER BY name ASC') as any[];
          return { data: rows.map(rowToPlace) };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['KnownPlace'],
    }),

    addKnownPlace: build.mutation<KnownPlace, Omit<KnownPlace, 'id'>>({
      queryFn: (body) => {
        try {
          const db = getDb();
          const result = db.runSync(
            'INSERT INTO known_places (name, latitude, longitude, radius_m, place_type, icon) VALUES (?, ?, ?, ?, ?, ?)',
            [body.name, body.latitude, body.longitude, body.radius || 100, body.placeType || 'other', body.icon || null]
          );
          const id = (result as any).lastInsertRowId || 0;
          return { data: { ...body, id } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['KnownPlace'],
    }),

    updateKnownPlace: build.mutation<KnownPlace, { id: number } & Partial<KnownPlace>>({
      queryFn: ({ id, ...body }) => {
        try {
          const db = getDb();
          const sets: string[] = [];
          const vals: any[] = [];
          if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
          if (body.latitude !== undefined) { sets.push('latitude = ?'); vals.push(body.latitude); }
          if (body.longitude !== undefined) { sets.push('longitude = ?'); vals.push(body.longitude); }
          if (body.radius !== undefined) { sets.push('radius_m = ?'); vals.push(body.radius); }
          if (body.placeType !== undefined) { sets.push('place_type = ?'); vals.push(body.placeType); }
          if (body.icon !== undefined) { sets.push('icon = ?'); vals.push(body.icon); }
          if (sets.length > 0) {
            vals.push(id);
            db.runSync(`UPDATE known_places SET ${sets.join(', ')} WHERE id = ?`, vals);
          }
          const row = db.getFirstSync('SELECT * FROM known_places WHERE id = ?', [id]);
          return { data: row ? rowToPlace(row) : { id, ...body } as any };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['KnownPlace'],
    }),

    deleteKnownPlace: build.mutation<{ status: string }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          db.runSync('DELETE FROM known_places WHERE id = ?', [id]);
          return { data: { status: 'ok' } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
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
