import { AuthUser, IAuthService } from '../interfaces/IAuthService';

const LOCAL_USER: AuthUser = { id: 'local-viewer', email: '', name: 'Local viewer' };
const SIGNED_OUT_KEY = 'atlas.localSignedOut';

/**
 * Sign-in for local data mode: no backend, no Fabric. The viewer is signed in as "Local viewer";
 * Sign out returns to the sign-in page, where Sign in comes straight back.
 */
export class LocalDataAuthService implements IAuthService {
  get fabricAuthEnabled(): boolean {
    return true;
  }

  async signOut(): Promise<void> {
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return sessionStorage.getItem(SIGNED_OUT_KEY) ? null : LOCAL_USER;
  }

  async isAuthenticated(): Promise<boolean> {
    return !sessionStorage.getItem(SIGNED_OUT_KEY);
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    return null;
  }

  async initiateFabricLogin(): Promise<void> {
    sessionStorage.removeItem(SIGNED_OUT_KEY);
  }

  async ensureSignedInWithFabric(): Promise<AuthUser> {
    sessionStorage.removeItem(SIGNED_OUT_KEY);
    return LOCAL_USER;
  }
}
