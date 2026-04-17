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

interface Template {
  id: string;
  name: string;
  type: string;
  deviceType?: string;
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

export default function AssignInstallationPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [title, setTitle] = useState('');
  const [extraInfo, setExtraInfo] = useState({
    truckTotalLengthM: '',
    platformLengthM: '',
    platformWidthM: '',
    platformCount: '',
    capacityKg: '',
    indicatorType: 'DIGITAL',
    indicatorModel: '',
    manufacturerModel: '',
    loadCellCount: '',
    junctionBoxCount: '',
  });
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
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
      await loadTemplates();
      await loadAllUsers();
      setIsLoading(false);
    };

    initialize();
  }, [router]);

  useEffect(() => {
    if (selectedOrgId) {
      loadContracts(selectedOrgId);
    } else {
      setContracts([]);
      setSelectedContractId('');
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

  const loadTemplates = async () => {
    try {
      const response = await apiService.templates.getByType('INSTALLATION');
      // Filter for installation templates
      const installationTemplates = (response?.data || []).filter(
        (template: Template) => template.type === 'INSTALLATION'
      );
      setTemplates(installationTemplates);
    } catch (err: any) {
      console.error('Failed to load templates:', err);
      setError('Template-уудыг ачаалахад алдаа гарлаа');
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
    
    if (!selectedContractId) {
      setError('Гэрээ сонгоно уу!');
      return;
    }
    
    if (!title.trim()) {
      setError('Гарчиг оруулна уу!');
      return;
    }
    
    if (selectedTemplateIds.length === 0) {
      setError('Хамгийн багадаа 1 template сонгоно уу!');
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
      // Create installation assignments in the new installation_assignments table
      const assignmentData = {
        contractId: selectedContractId,
        templateIds: selectedTemplateIds,
        userIds: selectedUserIds,
        title: title.trim(),
        extraInfo: {
          truck_total_length_m: extraInfo.truckTotalLengthM
            ? Number(extraInfo.truckTotalLengthM)
            : null,
          platform: {
            length_m: extraInfo.platformLengthM
              ? Number(extraInfo.platformLengthM)
              : null,
            width_m: extraInfo.platformWidthM
              ? Number(extraInfo.platformWidthM)
              : null,
            count: extraInfo.platformCount
              ? Number(extraInfo.platformCount)
              : null,
          },
          capacity_kg: extraInfo.capacityKg
            ? Number(extraInfo.capacityKg)
            : null,
          indicator: {
            type: extraInfo.indicatorType || null,
            model: extraInfo.indicatorModel || '',
          },
          manufacturer_model: extraInfo.manufacturerModel || '',
          load_cell: {
            count: extraInfo.loadCellCount
              ? Number(extraInfo.loadCellCount)
              : null,
          },
          junction_box: {
            count: extraInfo.junctionBoxCount
              ? Number(extraInfo.junctionBoxCount)
              : null,
          },
        },
      };

      const createResponse = await apiService.installationAssignments.create(assignmentData);
      const assignmentsCount = createResponse?.count || createResponse?.data?.length || 0;
      
      setSuccess(`Суурьлуулалтын томилолт ${selectedTemplateIds.length} template-д ${selectedUserIds.length} хүнд амжилттай үүслээ! (Нийт ${assignmentsCount} томилолт)`);
      
      // Reset form
      setSelectedOrgId('');
      setSelectedContractId('');
      setTitle('');
      setSelectedTemplateIds([]);
      setSelectedUserIds([]);
      setFilterUserOrgId('');
      setContracts([]);
      setExtraInfo({
        truckTotalLengthM: '',
        platformLengthM: '',
        platformWidthM: '',
        platformCount: '',
        capacityKg: '',
        indicatorType: 'DIGITAL',
        indicatorModel: '',
        manufacturerModel: '',
        loadCellCount: '',
        junctionBoxCount: '',
      });
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
  const selectedTemplates = templates.filter(t => selectedTemplateIds.includes(t.id));
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
            <h1 className="text-xl font-bold text-gray-900">Суурьлуулалтын томилолт үүсгэх</h1>
            <p className="text-xs text-gray-500 mt-1">Байгууллага → Гэрээ → Template → Хэрэглэгч</p>
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

                {/* Step 2: Contract */}
                <div className={`bg-white rounded-lg shadow p-4 ${!selectedOrgId && 'opacity-50'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      selectedOrgId ? 'bg-indigo-600' : 'bg-gray-300'
                    }`}>
                      <span className="text-white text-sm font-bold">2</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Гэрээ сонгох *</h3>
                  </div>
                  <select
                    value={selectedContractId}
                    onChange={(e) => setSelectedContractId(e.target.value)}
                    disabled={!selectedOrgId}
                    required
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm disabled:bg-gray-100"
                  >
                    <option value="">-- Сонгох --</option>
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

                {/* Step 3: Title */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">3</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Гарчиг *</h3>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Жишээ: Пүү-1 - Нил суурь суурилуулалт"
                    required
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-sm"
                  />
                </div>

                {/* Step 4: Detailed installation info (extraInfo) */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">4</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Дэлгэрэнгүй мэдээлэл</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {/* Автожингийн нийт хэмжээ */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Автожингийн нийт хэмжээ (м)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={extraInfo.truckTotalLengthM}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, truckTotalLengthM: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    {/* Даац */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Автожингийн даац (кг)
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={extraInfo.capacityKg}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, capacityKg: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    {/* Тавцангийн хэмжээ, тоо */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Тавцангийн хэмжээ (урт x өргөн, м)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Урт"
                          value={extraInfo.platformLengthM}
                          onChange={(e) =>
                            setExtraInfo({ ...extraInfo, platformLengthM: e.target.value })
                          }
                          className="w-1/2 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Өргөн"
                          value={extraInfo.platformWidthM}
                          onChange={(e) =>
                            setExtraInfo({ ...extraInfo, platformWidthM: e.target.value })
                          }
                          className="w-1/2 px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Тавцангийн тоо
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={extraInfo.platformCount}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, platformCount: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    {/* Тооцоолуурын төрөл, загвар */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Автожингийн тооцоолуурын төрөл
                      </label>
                      <select
                        value={extraInfo.indicatorType}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, indicatorType: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      >
                        <option value="ANALOG">Аналог</option>
                        <option value="DIGITAL">Дижитал</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Автожингийн тооцоолуурын загвар
                      </label>
                      <input
                        type="text"
                        value={extraInfo.indicatorModel}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, indicatorModel: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    {/* Үйлдвэрлэгч загвар */}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Үйлдвэрлэгч
                      </label>
                      <input
                        type="text"
                        value={extraInfo.manufacturerModel}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, manufacturerModel: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Ачаа мэдрэгчийн тоо
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={extraInfo.loadCellCount}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, loadCellCount: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Холбох хайрцагийн тоо
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={extraInfo.junctionBoxCount}
                        onChange={(e) =>
                          setExtraInfo({ ...extraInfo, junctionBoxCount: e.target.value })
                        }
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Step 5: Templates (Multiple Selection) */}
                <div className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-sm font-bold">5</span>
                    </div>
                    <h3 className="text-base font-bold text-gray-900">Template сонгох *</h3>
                  </div>
                  
                  {/* Template selection checkboxes */}
                  <div className="max-h-64 overflow-y-auto border-2 border-gray-300 rounded-lg p-3 space-y-2">
                    {templates.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        Суурьлуулалтын template олдсонгүй
                      </p>
                    ) : (
                      templates.map((template) => (
                        <label
                          key={template.id}
                          className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTemplateIds.includes(template.id)}
                            onChange={() => {
                              setSelectedTemplateIds(prev => {
                                if (prev.includes(template.id)) {
                                  return prev.filter(id => id !== template.id);
                                } else {
                                  return [...prev, template.id];
                                }
                              });
                            }}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {template.name}
                            </p>
                            {template.deviceType && (
                              <p className="text-xs text-gray-500">
                                {template.deviceType}
                              </p>
                            )}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  
                  {selectedTemplateIds.length > 0 && (
                    <p className="text-sm text-indigo-600 mt-2">
                      {selectedTemplateIds.length} template сонгогдлоо
                    </p>
                  )}
                </div>

                {/* Step 6: Users (Multiple Selection) */}
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
                    <p className="text-gray-500 text-xs mb-1">Гарчиг:</p>
                    <p className="font-semibold text-gray-900">
                      {title || '—'}
                    </p>
                  </div>

                  <div>
                    <p className="text-gray-500 text-xs mb-1">Сонгосон Template:</p>
                    <div className="space-y-1">
                      {selectedTemplates.length === 0 ? (
                        <p className="text-gray-400">—</p>
                      ) : (
                        selectedTemplates.map((template) => (
                          <p key={template.id} className="font-semibold text-gray-900 text-xs">
                            • {template.name} {template.deviceType ? `(${template.deviceType})` : ''}
                          </p>
                        ))
                      )}
                    </div>
                    {selectedTemplates.length > 0 && (
                      <p className="text-xs text-indigo-600 mt-1">
                        Нийт: {selectedTemplates.length} template
                      </p>
                    )}
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
