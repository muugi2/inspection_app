'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import fileDownload from 'js-file-download';

interface Organization {
  id: string;
  name: string;
  code?: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  orgId?: string;
}

export default function InstallationReportPage() {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingContracts, setIsLoadingContracts] = useState(false);
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
      if (currentUser) setUser(currentUser);

      try {
        const verification = await authUtils.verifyToken();
        if (!verification.valid) {
          router.push('/login');
          return;
        }
        if (verification.user) setUser(verification.user);
      } catch (err) {
        console.error('Token verification failed:', err);
        router.push('/login');
        return;
      }

      await loadOrganizations();
    };

    initializePage();
  }, [router]);

  useEffect(() => {
    if (!selectedOrgId) {
      setContracts([]);
      setSelectedContractId('');
      return;
    }
    loadContracts(selectedOrgId);
  }, [selectedOrgId]);

  const loadOrganizations = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.organizations.getAll();
      const data = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      setOrganizations(data);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Байгууллагуудыг ачаалахад алдаа гарлаа';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadContracts = async (orgId: string) => {
    try {
      setIsLoadingContracts(true);
      setError('');
      const response = await apiService.contracts.getByOrganization(orgId);
      const data = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      setContracts(data);
      setSelectedContractId('');
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Гэрээг ачаалахад алдаа гарлаа';
      setError(message);
      setContracts([]);
    } finally {
      setIsLoadingContracts(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedContractId) {
      setError('Гэрээ сонгоно уу');
      return;
    }

    try {
      setIsDownloading(true);
      setError('');

      const blob = await apiService.reports.downloadInstallationReport(selectedContractId);

      if (!(blob instanceof Blob)) {
        throw new Error('Буруу хариу ирлээ');
      }
      if (blob.size === 0) {
        throw new Error('Файл хоосон ирлээ');
      }

      const filename = `installation-report-${selectedContractId}.docx`;
      fileDownload(blob, filename);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Тайлан татахад алдаа гарлаа';
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  };

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
            <h1 className="text-xl font-bold text-gray-900">Суурьлуулалтын тайлан</h1>
            <p className="text-sm text-gray-500">Гэрээг сонгоод суурьлуулалтын тайланг DOCX хэлбэрээр татах</p>
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
                  Байгууллага
                </label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Байгууллага сонгох</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.code ? `(${org.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Гэрээ
                </label>
                <select
                  value={selectedContractId}
                  onChange={(e) => setSelectedContractId(e.target.value)}
                  disabled={!selectedOrgId || isLoadingContracts}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                >
                  <option value="">
                    {!selectedOrgId ? 'Эхлээд байгууллага сонгоно уу' : isLoadingContracts ? 'Ачаалж байна...' : 'Гэрээ сонгох'}
                  </option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contractName} — {c.contractNumber}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4">
                <button
                  onClick={handleDownload}
                  disabled={!selectedContractId || isDownloading}
                  className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                    !selectedContractId || isDownloading
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
                    '📥 Суурьлуулалтын тайлан татах (.docx)'
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
