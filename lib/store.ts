/**
 * Redux store for Mittens app.
 * Uses RTK Query for all API calls with automatic caching.
 */

import { configureStore } from '@reduxjs/toolkit';
import { localApi } from './services/localApi';

// Import API slices to register their endpoints
import './services/nutritionApi';

export const store = configureStore({
  reducer: {
    [localApi.reducerPath]: localApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(localApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
