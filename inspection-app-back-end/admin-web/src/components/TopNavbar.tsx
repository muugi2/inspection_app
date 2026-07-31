'use client';

import { usePathname, useRouter } from 'next/navigation';

export default function TopNavbar() {
  const router = useRouter();
  const pathname = usePathname();

  // Registration section tabs (horizontal navbar)
  const menuItems = [
    {
      name: 'Байгууллага',
      path: '/organizations',
      relatedPrefix: '/organization-details',
      icon: '🏢',
    },
    {
      name: 'Талбай',
      path: '/sites',
      relatedPrefix: '/site-details',
      icon: '📍',
    },
    {
      name: 'Гэрээ',
      path: '/contracts',
      relatedPrefix: '/contract-details',
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
      name: 'Үзлэгийн загвар',
      path: '/inspections',
      icon: '📋',
    },
  ];

  const isActive = (item: { path: string; relatedPrefix?: string }) =>
    pathname === item.path || (item.relatedPrefix ? pathname.startsWith(item.relatedPrefix) : false);

  // Only show navbar within the registration section
  if (!menuItems.some(isActive)) {
    return null;
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="px-6 py-3">
        <div className="grid grid-cols-6 gap-2">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isActive(item)
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
