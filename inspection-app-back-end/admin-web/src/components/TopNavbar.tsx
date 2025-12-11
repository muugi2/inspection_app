'use client';

import { usePathname, useRouter } from 'next/navigation';

export default function TopNavbar() {
  const router = useRouter();
  const pathname = usePathname();

  // Report menu items (horizontal navbar)
  const reportMenuItems = [
    {
      name: 'Байгууллага',
      path: '/organizations',
      icon: '🏢',
    },
    {
      name: 'Талбай',
      path: '/sites',
      icon: '📍',
    },
    {
      name: 'Гэрээ',
      path: '/contracts',
      icon: '📄',
    },
    {
      name: 'Төхөөрөмжийн загвар',
      path: '/device-models',
      icon: '⚙️',
    },
    {
      name: 'Төхөөрөмж',
      path: '/devices',
      icon: '🔧',
    },
    {
      name: 'Үзлэг',
      path: '/inspections',
      icon: '📋',
    },
    {
      name: 'Засвар',
      path: '/repairs',
      icon: '🔨',
    },
  ];

  const isActive = (path: string) => pathname === path;
  const isReportPage = reportMenuItems.some(item => isActive(item.path));

  // Only show navbar if on a report page
  if (!isReportPage) {
    return null;
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="px-6 py-3">
        <div className="grid grid-cols-7 gap-2">
          {reportMenuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-colors ${
                isActive(item.path)
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-center leading-tight">{item.name}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

