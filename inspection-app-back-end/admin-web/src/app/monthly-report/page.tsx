'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Site {
  id: string;
  name: string;
  organization: {
    id: string;
    name: string;
  };
}

export default function MonthlyReportPage() {
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const initializePage = async () => {
      if (!authUtils.isAuthenticated()) {
        router.push('/login');
        return;
      }

      const currentUser = authUtils.getUser();
      if (currentUser) {
        setUser(currentUser);
      }

      try {
        const verification = await authUtils.verifyToken();
        if (!verification.valid) {
          router.push('/login');
          return;
        }
        
        if (verification.user) {
          setUser(verification.user);
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        router.push('/login');
        return;
      }

      await loadSites();
    };

    initializePage();
  }, [router]);

  const loadSites = async () => {
    try {
      setIsLoading(true);
      const response = await apiService.sites.getAll();
      const sitesData: Site[] = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      setSites(sitesData);
      
      // Auto-select first site if available
      if (sitesData.length > 0 && !selectedSiteId) {
        setSelectedSiteId(sitesData[0].id);
      }
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Талбайг ачаалахад алдаа гарлаа';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedSiteId) {
      setError('Талбай сонгоно уу');
      return;
    }

    try {
      setIsDownloading(true);
      setError('');

      const blob = await apiService.reports.downloadMonthlyReport(
        selectedSiteId,
        selectedYear,
        selectedMonth
      );

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `monthly-report-${selectedSiteId}-${selectedYear}-${selectedMonth}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Тайлан татахад алдаа гарлаа';
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  };

  // Generate year options (current year and previous 2 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - i);

  // Month options
  const monthOptions = [
    { value: 1, label: '1 сар' },
    { value: 2, label: '2 сар' },
    { value: 3, label: '3 сар' },
    { value: 4, label: '4 сар' },
    { value: 5, label: '5 сар' },
    { value: 6, label: '6 сар' },
    { value: 7, label: '7 сар' },
    { value: 8, label: '8 сар' },
    { value: 9, label: '9 сар' },
    { value: 10, label: '10 сар' },
    { value: 11, label: '11 сар' },
    { value: 12, label: '12 сар' },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Ачаалж байна...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar currentUser={user} />

      <div className="flex-1 ml-64">
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4">
            <h1 className="text-xl font-bold text-gray-900">1 сарын тайлан</h1>
            <p className="text-sm text-gray-500">Тухайн сард хийгдсэн бүх үзлэгүүдийн тайланг татах</p>
          </div>
        </header>

        <main className="p-6">
          <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Талбай
                </label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Талбай сонгох</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name} ({site.organization.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Жил
                  </label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Сар
                  </label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {monthOptions.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={handleDownload}
                  disabled={!selectedSiteId || isDownloading}
                  className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                    !selectedSiteId || isDownloading
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {isDownloading ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Татаж байна...
                    </span>
                  ) : (
                    '📥 Тайлан татах (.docx)'
                  )}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
