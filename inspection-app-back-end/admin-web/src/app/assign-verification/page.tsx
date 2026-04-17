'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Organization {
  id: string;
  name: string;
  code: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  orgId: string;
}

interface Site {
  id: string;
  name: string;
  orgId: string;
}

interface UserOption {
  id: string;
  fullName: string;
  email: string;
  role: string;
  organization?: {
    id: string;
    name: string;
    code: string;
  };
  orgId?: string;
}

export default function AssignVerificationPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [title, setTitle] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [filterUserOrgId, setFilterUserOrgId] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    const initialize = async () => {
      if (!authUtils.isAuthenticated()) {
        router.push('/login');
        return;
      }

      const user = authUtils.getUser();
      if (user) {
        setCurrentUser(user);
      }

      try {
        const verification = await authUtils.verifyToken();
        if (!verification.valid) {
          router.push('/login');
          return;
        }
        
        if (verification.user) {
          setCurrentUser(verification.user);
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        router.push('/login');
        return;
      }

      await loadOrganizations();
      await loadAllUsers();
      setIsLoading(false);
    };

    initialize();
  }, [router]);

  useEffect(() => {
    if (selectedOrgId) {
      loadContracts(selectedOrgId);
      loadSites(selectedOrgId);
    } else {
      setContracts([]);
      setSites([]);
      setSelectedContractId('');
      setSelectedSiteId('');
    }
  }, [selectedOrgId]);

  const loadOrganizations = async () => {
    try {
      const response = await apiService.organizations.getAll();
      setOrganizations(response?.data || []);
    } catch (err: any) {
      console.error('Failed to load organizations:', err);
      setError('Байгууллагуудыг ачаалахад алдаа гарлаа');
    }
  };

  const loadContracts = async (orgId: string) => {
    try {
      setContracts([]);
      setSelectedContractId('');
      
      const response = await apiService.contracts.getByOrganization(orgId);
      setContracts(response?.data || []);
    } catch (err: any) {
      console.error('Failed to load contracts:', err);
      setError('Гэрээнүүдийг ачаалахад алдаа гарлаа');
    }
  };

  const loadSites = async (orgId: string) => {
    try {
      setSites([]);
      setSelectedSiteId('');
      
      const response = await apiService.sites.getByOrganization(orgId);
      setSites(response?.data || []);
    } catch (err: any) {
      console.error('Failed to load sites:', err);
      // Site is optional, so don't show error
    }
  };

  const loadAllUsers = async () => {
    try {
      const response = await apiService.users.getAll();
      // Filter only inspector users
      const inspectorUsers = (response?.data || []).filter(
        (user: any) => user?.role?.toLowerCase() === 'inspector' && user?.isActive !== false
      );
      setUsers(inspectorUsers);
    } catch (err: any) {
      setError('Хэрэглэгчдийг ачаалахад алдаа гарлаа');
    }
  };

  const handleUserToggle = (userId: string) => {
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!selectedOrgId) {
      setError('Байгууллага сонгоно уу!');
      return;
    }
    
    if (!title.trim()) {
      setError('Гарчиг оруулна уу!');
      return;
    }
    
    if (selectedUserIds.length === 0) {
      setError('Хамгийн багадаа 1 хэрэглэгч сонгоно уу!');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Create verification assignments
      const verificationData = {
        orgId: selectedOrgId,
        siteId: selectedSiteId || undefined,
        contractId: selectedContractId || undefined,
        title: title.trim(),
        userIds: selectedUserIds,
      };

      const createResponse = await apiService.verifications.create(verificationData);
      const verificationsCount = createResponse?.count || createResponse?.data?.length || 1;
      
      setSuccess(`Баталгаажуулалтын томилолт ${selectedUserIds.length} хүнд амжилттай үүслээ! (Нийт ${verificationsCount} томилолт)`);
      
      // Reset form
      setSelectedOrgId('');
      setSelectedContractId('');
      setSelectedSiteId('');
      setTitle('');
      setSelectedUserIds([]);
      setFilterUserOrgId('');
      setContracts([]);
      setSites([]);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 
                          err.response?.data?.error ||
                          'Томилолт үүсгэхэд алдаа гарлаа';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-3 text-gray-600">Ачаалж байна...</p>
        </div>
      </div>
    );
  }

  const selectedOrg = organizations.find(o => o?.id === selectedOrgId) || null;
  const selectedContract = contracts.find(c => c?.id === selectedContractId) || null;
  const selectedSite = sites.find(s => s?.id === selectedSiteId) || null;
  const filteredUsers = users.filter((user) => {
    if (!user) return false;
    if (filterUserOrgId) {
      return user?.organization?.id === filterUserOrgId || user?.orgId === filterUserOrgId;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <Sidebar currentUser={currentUser} />

      {/* Main Content */}
      <div className="flex-1 ml-64">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4">
            <h1 className="text-xl font-bold text-gray-900">Баталгаажуулалтын томилолт үүсгэх</h1>
            <p className="text-xs text-gray-500 mt-1">Байгууллага → Гэрээ/Байршил → Гарчиг → Хэрэглэгч</p>
          </div>
        </header>

        {/* Content */}
        <main className="p-6">
          {/* Error & Success Messages */}
          {error && (
            <div className="mb-4 bg-red-50 border-l-4 border-red-500 rounded p-3">
              <p className="text-sm text-red-800">⚠ {error}</p>
            </div>
          )}
          
          {success && (
            <div className="mb-4 bg-green-50 border-l-4 border-green-500 rounded p-3">
              <p className="text-sm text-green-800">✓ {success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left Column - Form */}
              <div className="lg:col-span-2 space-y-4">
                {/* Step 1: Organization */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">1</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Байгууллага сонгох *</h3>
                  </div>
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm"
                  >
                    <option value="">-- Сонгох --</option>
                    {organizations.map((org) => (
                      <option key={org?.id} value={org?.id}>
                        {org?.name || 'N/A'} ({org?.code || 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Step 2: Contract (Optional) */}
                <div className={`bg-white rounded-lg shadow p-4 ${!selectedOrgId && 'opacity-50'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedOrgId ? 'bg-indigo-600' : 'bg-gray-300'
                    }`}>
                      <span className="text-white text-sm font-bold">2</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Гэрээ сонгох (сонголттой)</h3>
                  </div>
                  <select
                    value={selectedContractId}
                    onChange={(e) => setSelectedContractId(e.target.value)}
                    disabled={!selectedOrgId}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm disabled:bg-gray-100"
                  >
                    <option value="">-- Сонгохгүй --</option>
                    {contracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.contractName} ({contract.contractNumber})
                      </option>
                    ))}
                  </select>
                  {selectedOrgId && contracts.length === 0 && (
                    <p className="text-sm text-gray-500 mt-2">Энэ байгууллагт гэрээ олдсонгүй</p>
                  )}
                </div>

                {/* Step 3: Site (Optional) */}
                <div className={`bg-white rounded-lg shadow p-4 ${!selectedOrgId && 'opacity-50'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedOrgId ? 'bg-indigo-600' : 'bg-gray-300'
                    }`}>
                      <span className="text-white text-sm font-bold">3</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Байршил сонгох (сонголттой)</h3>
                  </div>
                  <select
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                    disabled={!selectedOrgId}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm disabled:bg-gray-100"
                  >
                    <option value="">-- Сонгохгүй --</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                  {selectedOrgId && sites.length === 0 && (
                    <p className="text-sm text-gray-500 mt-2">Энэ байгууллагт байршил олдсонгүй</p>
                  )}
                </div>

                {/* Step 4: Title */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">4</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Гарчиг *</h3>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Жишээ: Пүү-1, Пүү-2, хөрөнгийн таг"
                    required
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Гарчиг нь давтагдахгүй байх ёстой (жишээ: Пүү-1, Пүү-2, хөрөнгийн таг)
                  </p>
                </div>

                {/* Step 5: Users (Multiple Selection) */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">5</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Хэрэглэгч сонгох *</h3>
                  </div>
                  
                  {/* Filter by organization */}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Байгууллагаар шүүх (сонголттой):
                    </label>
                    <select
                      value={filterUserOrgId}
                      onChange={(e) => setFilterUserOrgId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm"
                    >
                      <option value="">Бүх байгууллага</option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name} ({org.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* User selection checkboxes */}
                  <div className="max-h-64 overflow-y-auto border-2 border-gray-300 rounded-lg p-3 space-y-2">
                    {filteredUsers.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        Inspector хэрэглэгч олдсонгүй
                      </p>
                    ) : (
                      filteredUsers.map((user) => (
                        <label
                          key={user?.id}
                          className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(user?.id || '')}
                            onChange={() => handleUserToggle(user?.id || '')}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {user?.fullName || 'N/A'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {user?.email || 'N/A'} - {user?.organization?.name || 'N/A'} ({user?.role || 'N/A'})
                            </p>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  
                  {selectedUserIds.length > 0 && (
                    <p className="text-sm text-indigo-600 mt-2">
                      {selectedUserIds.length} хэрэглэгч сонгогдлоо
                    </p>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Үүсгэж байна...' : 'Томилолт үүсгэх'}
                </button>
              </div>

              {/* Right Column - Preview */}
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-base font-bold text-gray-900 mb-4 pb-2 border-b">Сонгосон мэдээлэл</h3>
                
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Байгууллага:</p>
                    <p className="font-semibold text-gray-900">
                      {selectedOrg ? selectedOrg.name : '—'}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-xs mb-1">Гэрээ:</p>
                    <p className="font-semibold text-gray-900">
                      {selectedContract ? `${selectedContract.contractName} (${selectedContract.contractNumber})` : '—'}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-xs mb-1">Байршил:</p>
                    <p className="font-semibold text-gray-900">
                      {selectedSite ? selectedSite.name : '—'}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-xs mb-1">Гарчиг:</p>
                    <p className="font-semibold text-gray-900">
                      {title || '—'}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-xs mb-1">Сонгосон хэрэглэгч:</p>
                    <div className="space-y-1">
                      {selectedUserIds.length === 0 ? (
                        <p className="text-gray-400">—</p>
                      ) : (
                        selectedUserIds.map((userId) => {
                          const user = users.find(u => u?.id === userId);
                          return user ? (
                            <p key={userId} className="font-semibold text-gray-900 text-xs">
                              • {user.fullName}
                            </p>
                          ) : null;
                        })
                      )}
                    </div>
                    {selectedUserIds.length > 0 && (
                      <p className="text-xs text-indigo-600 mt-1">
                        Нийт: {selectedUserIds.length} хүн
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
