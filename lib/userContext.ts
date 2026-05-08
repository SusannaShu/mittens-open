/**
 * Lightweight user context stored at login.
 * Holds Strapi user fields (firstname, username, email, etc.)
 * so screens can access the user's name without an extra API call.
 */

let _strapiUser: { firstname?: string; lastname?: string; username?: string; email?: string } | null = null;

export function setStrapiUser(user: any) {
  _strapiUser = user;
}

export function getStrapiUser() {
  return _strapiUser;
}

/** Returns the user's display name: firstname > username > fallback */
export function getUserDisplayName(fallback = 'User'): string {
  if (_strapiUser?.firstname) return _strapiUser.firstname;
  if (_strapiUser?.username) return _strapiUser.username;
  return fallback;
}
