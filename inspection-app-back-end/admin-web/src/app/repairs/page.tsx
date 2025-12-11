'use client';

import { useState, useEffect } from 'react';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import TopNavbar from '@/components/TopNavbar';
import { useRouter } from 'next/navigation';

interface Repair {
  id: string;
  inspectionId: string;
  fieldId: string;
  section: string;
  questionText: string;
  originalStatus?: string;
  description?: string;
  repairStatus: string;
  createdAt: string;
  updatedAt: string;
  repairedAt?: string;
  verifiedAt?: string;
  inspection?: {
    id: string;
    title: string;
    device?: {
      id: string;
      serialNumber: string;
      assetTag?: string;
      model?: {
        manufacturer: string;
        model: string;
      };
    };
  };
  creator?: {
    id: string;
    fullName: string;
    email: string;
  };
  repairer?: {
    id: string;
    fullName: string;
    email: string;
  };
}

export default function RepairsPage() {
  const router = useRouter();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedInspectionId, setSelectedInspectionId] = useState<string>('');

  useEffect(() => {
    fetchRepairs();
  }, [filterStatus, selectedInspectionId]);

  const fetchRepairs = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      if (selectedInspectionId) params.inspectionId = selectedInspectionId;

      const response = await apiService.repairs.getAll(params);
      setRepairs(response.data || []);
    } catch (error: any) {
      console.error('Failed to fetch repairs:', error);
      alert('❌ ' + (error.response?.data?.message || error.message || 'Засваруудыг ачаалахад алдаа гарлаа'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case 'PENDING':
        return 'bg-orange-100 text-orange-800';
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'VERIFIED':
        return 'bg-teal-100 text-teal-800';
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status.toUpperCase()) {
      case 'PENDING':
        return 'Хүлээгдэж байна';
      case 'IN_PROGRESS':
        return 'Хийгдэж байна';
      case 'COMPLETED':
        return 'Дууссан';
      case 'VERIFIED':
        return 'Баталгаажсан';
      case 'CANCELLED':
        return 'Цуцлагдсан';
      default:
        return status;
    }
  };

  const handleRepairClick = (repair: Repair) => {
    router.push(`/repairs/${repair.id}`);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Засварууд</h1>
              <p className="text-gray-600 mt-1">Үзлэгээс үүссэн засварын мэдээлэл</p>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Төлөвөөр шүүх
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Бүгд</option>
                    <option value="PENDING">Хүлээгдэж байна</option>
                    <option value="IN_PROGRESS">Хийгдэж байна</option>
                    <option value="COMPLETED">Дууссан</option>
                    <option value="VERIFIED">Баталгаажсан</option>
                    <option value="CANCELLED">Цуцлагдсан</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Үзлэгийн ID
                  </label>
                  <input
                    type="text"
                    value={selectedInspectionId}
                    onChange={(e) => setSelectedInspectionId(e.target.value)}
                    placeholder="Үзлэгийн ID оруулах"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    onClick={fetchRepairs}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                  >
                    Шүүх
                  </button>
                </div>
              </div>
            </div>

            {/* Repairs List */}
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <p className="mt-2 text-gray-600">Ачааллаж байна...</p>
              </div>
            ) : repairs.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <p className="text-gray-500">Одоогоор засвар алга.</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Үзлэг
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Асуулт
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Section
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Төлөв
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Огноо
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Үйлдэл
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {repairs.map((repair) => (
                      <tr
                        key={repair.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleRepairClick(repair)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {repair.inspection?.title || `Үзлэг #${repair.inspectionId}`}
                            </div>
                            {repair.inspection?.device && (
                              <div className="text-sm text-gray-500">
                                {repair.inspection.device.serialNumber}
                                {repair.inspection.device.model && 
                                  ` • ${repair.inspection.device.model.manufacturer} ${repair.inspection.device.model.model}`
                                }
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate">
                            {repair.questionText}
                          </div>
                          {repair.originalStatus && (
                            <div className="text-xs text-gray-500 mt-1">
                              Анхны төлөв: {repair.originalStatus}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {repair.section}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                              repair.repairStatus
                            )}`}
                          >
                            {getStatusText(repair.repairStatus)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(repair.createdAt).toLocaleDateString('mn-MN')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRepairClick(repair);
                            }}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Дэлгэрэнгүй
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}



