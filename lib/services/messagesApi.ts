/**
 * messagesApi.ts -- Local SQLite-backed chat message API.
 */

import { baseApi } from './baseApi';
import { getDb } from '../database';

interface SavedMessage {
  role: 'user' | 'mittens';
  text: string;
  photos?: number[] | string[];
  activityType?: string;
  metadata?: any;
}

export const messagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMessages: build.query<{ messages: any[]; total: number }, { limit?: number; start?: number; since?: string } | void>({
      queryFn: (params) => {
        try {
          const db = getDb();
          const limit = (params && 'limit' in params) ? params.limit || 100 : 100;
          const start = (params && 'start' in params) ? params.start || 0 : 0;
          const rows = db.getAllSync(
            'SELECT * FROM mittens_messages ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, start]
          ) as any[];
          const countRow = db.getFirstSync('SELECT COUNT(*) as c FROM mittens_messages') as any;
          return {
            data: {
              messages: rows.map((r: any) => ({
                id: r.id,
                role: r.role,
                text: r.text,
                photos: r.photos ? JSON.parse(r.photos) : undefined,
                activityType: r.activity_type,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
                created_at: r.created_at,
              })),
              total: countRow?.c || 0,
            },
          };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      providesTags: ['Messages'],
    }),

    saveMessageBatch: build.mutation<{ saved: number }, SavedMessage[]>({
      queryFn: (messages) => {
        try {
          const db = getDb();
          let count = 0;
          for (const msg of messages) {
            db.runSync(
              'INSERT INTO mittens_messages (role, text, photos, activity_type, metadata) VALUES (?, ?, ?, ?, ?)',
              [
                msg.role,
                msg.text,
                msg.photos ? JSON.stringify(msg.photos) : null,
                msg.activityType || null,
                msg.metadata ? JSON.stringify(msg.metadata) : null,
              ]
            );
            count++;
          }
          return { data: { saved: count } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Messages'],
    }),

    saveMessage: build.mutation<{ id: number }, SavedMessage>({
      queryFn: (msg) => {
        try {
          const db = getDb();
          const result = db.runSync(
            'INSERT INTO mittens_messages (role, text, photos, activity_type, metadata) VALUES (?, ?, ?, ?, ?)',
            [
              msg.role,
              msg.text,
              msg.photos ? JSON.stringify(msg.photos) : null,
              msg.activityType || null,
              msg.metadata ? JSON.stringify(msg.metadata) : null,
            ]
          );
          return { data: { id: (result as any).lastInsertRowId || 0 } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
    }),

    clearMessages: build.mutation<{ cleared: number }, void>({
      queryFn: () => {
        try {
          const db = getDb();
          const countRow = db.getFirstSync('SELECT COUNT(*) as c FROM mittens_messages') as any;
          db.runSync('DELETE FROM mittens_messages');
          return { data: { cleared: countRow?.c || 0 } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Messages'],
    }),

    deleteMessagesSince: build.mutation<{ deleted: number; nutritionLogsDeleted: number; activityLogsDeleted: number }, number>({
      queryFn: (id) => {
        try {
          const db = getDb();
          const countRow = db.getFirstSync('SELECT COUNT(*) as c FROM mittens_messages WHERE id >= ?', [id]) as any;
          db.runSync('DELETE FROM mittens_messages WHERE id >= ?', [id]);
          return { data: { deleted: countRow?.c || 0, nutritionLogsDeleted: 0, activityLogsDeleted: 0 } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } };
        }
      },
      invalidatesTags: ['Messages', 'DailySummary'],
    }),
  }),
});

export const {
  useGetMessagesQuery,
  useSaveMessageBatchMutation,
  useSaveMessageMutation,
  useClearMessagesMutation,
  useDeleteMessagesSinceMutation,
} = messagesApi;
