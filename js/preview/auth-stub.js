// Static preview stub for auth.js. Pretends always-signed-in so the
// preview lands directly on renderCachedFeed without an OAuth round-trip.

export class AuthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export async function isSignedIn() {
  return true;
}

export async function getValidAccessToken() {
  return 'mock-access-token';
}

export async function signIn() {
  console.info('[preview] signIn() — no-op');
}

export async function signOut() {
  console.info('[preview] signOut() — no-op');
}
