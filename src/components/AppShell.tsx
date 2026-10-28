import { NavLink, Outlet } from 'react-router-dom';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Wordmark } from '@/components/Wordmark';
import { useAuth } from '@/hooks/AuthContext';
import { CatalogProvider, useCatalog, VolumeCatalogProvider } from '@/hooks/useCatalog';

const TABS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/pathology', label: 'Pathology' },
  { to: '/volumes', label: '3D and 4D imaging' },
  { to: '/guide', label: 'Guide' },
];

function ShellHeader() {
  const { user, signOut } = useAuth();
  const { catalog } = useCatalog();
  return (
    <header className="hair shrink-0 border-b">
      <div className="flex h-14 items-center gap-8 px-5">
        <Wordmark compact />
        <nav className="flex h-full items-stretch gap-6" aria-label="Sections">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className="tab">
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5 text-[12.5px]">
          {catalog && (
            <a
              href={catalog.lakehouse.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="link t-muted t-mono hidden xl:inline"
              title={catalog.lakehouse.oneLakePath}
            >
              {catalog.lakehouse.workspaceName}/{catalog.lakehouse.lakehouseName}
            </a>
          )}
          {user && (
            <>
              <span className="t-faint hidden 2xl:inline">{user.email || user.name}</span>
              <button onClick={() => void signOut()} className="link t-muted">
                Sign out
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <CatalogProvider>
      <VolumeCatalogProvider>
        <div className="flex h-screen flex-col">
          <ShellHeader />
          <div className="min-h-0 flex-1">
            <Outlet />
          </div>
        </div>
      </VolumeCatalogProvider>
    </CatalogProvider>
  );
}
