'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authUtils } from '@/lib/auth';
import type { ComponentType } from 'react';

type IconProps = {
  className?: string;
};

const iconBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const DashboardIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
  </svg>
);

const AssignIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <path d="M5 12l4 4 10-10" />
    <path d="M5 5v4h4" />
  </svg>
);

const UsersIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <circle cx="9" cy="7" r="3" />
    <path d="M3 21v-2a4 4 0 014-4h4" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 21v-2.5a3.5 3.5 0 013.5-3.5" />
  </svg>
);

const AnswersIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <rect x="4" y="3.5" width="16" height="17" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);

const ReportsIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <path d="M5 19v-6M12 19V5M19 19v-9" />
  </svg>
);

const RegisterIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const BuildingIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <rect x="4" y="3" width="12" height="18" rx="1" />
    <path d="M16 9h4v12h-4" />
    <path d="M8 7h2M8 11h2M8 15h2M12 7h1M12 11h1M12 15h1" />
  </svg>
);

const MapPinIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 1113 0C18.5 15.5 12 21 12 21z" />
    <circle cx="12" cy="10.5" r="2.5" />
  </svg>
);

const ContractIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <path d="M7 3h8l4 4v14H7z" />
    <path d="M15 3v4h4" />
    <path d="M10 12h6M10 16h6" />
  </svg>
);

const DeviceIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <rect x="5" y="4" width="14" height="16" rx="2" />
    <circle cx="12" cy="11" r="3" />
    <path d="M9 18h6" />
  </svg>
);

const GearIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} className={`w-5 h-5 ${className}`}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h.1a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1h.2a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);

const ChevronDownIcon = ({ className = '' }: IconProps) => (
  <svg {...iconBase} strokeWidth={2} className={`w-4 h-4 transition-transform duration-200 ${className}`}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

type MenuItem = {
  name: string;
  path: string;
  icon: ComponentType<IconProps>;
  // Detail pages that should keep this menu item highlighted
  relatedPaths?: string[];
};

type MenuEntry =
  | { kind: 'item'; item: MenuItem }
  | { kind: 'group'; name: string; icon: ComponentType<IconProps>; items: MenuItem[] };

const MENU: MenuEntry[] = [
  {
    kind: 'item',
    item: { name: 'Dashboard', path: '/dashboard', icon: DashboardIcon },
  },
  {
    kind: 'group',
    name: 'Бүртгэл',
    icon: RegisterIcon,
    items: [
      { name: 'Байгууллага', path: '/organizations', icon: BuildingIcon, relatedPaths: ['/organization-details'] },
      { name: 'Талбай', path: '/sites', icon: MapPinIcon, relatedPaths: ['/site-details'] },
      { name: 'Гэрээ', path: '/contracts', icon: ContractIcon, relatedPaths: ['/contract-details'] },
      { name: 'Төхөөрөмжийн загвар', path: '/device-models', icon: GearIcon },
      { name: 'Төхөөрөмж', path: '/devices', icon: DeviceIcon },
      { name: 'Үзлэгийн загвар', path: '/inspections', icon: AnswersIcon },
    ],
  },
  {
    kind: 'group',
    name: 'Ажил томилох',
    icon: AssignIcon,
    items: [
      { name: 'Үзлэг томилох', path: '/assign-inspection', icon: AssignIcon },
      { name: 'Засвар томилох', path: '/assign-repair', icon: AssignIcon },
      { name: 'Суурилуулалт томилох', path: '/assign-installation', icon: AssignIcon },
      { name: 'Баталгаажуулалт томилох', path: '/assign-verification', icon: AssignIcon },
    ],
  },
  {
    kind: 'group',
    name: 'Тайлан',
    icon: ReportsIcon,
    items: [
      { name: 'Үзлэгийн тайлан', path: '/inspection-answers', icon: AnswersIcon },
      { name: 'Засварын тайлан', path: '/repair-answers', icon: AnswersIcon },
      { name: 'Суурилуулалтын тайлан', path: '/installation-report', icon: ReportsIcon },
      { name: 'Сарын тайлан', path: '/monthly-report', icon: ReportsIcon },
    ],
  },
  {
    kind: 'item',
    item: { name: 'Хэрэглэгч удирдах', path: '/users', icon: UsersIcon },
  },
];

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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const isActive = (item: MenuItem) => {
    if (pathname === item.path) return true;
    return (item.relatedPaths || []).some((prefix) => pathname.startsWith(prefix));
  };

  // Only get user on client side to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
    const user = propCurrentUser || authUtils.getUser();
    setCurrentUser(user);
  }, [propCurrentUser]);

  // Open the group containing the current page
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      MENU.forEach((entry) => {
        if (entry.kind === 'group' && entry.items.some(isActive)) {
          next[entry.name] = true;
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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

  const renderItem = (item: MenuItem, indented: boolean) => {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <button
        key={item.path}
        onClick={() => router.push(item.path)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
          indented ? 'pl-9' : ''
        } ${
          active
            ? 'bg-gray-300 text-gray-900'
            : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
        }`}
      >
        <Icon className={`flex-shrink-0 ${active ? 'text-gray-900' : 'text-gray-500'}`} />
        <span className="truncate text-left">{item.name}</span>
      </button>
    );
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
          {MENU.map((entry) => {
            if (entry.kind === 'item') {
              return renderItem(entry.item, false);
            }

            const GroupIcon = entry.icon;
            const isOpen = openGroups[entry.name] || false;
            const hasActiveItem = entry.items.some(isActive);

            return (
              <div key={entry.name}>
                <button
                  onClick={() => toggleGroup(entry.name)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors cursor-pointer ${
                    hasActiveItem && !isOpen
                      ? 'bg-gray-200 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <GroupIcon className="flex-shrink-0 text-gray-600" />
                    <span className="truncate">{entry.name}</span>
                  </div>
                  <ChevronDownIcon
                    className={`flex-shrink-0 text-gray-500 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                </button>

                {isOpen && (
                  <div className="mt-1 space-y-0.5">
                    {entry.items.map((item) => renderItem(item, true))}
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
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
        >
          <span className="text-lg">🚪</span>
          <span>Гарах</span>
        </button>
      </div>
    </div>
  );
}
