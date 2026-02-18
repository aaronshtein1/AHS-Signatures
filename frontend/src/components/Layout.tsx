import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const { user, logout, isAdmin } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  // Admin navigation items
  const adminNavItems = [
    { href: '/', label: 'Dashboard' },
    { href: '/packets', label: 'Packets' },
  ];

  // User navigation items
  const userNavItems = [
    { href: '/my-documents', label: 'My Documents' },
  ];

  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <Link href={isAdmin ? '/' : '/my-documents'} className="text-xl font-bold text-blue-600">
                  AHS Signatures
                </Link>
              </div>
              <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
                {navItems.map((item) => {
                  const isActive = router.pathname === item.href ||
                    (item.href !== '/' && router.pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {user && (
                <>
                  <div className="text-sm">
                    <span className="text-gray-700">{user.name}</span>
                    <span className={`ml-2 px-2 py-0.5 text-xs font-medium rounded-full ${
                      isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {isAdmin ? 'Admin' : 'User'}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden border-t border-gray-200">
          <div className="flex space-x-2 px-4 py-2">
            {navItems.map((item) => {
              const isActive = router.pathname === item.href ||
                (item.href !== '/' && router.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 text-sm font-medium rounded-md ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      <footer className="border-t border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            Lightweight PDF Signing System
          </p>
        </div>
      </footer>
    </div>
  );
}
