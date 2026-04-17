'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Repair {
  id: string;
  inspectionId: string;
  fieldId: string;
  section: string;
  questionText: string;
  originalStatus: string;
  description: string;
  repairStatus: string;
  repairedBy: string;
  repairedAt: string;
  verifiedBy: string;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
  inspection: {
    id: string;
    title: string;
    status: string;
    device: {
      serialNumber: string;
      assetTag: string;
      model: {
        manufacturer: string;
        model: string;
      };
    };
  };
  repairer: {
    id: string;
    fullName: string;
    email: string;
  };
  images: Array<{
    id: string;
    imageUrl: string;
    fileName: string;
    uploadedAt: string;
  }>;
}

export default function RepairAnswersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const initializePage = async () => {
      // Check if user is authenticated
      if (!authUtils.isAuthenticated()) {
        router.push('/login');
        return;
      }

      // Get user data
      const currentUser = authUtils.getUser();
      if (currentUser) {
        setUser(currentUser);
      }

      // Load repairs
      await loadRepairs();
    };

    initializePage();
  }, [router]);

  const loadRepairs = async (page = 1) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.repairs.getAll({
        page,
        limit: 20
      });
      
      setRepairs(response.data || []);
      setCurrentPage(response.pagination?.page || 1);
      setTotalPages(response.pagination?.pages || 1);
      setTotalCount(response.pagination?.total || 0);
    } catch (err: any) {
      console.error('Failed to load repairs:', err);
      setError('Засваруудыг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    loadRepairs(page);
  };

  const getRepairStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800';
      case 'COMPLETED': return 'bg-green-100 text-green-800';
      case 'VERIFIED': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRepairStatusText = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'Хүлээгдэж буй';
      case 'IN_PROGRESS': return 'Хийгдэж байна';
      case 'COMPLETED': return 'Дууссан';
      case 'VERIFIED': return 'Баталгаажсан';
      default: return status || 'Тодорхойгүй';
    }
  };

  if (isLoading && !user) {
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
      {/* Sidebar */}
      <Sidebar currentUser={user} />

      {/* Main Content */}
      <div className="flex-1 ml-64">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">Засварын Тайлан</h1>
                <p className="text-sm text-gray-500">Хийгдсэн засварын мэдээлэл</p>
              </div>
              <div>
                <button
                  onClick={() => loadRepairs(currentPage)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  🔄 Шинэчлэх
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800">{error}</div>
            <button 
              onClick={() => loadRepairs(currentPage)}
              className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
            >
              Дахин ачаалах
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 bg-white p-6 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">{totalCount}</div>
              <div className="text-sm text-gray-500">Нийт засвар</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {repairs.filter(r => r.repairStatus === 'PENDING').length}
              </div>
              <div className="text-sm text-gray-500">Хүлээгдэж буй</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {repairs.filter(r => r.repairStatus === 'COMPLETED').length}
              </div>
              <div className="text-sm text-gray-500">Дууссан</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-teal-600">
                {repairs.filter(r => r.repairStatus === 'VERIFIED').length}
              </div>
              <div className="text-sm text-gray-500">Баталгаажсан</div>
            </div>
          </div>
        </div>

        {/* Repairs Table */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Засварын мэдээлэл
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Бүх засварын мэдээлэл, төлөв
                </p>
              </div>
              <button
                onClick={() => loadRepairs(currentPage)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Шинэчлэх
              </button>
            </div>
          </div>
          
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-gray-500">Ачаалж байна...</p>
            </div>
          ) : repairs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Засварын мэдээлэл олдсонгүй</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-200">
                {repairs.map((repair) => (
                  <li key={repair.id}>
                    <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3">
                            <h4 className="text-sm font-medium text-gray-900 truncate">
                              {repair.inspection?.title || 'Тодорхойгүй үзлэг'}
                            </h4>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRepairStatusColor(repair.repairStatus)}`}>
                              {getRepairStatusText(repair.repairStatus)}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
                            <div>
                              <span className="font-medium">Хэсэг:</span> {repair.section}
                            </div>
                            <div>
                              <span className="font-medium">Талбар:</span> {repair.questionText || repair.fieldId}
                            </div>
                            <div>
                              <span className="font-medium">Төхөөрөмж:</span> {repair.inspection?.device?.serialNumber} ({repair.inspection?.device?.assetTag})
                            </div>
                            {repair.repairer && (
                              <div>
                                <span className="font-medium">Засварчин:</span> {repair.repairer.fullName}
                              </div>
                            )}
                          </div>
                          {repair.originalStatus && (
                            <div className="mt-1 text-sm text-gray-500">
                              <span className="font-medium">Анхны төлөв:</span> {repair.originalStatus}
                            </div>
                          )}
                          {repair.description && (
                            <div className="mt-1 text-sm text-gray-600">
                              <span className="font-medium">Тайлбар:</span> {repair.description.substring(0, 100)}{repair.description.length > 100 ? '...' : ''}
                            </div>
                          )}
                          <div className="mt-1 text-sm text-gray-500">
                            <span>Үүсгэсэн: {new Date(repair.createdAt).toLocaleDateString('mn-MN')}</span>
                            {repair.repairedAt && (
                              <span className="ml-4">Засварласан: {new Date(repair.repairedAt).toLocaleDateString('mn-MN')}</span>
                            )}
                            {repair.verifiedAt && (
                              <span className="ml-4">Баталгаажсан: {new Date(repair.verifiedAt).toLocaleDateString('mn-MN')}</span>
                            )}
                          </div>
                          {repair.images && repair.images.length > 0 && (
                            <div className="mt-2 text-sm text-gray-500">
                              <span className="font-medium">Зураг:</span> {repair.images.length} ширхэг
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/repair-answers/${repair.id}`)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium"
                          >
                            Дэлгэрэнгүй
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                  <div className="flex-1 flex justify-between sm:hidden">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Өмнөх
                    </button>
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Дараах
                    </button>
                  </div>
                  <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{(currentPage - 1) * 20 + 1}</span>
                        {' - '}
                        <span className="font-medium">{Math.min(currentPage * 20, totalCount)}</span>
                        {' / '}
                        <span className="font-medium">{totalCount}</span>
                        {' үр дүн'}
                      </p>
                    </div>
                    <div>
                      <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                        <button
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1}
                          className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Өмнөх
                        </button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          const page = Math.max(1, currentPage - 2) + i;
                          if (page > totalPages) return null;
                          return (
                            <button
                              key={page}
                              onClick={() => handlePageChange(page)}
                              className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                page === currentPage
                                  ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {page}
                            </button>
                          );
                        })}
                        <button
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === totalPages}
                          className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Дараах
                        </button>
                      </nav>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}




