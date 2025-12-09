'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authUtils } from '@/lib/auth';
import type { ComponentType } from 'react';

type IconProps = {
  className?: string;
};

const DashboardIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
  </svg>
);

const AssignIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <path d="M5 12l4 4 10-10" />
    <path d="M5 5v4h4" />
  </svg>
);

const UsersIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <circle cx="9" cy="7" r="3" />
    <path d="M3 21v-2a4 4 0 014-4h4" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 21v-2.5a3.5 3.5 0 013.5-3.5" />
  </svg>
);

const AnswersIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);

const ReportsIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <path d="M5 19v-6M12 19V5M19 19v-9" />
  </svg>
);

const MonthlyReportIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18M8 2v4M16 2v4M3 18h18" />
  </svg>
);

type MenuItem = {
  name: string;
  path: string;
  icon: ComponentType<IconProps>;
};

interface SidebarProps {
  currentUser?: {
    fullName: string;
    organization: {
      name: string;
    };
    role: string;
  } | null;
}

export default function Sidebar({ currentUser: propCurrentUser }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<SidebarProps['currentUser']>(null);
  const [mounted, setMounted] = useState(false);

  // Only get user on client side to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    // Use prop if provided, otherwise get from authUtils
    const user = propCurrentUser || authUtils.getUser();
    setCurrentUser(user);
  }, [propCurrentUser]);

  const handleLogout = () => {
    authUtils.logout();
    router.push('/login');
  };

  const menuItems: MenuItem[] = [
    {
      name: 'Үзлэгийн тайлан',
      path: '/inspection-answers',
      icon: AnswersIcon,
    },
    {
      name: 'Dashboard',
      path: '/dashboard',
      icon: DashboardIcon,
    },
    {
      name: 'Үзлэг томилох',
      path: '/assign-inspection',
      icon: AssignIcon,
    },
    {
      name: 'Хэрэглэгч удирдах',
      path: '/users',
      icon: UsersIcon,
    },
    {
      name: 'Тайлан',
      path: '/organizations', // Default to first report page
      icon: ReportsIcon,
    },
    {
      name: '1 сарын тайлан',
      path: '/monthly-report',
      icon: MonthlyReportIcon,
    },
  ];

  const isActive = (path: string) => {
    // For "Тайлан", check if any report page is active
    if (path === '/organizations') {
      const reportPaths = ['/organizations', '/sites', '/contracts', '/device-models', '/devices', '/inspections'];
      return reportPaths.some(reportPath => pathname === reportPath);
    }
    return pathname === path;
  };

  return (
    <div className="w-64 bg-gray-100 h-screen fixed left-0 top-0 border-r border-gray-200 flex flex-col">
      {/* Logo/Header */}
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-700">Inspection System</h1>
        <p className="text-xs text-gray-500 mt-1">Admin Panel</p>
      </div>

      {/* User Info - Only render after mount to avoid hydration mismatch */}
      {mounted && currentUser && (
        <div className="p-4 border-b border-gray-200 bg-gray-100">
          <p className="text-sm font-semibold text-gray-800">{currentUser.fullName}</p>
          <p className="text-xs text-gray-500">{currentUser.organization?.name}</p>
          <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full">
            {currentUser.role}
          </span>
        </div>
      )}

      {/* Menu Items */}
      <nav className="flex-1 p-3 overflow-y-auto">
        <div className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-gray-300 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                <Icon
                  className={
                    active
                      ? 'text-gray-900'
                      : 'text-gray-500 group-hover:text-gray-900'
                  }
                />
                <span>{item.name}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <span className="text-lg">🚪</span>
          <span>Гарах</span>
        </button>
      </div>
    </div>
  );
}
