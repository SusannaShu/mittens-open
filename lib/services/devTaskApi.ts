/**
 * Dev Task API -- notes submission, task management, queue status.
 * Handles all /dev-task/* endpoints.
 */

import { baseApi } from './baseApi';

export interface DevTask {
  id: number;
  documentId: string;
  type: 'bug' | 'feature' | 'improvement' | 'question';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'needs_review' | 'queued_credits' | 'approved' | 'rejected';
  description: string;
  project: string | null;
  priority: 'high' | 'medium' | 'low';
  prompt: string | null;
  model: string | null;
  tier: string | null;
  error: string | null;
  items: any[];
  retry_count: number;
  analysis: {
    pros: string[];
    cons: string[];
    approach: string;
    scope: string;
    recommendation: string;
    rawText?: string;
  } | null;
  git_branch: string | null;
  git_commit: string | null;
  createdAt: string;
}

export interface QueueStatus {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  needsReview: number;
  queuedCredits: number;
  approved: number;
  rejected: number;
}

export interface SubmitNotesResponse {
  ok: boolean;
  parsed: number;
  tasks: Array<{
    id: number;
    documentId: string;
    type: string;
    status: string;
    description: string;
    project: string | null;
    priority: string;
    model: string | null;
  }>;
}

export const devTaskApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /** POST /dev-task/notes -- submit raw notes for parsing and triage */
    submitNotes: build.mutation<SubmitNotesResponse, { text: string }>({
      query: ({ text }) => ({
        url: '/api/dev-task/notes',
        method: 'POST',
        body: { text },
      }),
      invalidatesTags: ['DevTask', 'QueueStatus'],
    }),

    /** GET /dev-task/tasks -- list all dev tasks */
    getDevTasks: build.query<DevTask[], { status?: string } | void>({
      query: (params) => {
        const statusParam = params && 'status' in params ? `?status=${params.status}` : '';
        return `/api/dev-task/tasks${statusParam}`;
      },
      providesTags: ['DevTask'],
    }),

    /** GET /dev-task/queue/status -- aggregate queue counts */
    getQueueStatus: build.query<QueueStatus, void>({
      query: () => '/api/dev-task/queue/status',
      providesTags: ['QueueStatus'],
    }),

    /** POST /dev-task/:id/approve -- approve a feature proposal */
    approveDevTask: build.mutation<{ ok: boolean; task: DevTask }, string>({
      query: (documentId) => ({
        url: `/api/dev-task/${documentId}/approve`,
        method: 'POST',
      }),
      invalidatesTags: ['DevTask', 'QueueStatus'],
    }),

    /** POST /dev-task/:id/reject -- reject a feature proposal */
    rejectDevTask: build.mutation<{ ok: boolean; task: DevTask }, string>({
      query: (documentId) => ({
        url: `/api/dev-task/${documentId}/reject`,
        method: 'POST',
      }),
      invalidatesTags: ['DevTask', 'QueueStatus'],
    }),

    /** POST /dev-task/:id/retry -- retry a failed task */
    retryDevTask: build.mutation<{ ok: boolean; task: DevTask }, string>({
      query: (documentId) => ({
        url: `/api/dev-task/${documentId}/retry`,
        method: 'POST',
      }),
      invalidatesTags: ['DevTask', 'QueueStatus'],
    }),

    /** POST /dev-task/:id/execute -- trigger execution from mobile */
    executeDevTask: build.mutation<{ ok: boolean; task: DevTask }, string>({
      query: (documentId) => ({
        url: `/api/dev-task/${documentId}/execute`,
        method: 'POST',
      }),
      invalidatesTags: ['DevTask', 'QueueStatus'],
    }),

    /** GET /dev-task/:id/analysis -- get feature analysis */
    getDevTaskAnalysis: build.query<{ analysis: DevTask['analysis']; status: string; description: string }, string>({
      query: (documentId) => `/api/dev-task/${documentId}/analysis`,
    }),
  }),
});

export const {
  useSubmitNotesMutation,
  useGetDevTasksQuery,
  useGetQueueStatusQuery,
  useApproveDevTaskMutation,
  useRejectDevTaskMutation,
  useRetryDevTaskMutation,
  useExecuteDevTaskMutation,
  useGetDevTaskAnalysisQuery,
} = devTaskApi;
