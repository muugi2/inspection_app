'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import fileDownload from 'js-file-download';

interface InspectionAnswer {
  id: string;
  inspectionId: string;
  answers: any;
  answeredBy: string;
  answeredAt: string;
  createdAt: string;
  updatedAt: string;
  inspection: {
    id: string;
    title: string;
    type: string;
    status: string;
    device: {
      serialNumber: string;
      assetTag: string;
      model: {
        manufacturer: string;
        model: string;
      };
      site: {
        name: string;
        organization: {
          name: string;
          code: string;
        };
      };
    };
    assignee: {
      fullName: string;
      organization: {
        name: string;
      };
    };
  };
  user: {
    fullName: string;
    organization: {
      name: string;
    };
  };
}

interface Repair {
  id: string;
  inspectionId: string;
  fieldId: string;
  section: string;
  questionText: string;
  originalStatus: string;
  repairDescription: string;
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

type TabType = 'inspection' | 'repair';

export default function InspectionAnswersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('inspection');
  const [answers, setAnswers] = useState<InspectionAnswer[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRepairs, setIsLoadingRepairs] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [repairCurrentPage, setRepairCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [repairTotalPages, setRepairTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [repairTotalCount, setRepairTotalCount] = useState(0);
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

      // Load data based on active tab
      if (activeTab === 'inspection') {
        await loadInspectionAnswers();
      } else {
        await loadRepairs();
      }
    };

    initializePage();
  }, [router, activeTab]);

  const loadInspectionAnswers = async (page = 1) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.inspectionAnswers.getAll({
        page,
        limit: 20
      });
      
      setAnswers(response.data || []);
      setCurrentPage(response.pagination?.page || 1);
      setTotalPages(response.pagination?.pages || 1);
      setTotalCount(response.pagination?.total || 0);
    } catch (err: any) {
      console.error('Failed to load inspection answers:', err);
      setError('Үзлэгийн хариултуудыг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
    }
  };

  const loadRepairs = async (page = 1) => {
    try {
      setIsLoadingRepairs(true);
      setError('');
      const response = await apiService.repairs.getAll({
        page,
        limit: 20
      });
      
      setRepairs(response.data || []);
      setRepairCurrentPage(response.pagination?.page || 1);
      setRepairTotalPages(response.pagination?.pages || 1);
      setRepairTotalCount(response.pagination?.total || 0);
    } catch (err: any) {
      console.error('Failed to load repairs:', err);
      setError('Засваруудыг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoadingRepairs(false);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    loadInspectionAnswers(page);
  };

  const handleRepairPageChange = (page: number) => {
    setRepairCurrentPage(page);
    loadRepairs(page);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setError('');
    if (tab === 'inspection') {
      if (answers.length === 0) {
        loadInspectionAnswers();
      }
    } else {
      if (repairs.length === 0) {
        loadRepairs();
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRepairStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'COMPLETED': return 'bg-blue-100 text-blue-800';
      case 'VERIFIED': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRepairStatusText = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'Хүлээгдэж буй';
      case 'COMPLETED': return 'Дууссан';
      case 'VERIFIED': return 'Баталгаажсан';
      default: return status || 'Тодорхойгүй';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'inspection': return 'bg-blue-100 text-blue-800';
      case 'maintenance': return 'bg-orange-100 text-orange-800';
      case 'installation': return 'bg-purple-100 text-purple-800';
      case 'verification': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatAnswers = (answers: any) => {
    if (!answers) return 'Хариулт байхгүй';
    
    try {
      const parsed = typeof answers === 'string' ? JSON.parse(answers) : answers;
      const sections = Object.keys(parsed);
      return `${sections.length} хэсэг`;
    } catch {
      return 'Хариулт байхгүй';
    }
  };

  const isLoadingData = activeTab === 'inspection' ? isLoading : isLoadingRepairs;

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
                <h1 className="text-xl font-bold text-gray-900">Үзлэгийн Тайлан</h1>
                <p className="text-sm text-gray-500">Хийгдсэн үзлэг болон засварын мэдээлэл</p>
              </div>
              <div>
                <button
                  onClick={() => activeTab === 'inspection' ? loadInspectionAnswers(currentPage) : loadRepairs(repairCurrentPage)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  🔄 Шинэчлэх
                </button>
              </div>
            </div>
            
            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => handleTabChange('inspection')}
                  className={`${
                    activeTab === 'inspection'
                      ? 'border-indigo-500 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                >
                  Үзлэг
                </button>
                <button
                  onClick={() => handleTabChange('repair')}
                  className={`${
                    activeTab === 'repair'
                      ? 'border-indigo-500 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                >
                  Засвар
                </button>
              </nav>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800">{error}</div>
            <button 
              onClick={() => activeTab === 'inspection' ? loadInspectionAnswers(currentPage) : loadRepairs(repairCurrentPage)}
              className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
            >
              Дахин ачаалах
            </button>
          </div>
        )}

        {/* Stats */}
        {activeTab === 'inspection' && (
          <div className="mb-6 bg-white p-6 rounded-lg shadow">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600">{totalCount}</div>
                <div className="text-sm text-gray-500">Нийт хариулт</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {answers.filter(a => a.inspection.status === 'approved').length}
                </div>
                <div className="text-sm text-gray-500">Зөвшөөрөгдсөн</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {answers.filter(a => a.inspection.status === 'submitted').length}
                </div>
                <div className="text-sm text-gray-500">Илгээсэн</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'repair' && (
          <div className="mb-6 bg-white p-6 rounded-lg shadow">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600">{repairTotalCount}</div>
                <div className="text-sm text-gray-500">Нийт засвар</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {repairs.filter(r => r.repairStatus === 'PENDING').length}
                </div>
                <div className="text-sm text-gray-500">Хүлээгдэж буй</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {repairs.filter(r => r.repairStatus === 'COMPLETED').length}
                </div>
                <div className="text-sm text-gray-500">Дууссан</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {repairs.filter(r => r.repairStatus === 'VERIFIED').length}
                </div>
                <div className="text-sm text-gray-500">Баталгаажсан</div>
              </div>
            </div>
          </div>
        )}

        {/* Inspection Answers Table */}
        {activeTab === 'inspection' && (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Үзлэгийн хариултууд
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-gray-500">
                    Бүх хийгдсэн үзлэг, шалгалтын хариултууд
                  </p>
                </div>
                <button
                  onClick={() => loadInspectionAnswers(currentPage)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  Шинэчлэх
                </button>
              </div>
            </div>
            
            {isLoadingData ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                <p className="mt-2 text-gray-500">Ачаалж байна...</p>
              </div>
            ) : answers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Үзлэгийн хариулт олдсонгүй</p>
              </div>
            ) : (
            <>
              <ul className="divide-y divide-gray-200">
                {answers.map((answer) => (
                  <li key={answer.id}>
                    <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3">
                            <h4 className="text-sm font-medium text-gray-900 truncate">
                              {answer.inspection.title}
                            </h4>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeColor(answer.inspection.type)}`}>
                              {answer.inspection.type}
                            </span>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(answer.inspection.status)}`}>
                              {answer.inspection.status}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
                            <div>
                              <span className="font-medium">Төхөөрөмж:</span> {answer.inspection.device?.serialNumber} ({answer.inspection.device?.assetTag})
                            </div>
                            <div>
                              <span className="font-medium">Хариуцсан:</span> {answer.inspection.assignee?.fullName}
                            </div>
                            <div>
                              <span className="font-medium">Хариулсан:</span> {answer.user?.fullName}
                            </div>
                            <div>
                              <span className="font-medium">Хариулт:</span> {formatAnswers(answer.answers)}
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-gray-500">
                            <span>Хариулсан: {new Date(answer.answeredAt).toLocaleDateString('mn-MN')} {new Date(answer.answeredAt).toLocaleTimeString('mn-MN')}</span>
                            <span className="ml-4">Үүсгэсэн: {new Date(answer.createdAt).toLocaleDateString('mn-MN')}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/inspection-answers/${answer.id}`)}
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
        )}

        {/* Repairs Table */}
        {activeTab === 'repair' && (
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
                  onClick={() => loadRepairs(repairCurrentPage)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
                >
                  Шинэчлэх
                </button>
              </div>
            </div>
            
            {isLoadingData ? (
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
                            {repair.repairDescription && (
                              <div className="mt-1 text-sm text-gray-600">
                                <span className="font-medium">Тайлбар:</span> {repair.repairDescription.substring(0, 100)}{repair.repairDescription.length > 100 ? '...' : ''}
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
                            {repair.inspectionId && (
                              <button
                                onClick={async () => {
                                  try {
                                    const blob = await apiService.reports.downloadRepairDocx(repair.inspectionId);
                                    fileDownload(blob, `repair-report-${repair.inspectionId}.docx`);
                                  } catch (err: any) {
                                    let errorMessage = 'Засварын тайлан татах явцад алдаа гарлаа.';
                                    if (err?.response?.data) {
                                      const errorData = err.response.data;
                                      errorMessage = errorData.message || errorData.error || errorMessage;
                                    } else if (err?.message) {
                                      errorMessage = err.message;
                                    }
                                    alert(errorMessage);
                                  }
                                }}
                                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium"
                              >
                                Тайлан татах
                              </button>
                            )}
                            <button
                              onClick={() => router.push(`/repairs/${repair.id}`)}
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
                {repairTotalPages > 1 && (
                  <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                    <div className="flex-1 flex justify-between sm:hidden">
                      <button
                        onClick={() => handleRepairPageChange(repairCurrentPage - 1)}
                        disabled={repairCurrentPage === 1}
                        className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        Өмнөх
                      </button>
                      <button
                        onClick={() => handleRepairPageChange(repairCurrentPage + 1)}
                        disabled={repairCurrentPage === repairTotalPages}
                        className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        Дараах
                      </button>
                    </div>
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">{(repairCurrentPage - 1) * 20 + 1}</span>
                          {' - '}
                          <span className="font-medium">{Math.min(repairCurrentPage * 20, repairTotalCount)}</span>
                          {' / '}
                          <span className="font-medium">{repairTotalCount}</span>
                          {' үр дүн'}
                        </p>
                      </div>
                      <div>
                        <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                          <button
                            onClick={() => handleRepairPageChange(repairCurrentPage - 1)}
                            disabled={repairCurrentPage === 1}
                            className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Өмнөх
                          </button>
                          {Array.from({ length: Math.min(5, repairTotalPages) }, (_, i) => {
                            const page = Math.max(1, repairCurrentPage - 2) + i;
                            if (page > repairTotalPages) return null;
                            return (
                              <button
                                key={page}
                                onClick={() => handleRepairPageChange(page)}
                                className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                  page === repairCurrentPage
                                    ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => handleRepairPageChange(repairCurrentPage + 1)}
                            disabled={repairCurrentPage === repairTotalPages}
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
        )}
        </main>
      </div>
    </div>
  );
}

