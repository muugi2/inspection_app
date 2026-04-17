'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import TopNavbar from '@/components/TopNavbar';
import DeleteErrorModal from '@/components/DeleteErrorModal';

interface Device {
  id: string;
  serialNumber: string;
  assetTag: string;
  status: string;
  installedAt: string;
  model?: {
    id: string;
    manufacturer: string;
    model: string;
  };
  site?: {
    id: string;
    name: string;
  };
  contract?: {
    id: string;
    contractName: string;
    contractNumber: string;
  };
  createdAt: string;
}

interface Organization {
  id: string;
  name: string;
  code: string;
}

interface Site {
  id: string;
  name: string;
  orgId: string;
}

interface Contract {
  id: string;
  contractName: string;
  contractNumber: string;
  orgId: string;
}

interface DeviceModel {
  id: string;
  manufacturer: string;
  model: string;
  deviceType?: string;
  specs?: {
    platform_size?: string;
    platform_count?: number;
    max_weight?: number;
    min_weight?: number;
    precision?: string;
  };
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [allSites, setAllSites] = useState<Site[]>([]);
  const [allContracts, setAllContracts] = useState<Contract[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [formData, setFormData] = useState({
    orgId: '',
    siteId: '',
    contractId: '',
    modelId: '',
    serialNumber: '',
    assetTag: '',
    status: 'NORMAL',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorData, setErrorData] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    // Only get user on client side to avoid hydration mismatch
    setCurrentUser(authUtils.getUser());
    
    if (!authUtils.isAuthenticated()) {
      router.push('/login');
      return;
    }
    loadInitialData();
  }, [router]);

  useEffect(() => {
    if (selectedOrgId) {
      loadDevicesByOrg(selectedOrgId);
    }
  }, [selectedOrgId]);

  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      const [orgsRes, sitesRes, contractsRes, modelsRes] = await Promise.all([
        apiService.organizations.getAll(),
        apiService.sites.getAll(),
        apiService.contracts.getAll(),
        apiService.deviceModels.getAll(),
      ]);
      
      setOrganizations(orgsRes.data || []);
      setAllSites(sitesRes.data || []);
      setAllContracts(contractsRes.data || []);
      setDeviceModels(modelsRes.data || []);
      setError('');
      
