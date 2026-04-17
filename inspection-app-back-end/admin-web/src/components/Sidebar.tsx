'use client';

import { useState, useEffect, useMemo } from 'react';
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

const RegisterIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const ActivityIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${className}`}
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

const ChevronDownIcon = ({ className = '' }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-4 h-4 transition-transform duration-200 ${className}`}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

type MenuItem = {
  name: string;
  path: string;
  icon: ComponentType<IconProps>;
};

type MenuGroup = {
  name: string;
  icon: ComponentType<IconProps>;
  items: MenuItem[];
  defaultOpen?: boolean;
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    'Тайлан': true,
    'Хэрэглэгч удирдах': true,
    'Бүртгэл': false,
    'Үйл ажиллагаа': false,
  });

  const menuGroups: MenuGroup[] = useMemo(() => [
    {
      name: 'Тайлан',
      icon: ReportsIcon,
      items: [
        {
          name: 'Үзлэгийн тайлан',
          path: '/inspection-answers',
          icon: AnswersIcon,
        },
        {
          name: 'Засварын тайлан',
          path: '/repair-answers',
          icon: AnswersIcon,
        },
        {
          name: 'Суурьлуулалтын тайлан',
          path: '/installation-report',
          icon: ReportsIcon,
        },
      ],
      defaultOpen: false,
    },
    {
      name: 'Хэрэглэгч удирдах',
      icon: UsersIcon,
      items: [
        {
          name: 'Үзлэг томилох',
          path: '/assign-inspection',
          icon: AssignIcon,
        },
        {
          name: 'Засвар томилох',
          path: '/assign-repair',
          icon: AssignIcon,
        },
        {
          name: 'Суурьлуулалт томилох',
          path: '/assign-installation',
          icon: AssignIcon,
        },
        {
          name: 'Баталгаажуулалт томилох',
          path: '/assign-verification',
          icon: AssignIcon,
        },
        {
          name: 'Хэрэглэгч удирдах',
          path: '/users',
          icon: UsersIcon,
        },
      ],
      defaultOpen: true,
    },
    {
      name: 'Бүртгэл',
      icon: RegisterIcon,
      items: [],
      defaultOpen: false,
    },
    {
      name: 'Үйл ажиллагаа',
      icon: ActivityIcon,
      items: [
        {
          name: 'Dashboard',
          path: '/dashboard',
          icon: DashboardIcon,
        },
        {
          name: '1 сарын тайлан',
          path: '/monthly-report',
          icon: ReportsIcon,
        },
      ],
      defaultOpen: false,
    },
  ], []);

  // Only get user on client side to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    // Use prop if provided, otherwise get from authUtils
    const user = propCurrentUser || authUtils.getUser();
    setCurrentUser(user);

    // Auto-open groups if current path matches any item in the group
    const newOpenGroups: Record<string, boolean> = {};
    menuGroups.forEach((group) => {
      const hasActiveItem = group.items.some((item) => {
        if (item.path === '/organizations') {
          const reportPaths = ['/organizations', '/sites', '/contracts', '/device-models', '/devices', '/inspections'];
          return reportPaths.some(reportPath => pathname === reportPath);
        }
        return pathname === item.path;
      });
      newOpenGroups[group.name] = hasActiveItem || group.defaultOpen || false;
    });
    setOpenGroups(newOpenGroups);
  }, [propCurrentUser, pathname]);

  const handleLogout = () => {
    authUtils.logout();
    router.push('/login');
  };

  const toggleGroup = (groupName: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const isActive = (path: string) => {
    // For "Бүртгэл" group items
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
          {menuGroups.map((group) => {
            const GroupIcon = group.icon;
            const isOpen = openGroups[group.name] || false;
            const hasActiveItem = group.items.some((item) => isActive(item.path));

            return (
              <div key={group.name} className="mb-2">
                {/* Group Header - Compact style */}
                <button
                  onClick={() => {
                    if (group.items.length > 0) {
                      toggleGroup(group.name);
                    } else if (group.name === 'Бүртгэл') {
                      // If "Бүртгэл" group has no items, navigate to organizations
                      router.push('/organizations');
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                    hasActiveItem || (group.name === 'Бүртгэл' && pathname === '/organizations')
                      ? 'bg-gray-300 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                  } cursor-pointer`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <GroupIcon
                      className={`flex-shrink-0 ${
                        hasActiveItem || (group.name === 'Бүртгэл' && pathname === '/organizations')
                          ? 'text-gray-900'
                          : 'text-gray-600'
                      }`}
                    />
                    <span className="truncate">{group.name}</span>
                  </div>
                  {group.items.length > 0 && (
                    <ChevronDownIcon
                      className={`flex-shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-0' : '-rotate-90'
                      } ${hasActiveItem ? 'text-gray-900' : 'text-gray-500'}`}
                    />
                  )}
                </button>

                {/* Group Items - Indented with visual connection */}
                {isOpen && (
                  <div className="mt-1 ml-6 space-y-0.5">
                    {group.items.map((item, index) => {
                      const Icon = item.icon;
                      const active = isActive(item.path);
                      const isLast = index === group.items.length - 1;
                      
                      return (
                        <div key={item.path} className="relative">
                          {/* Vertical line connector */}
                          {!isLast && (
                            <div className="absolute left-2 top-6 bottom-0 w-px bg-gray-300"></div>
                          )}
                          {/* Horizontal line connector */}
                          <div className="absolute left-2 top-3 w-3 h-px bg-gray-300"></div>
                          
              <button
                onClick={() => router.push(item.path)}
                            className={`relative w-full flex items-center gap-2 pl-6 pr-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-gray-300 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                            {/* Dot indicator */}
                            <div className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
                              active ? 'bg-gray-900' : 'bg-gray-400'
                            }`}></div>
                            
                <Icon
                              className={`flex-shrink-0 ${
                    active
                      ? 'text-gray-900'
                                  : 'text-gray-500'
                              }`}
                />
                            <span className="truncate">{item.name}</span>
              </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <span className="text-lg">🚪</span>
          <span>Гарах</span>
        </button>
      </div>
    </div>
  );
}
