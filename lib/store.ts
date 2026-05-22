/**
 * Redux store for mittens-open (local-only mode).
 * Uses RTK Query with fakeBaseQuery -- all data is SQLite.
 */

import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from './services/baseApi';

// Import API slices to register their endpoints
import './services/nutritionApi';
import './services/profileApi';
import './services/messagesApi';
import './services/activityApi';
import './services/activityTypeApi';

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
