/**
 * Mittens Messages API -- persistent chat history.
 */

import { baseApi } from './baseApi';

interface SavedMessage {
  role: 'user' | 'mittens';
  text: string;
  photos?: number[] | string[];
  activityType?: string;
  metadata?: any;
}

export const messagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** GET /mittens-messages */
    getMessages: build.query<{ messages: any[]; total: number }, { limit?: number; start?: number; since?: string }>({
      query: ({ limit = 100, start = 0, since } = {}) => {
        let url = `/mittens-messages?_limit=${limit}&_start=${start}&_sort=created_at:DESC`;
        if (since) url += `&created_at_gte=${since}`;
        return url;
      },
      providesTags: ['Messages'],
    }),

    /** POST /mittens-messages/batch */
    saveMessageBatch: build.mutation<{ saved: number }, SavedMessage[]>({
      query: (messages) => ({
        url: '/mittens-messages/batch',
        method: 'POST',
        body: { messages },
      }),
      invalidatesTags: ['Messages'],
    }),

    /** POST /mittens-messages (single) */
    saveMessage: build.mutation<{ id: number }, SavedMessage>({
      query: (msg) => ({
        url: '/mittens-messages',
        method: 'POST',
        body: msg,
      }),
    }),

    /** DELETE /mittens-messages/clear */
    clearMessages: build.mutation<{ cleared: number }, void>({
      query: () => ({
        url: '/mittens-messages/clear',
        method: 'DELETE',
      }),
      invalidatesTags: ['Messages'],
    }),

    /** DELETE /mittens-messages/since/:id -- delete message + everything after + associated logs */
    deleteMessagesSince: build.mutation<
      { deleted: number; nutritionLogsDeleted: number; activityLogsDeleted: number },
      number
    >({
      query: (id) => ({
        url: `/mittens-messages/since/${id}`,
        method: 'DELETE',
      }),
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