      // Load first organization's devices by default
      if (orgsRes.data && orgsRes.data.length > 0) {
        setSelectedOrgId(orgsRes.data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load data:', err);
      setError('Өгөгдөл ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDevicesByOrg = async (orgId: string) => {
    try {
      const response = await apiService.devices.getByOrganization(orgId);
      setDevices(response.data || []);
    } catch (err: any) {
      console.error('Failed to load devices:', err);
      setError('Төхөөрөмжүүдийг ачаалахад алдаа гарлаа');
    }
  };

  const handleCreate = () => {
    setEditingDevice(null);
    setFormData({
      orgId: selectedOrgId || '',
      siteId: '',
      contractId: '',
      modelId: '',
      serialNumber: '',
      assetTag: '',
      status: 'NORMAL',
    });
    setShowModal(true);
  };

  const handleEdit = (device: Device) => {
    setEditingDevice(device);
    // Need to get orgId from site or contract
    const site = allSites.find(s => s?.id === device?.site?.id) || null;
    const contract = allContracts.find(c => c?.id === device?.contract?.id) || null;
    setFormData({
      orgId: site?.orgId || contract?.orgId || selectedOrgId || '',
      siteId: device?.site?.id || '',
      contractId: device?.contract?.id || '',
      modelId: device?.model?.id || '',
      serialNumber: device.serialNumber,
      assetTag: device.assetTag,
      status: device.status,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Та "${name}" төхөөрөмжийг устгахдаа итгэлтэй байна уу?\n\nАнхааруулга: Хэрэв энэ төхөөрөмжтэй холбоотой үзлэг байвал устгаж чадахгүй!`)) {
      return;
    }

    try {
      await apiService.devices.delete(id);
      
      // Always refresh the list after deletion
      if (selectedOrgId) {
        await loadDevicesByOrg(selectedOrgId);
      }
      
      alert('✓ Төхөөрөмжийг амжилттай устгалаа! MySQL-аас хадгалалт устгагдсан.');
    } catch (err: any) {
      
      // Check if error has detailed information
      if (err.response?.data?.inspections) {
        setErrorData({
          message: err.response.data.message,
          inspections: err.response.data.inspections,
        });
        setShowErrorModal(true);
      } else {
        const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Устгахад алдаа гарлаа';
        alert('❌ ' + errorMessage);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.orgId || !formData.siteId || !formData.contractId || 
        !formData.modelId || !formData.serialNumber || !formData.assetTag) {
      alert('Бүх шаардлагатай талбаруудыг бөглөнө үү');
      return;
    }

    try {
      setIsSaving(true);
      if (editingDevice) {
        await apiService.devices.update(editingDevice.id, formData);
        alert('✓ Төхөөрөмжийг амжилттай шинэчлэлээ!');
      } else {
        await apiService.devices.create(formData);
        alert('✓ Төхөөрөмжийг амжилттай үүсгэлээ!');
      }
      setShowModal(false);
      if (selectedOrgId) {
        await loadDevicesByOrg(selectedOrgId);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Хадгалахад алдаа гарлаа';
      alert('❌ ' + errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // Filter sites and contracts based on selected organization
  const availableSites = allSites.filter(site => site.orgId === formData.orgId);
  const availableContracts = allContracts.filter(contract => contract.orgId === formData.orgId);

  const getStatusBadge = (status: string) => {
    const statusMap: any = {
      'NORMAL': { bg: 'bg-green-100', text: 'text-green-800', label: 'Хэвийн' },
      'IN_SERVICE': { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Ажиллаж байгаа' },
      'MAINTENANCE': { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Засвар' },
      'INSTALLED': { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Суурилуулсан' },
      'IN_STOCK': { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Агуулахад' },
    };
    const badge = statusMap[status] || statusMap['NORMAL'];
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
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
      <Sidebar currentUser={currentUser} />

      <div className="flex-1 ml-64 flex flex-col">
        <TopNavbar />
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4 flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Төхөөрөмж удирдах</h1>
              <p className="text-sm text-gray-500">Төхөөрөмжүүдийн жагсаалт</p>
            </div>
            <button
              onClick={handleCreate}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
              disabled={!selectedOrgId}
            >
              <span>+</span> Нэмэх
            </button>
          </div>
        </header>

        <main className="p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
              <div className="text-red-800">{error}</div>
              <button 
                onClick={loadInitialData}
                className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
              >
                Дахин оролдох
              </button>
            </div>
          )}

          {/* Organization Filter */}
          <div className="mb-6 bg-white p-4 rounded-lg shadow">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Байгууллага сонгох:
            </label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full md:w-96 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">Сонгоно уу</option>
              {organizations.map(org => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.code})
                </option>
              ))}
            </select>
          </div>

          {selectedOrgId ? (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Сериал дугаар
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Хөрөнгийн таг
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Загвар
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Талбай
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Статус
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Үйлдэл
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {devices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        Төхөөрөмж олдсонгүй
                      </td>
                    </tr>
                  ) : (
                    devices.map((device) => (
                      <tr key={device.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{device.serialNumber}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{device.assetTag}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {device.model ? (
                            <div>
                              <div className="text-sm font-medium text-gray-900">{device.model.manufacturer}</div>
                              <div className="text-xs text-gray-500">{device.model.model}</div>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {device.site?.name || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(device.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleEdit(device)}
                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                          >
                            Засах
                          </button>
                          <button
                            onClick={() => handleDelete(device.id, device.serialNumber)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Устгах
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white shadow sm:rounded-md p-12 text-center text-gray-500">
              Байгууллага сонгоно уу
            </div>
          )}
        </main>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-10 mx-auto p-5 border w-[600px] shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                {editingDevice ? 'Төхөөрөмж засах' : 'Шинэ төхөөрөмж нэмэх'}
              </h3>
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Байгууллага *
                  </label>
                  <select
                    value={formData.orgId}
                    onChange={(e) => setFormData({ ...formData, orgId: e.target.value, siteId: '', contractId: '' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    required
                  >
                    <option value="">Сонгоно уу</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.code})
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Талбай *
                    </label>
                    <select
                      value={formData.siteId}
                      onChange={(e) => setFormData({ ...formData, siteId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      required
                      disabled={!formData.orgId}
                    >
                      <option value="">Сонгоно уу</option>
                      {availableSites.map(site => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Гэрээ *
                    </label>
                    <select
                      value={formData.contractId}
                      onChange={(e) => setFormData({ ...formData, contractId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      required
                      disabled={!formData.orgId}
                    >
                      <option value="">Сонгоно уу</option>
                      {availableContracts.map(contract => (
                        <option key={contract.id} value={contract.id}>
                          {contract.contractNumber}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Загвар *
                  </label>
                  <select
                    value={formData.modelId}
                    onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    required
                  >
                    <option value="">Сонгоно уу</option>
                    {deviceModels.map(model => {
                      // Format platform size (e.g., "3*1.5" -> "3м x 1.5м")
                      let platformSizeText = '';
                      if (model.specs?.platform_size) {
                        const sizeStr = model.specs.platform_size.toString();
                        if (sizeStr.includes('*')) {
                          const parts = sizeStr.split('*');
                          platformSizeText = ` • ${parts[0].trim()}м x ${parts[1].trim()}м`;
                        } else {
                          platformSizeText = ` • ${sizeStr}`;
                        }
                      }
                      
                      // Format device type
                      const deviceTypeText = model.deviceType 
                        ? ` • ${model.deviceType === 'ANALOG' ? 'Аналог' : model.deviceType === 'DIGITAL' ? 'Дижитал' : model.deviceType}`
                        : '';
                      
                      // Format platform count
                      const platformCountText = model.specs?.platform_count 
                        ? ` • Тавцан: ${model.specs.platform_count}`
                        : '';
                      
                      return (
                        <option key={model.id} value={model.id}>
                          {model.manufacturer} {model.model}{deviceTypeText}{platformSizeText}{platformCountText}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Сериал дугаар *
                    </label>
                    <input
                      type="text"
                      value={formData.serialNumber}
                      onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Жишээ: EU2025001"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Хөрөнгийн таг *
                    </label>
                    <input
                      type="text"
                      value={formData.assetTag}
                      onChange={(e) => setFormData({ ...formData, assetTag: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Жишээ: Хөрөнгө EU-8"
                      required
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Статус
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="NORMAL">Хэвийн</option>
                    <option value="IN_SERVICE">Ажиллаж байгаа</option>
                    <option value="MAINTENANCE">Засвар</option>
                    <option value="INSTALLED">Суурилуулсан</option>
                    <option value="IN_STOCK">Агуулахад</option>
                  </select>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    disabled={isSaving}
                  >
                    Цуцлах
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    disabled={isSaving}
                  >
                    {isSaving ? 'Хадгалж байна...' : 'Хадгалах'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Error Modal */}
      {showErrorModal && errorData && (
        <DeleteErrorModal
          isOpen={showErrorModal}
          onClose={() => {
            setShowErrorModal(false);
            setErrorData(null);
          }}
          errorData={errorData}
        />
      )}
    </div>
  );
}

