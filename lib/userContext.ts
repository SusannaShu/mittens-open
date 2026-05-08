/**
 * Lightweight user context stored at login.
 * Holds Backend user fields (firstname, username, email, etc.)
 * so screens can access the user's name without an extra API call.
 */

let _backendUser: { firstname?: string; lastname?: string; username?: string; email?: string } | null = null;

export function setBackendUser(user: any) {
  _backendUser = user;
}

export function getBackendUser() {
  return _backendUser;
}

/** Returns the user's display name: firstname > username > fallback */
export function getUserDisplayName(fallback = 'User'): string {
  if (_backendUser?.firstname) return _backendUser.firstname;
  if (_backendUser?.username) return _backendUser.username;
  return fallback;
}
