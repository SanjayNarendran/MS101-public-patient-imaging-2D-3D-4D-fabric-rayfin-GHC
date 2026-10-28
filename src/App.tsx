import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { AppShell } from '@/components/AppShell';

import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { AuthCallback } from '@/pages/AuthCallback.tsx';
import { Guide } from '@/pages/Guide';
import { Overview } from '@/pages/Overview';
import { Pathology } from '@/pages/Pathology';
import { Volumes } from '@/pages/Volumes';

/** The route a visitor asked for before being sent to sign in. */
interface AuthRedirectState {
  from?: string;
}

/**
 * Resolves where to send a visitor after they sign in.
 *
 * Only same-origin application paths are accepted, so a crafted value cannot
 * send the visitor off-site, and the sign-in routes are rejected so sign-in
 * cannot loop.
 */
function resolveReturnPath(state: unknown): string {
  const from = (state as AuthRedirectState | null)?.from;

  if (typeof from !== 'string' || !from.startsWith('/')) return '/';
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  if (
    from === '/auth' ||
    from.startsWith('/auth/') ||
    from.startsWith('/auth?')
  ) {
    return '/';
  }

  return from;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="t-faint">Loading</div>
      </div>
    );
  }

  // Carry the requested route through sign-in. Without this, a shared link
  // opened by a signed-out visitor always lands on the default page.
  if (!isAuthenticated) {
    const redirectState: AuthRedirectState = {
      from: `${location.pathname}${location.search}`,
    };
    return <Navigate to="/auth" replace state={redirectState} />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="t-faint">Loading</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={resolveReturnPath(location.state)} replace />;
  }

  return <>{children}</>;
}

/** Links shared before the tabs existed (`/?slide=...`) now open in the Pathology tab. */
function OverviewOrLegacySlide() {
  const { search } = useLocation();
  if (new URLSearchParams(search).has('slide')) return <Navigate to={`/pathology${search}`} replace />;
  return <Overview />;
}

function App() {
  return (
    <BrowserRouter>
      {/* ensure all new routes require auth */}
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/auth"
          element={
            <PublicRoute>
              <AuthPage />
            </PublicRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<OverviewOrLegacySlide />} />
          <Route path="pathology" element={<Pathology />} />
          <Route path="volumes" element={<Volumes />} />
          <Route path="guide" element={<Guide />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
