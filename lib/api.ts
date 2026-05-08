/**
 * api.ts -- Local-only stub for Mittens Open.
 * All cloud logic (login, JWT, Strapi URLs) has been stripped.
 */

export const getApiBase = () => 'http://localhost';
export const getAuthToken = () => 'local-token';
export const setAuthToken = (token: string | null) => {};
export const initApiBase = async () => {};

export const login = async (u: string, p: string) => {
  throw new Error('Cloud login disabled in Mittens Open');
};

export const register = async (u: string, p: string) => {
  throw new Error('Cloud registration disabled in Mittens Open');
};

export const brainText = async () => {
  throw new Error('Cloud brains disabled. Use on-device models.');
};

export const brainVision = async () => {
  throw new Error('Cloud vision disabled. Use on-device models.');
};

export const uploadMedia = async () => {
  throw new Error('Cloud uploads disabled.');
};

export const sendDeviceMeta = async () => {};
export const reportTaskCompletion = async () => {};
