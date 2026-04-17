'use client';

import fileDownload from 'js-file-download';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import A4Preview from '@/components/A4Preview';

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
  verifier?: {
    id: string;
    fullName: string;
    email: string;
  };
  images?: Array<{
    order: number;
    fileName: string;
    imageUrl: string;
    relativePath: string;
    fileSize?: number;
    mimeType?: string;
    uploadedAt?: string;
  }>;
}

export default function RepairDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, setUser] = useState<User | null>(null);
  const [repair, setRepair] = useState<Repair | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [repairId, setRepairId] = useState<string | null>(null);

  const router = useRouter();
  const resolvedParams = use(params);

  useEffect(() => {
    let id = resolvedParams?.id;
    
    if (!id && typeof window !== 'undefined') {
      const pathParts = window.location.pathname.split('/');
      id = pathParts[pathParts.length - 1];
    }
    
    if (id) {
      setRepairId(id);
    } else {
      setError('Засварын ID олдсонгүй');
      setIsLoading(false);
    }
  }, [resolvedParams?.id]);

  useEffect(() => {
    const initializePage = async () => {
      if (!repairId) return;
      
      try {
        if (!authUtils.isAuthenticated()) {
          router.push('/login');
          return;
        }

        const currentUser = authUtils.getUser();
        if (currentUser) {
          setUser(currentUser);
        }

        await loadRepair(repairId);
      } catch (err) {
        console.error('Error initializing page:', err);
        setError('Хуудсыг ачаалахад алдаа гарлаа');
        setIsLoading(false);
      }
    };

    initializePage();
  }, [router, repairId]);

  const loadRepair = async (id: string) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.repairs.getById(id);
      setRepair(response.data);
    } catch (err) {
      console.error('Failed to load repair:', err);
      setError('Засварын мэдээллийг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800';
      case 'COMPLETED': return 'bg-green-100 text-green-800';
      case 'VERIFIED': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'Хүлээгдэж буй';
      case 'IN_PROGRESS': return 'Хийгдэж байна';
      case 'COMPLETED': return 'Дууссан';
      case 'VERIFIED': return 'Баталгаажсан';
      default: return status || 'Тодорхойгүй';
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

  if (!repair) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-500">Засварын мэдээлэл олдсонгүй</p>
          <button
            onClick={() => router.push('/repair-answers')}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Буцах
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar currentUser={user} />

      <div className="flex-1 ml-64">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <button
                  onClick={() => router.push('/repair-answers')}
                  className="text-indigo-600 hover:text-indigo-800 mb-2 text-sm font-medium"
                >
                  ← Буцах
                </button>
                <h1 className="text-xl font-bold text-gray-900">Засварын тайлан</h1>
                <p className="text-sm text-gray-500">Засварын дэлгэрэнгүй мэдээлэл</p>
              </div>
              <div className="flex items-center gap-3">
                {repair?.inspectionId && (
                  <button
                    onClick={async () => {
                      try {
                        // Зөвхөн тухайн засварын DOCX татах (repair.id дамжуулах)
                        const blob = await apiService.reports.downloadRepairDocx(
                          repair.inspectionId,
                          repair.id
                        );
                        fileDownload(blob, `repair-report-${repair.id}.docx`);
                      } catch (err: any) {
                        // Extract error message from response
                        let errorMessage = 'DOCX татах явцад алдаа гарлаа.';
                        if (err?.response?.data) {
                          const errorData = err.response.data;
                          errorMessage = errorData.message || errorData.error || errorMessage;
                        } else if (err?.message) {
                          errorMessage = err.message;
                        }
                        
                        setError(`DOCX татах алдаа: ${errorMessage}`);
                      }
                    }}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    DOCX татах
                  </button>
                )}
                <div className="text-right hidden md:block">
                  <p className="text-sm font-medium text-gray-900">{user?.fullName}</p>
                  <p className="text-sm text-gray-500">{user?.organization?.name}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800">{error}</div>
            <button 
              onClick={() => repairId && loadRepair(repairId)}
              className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
            >
              Дахин ачаалах
            </button>
          </div>
        )}

        <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Засварын мэдээлэл</h3>
            <p className="mt-1 text-sm text-gray-500">
              A4 хэлбэрийн тайланг preview болон DOCX татах товчоор нээн харж болно.
            </p>
          </div>
          <div className="border-t border-gray-200 px-4 py-6 sm:px-6 space-y-3 text-sm text-gray-700">
            <p><span className="font-semibold text-gray-900">Засварын ID:</span> {repair.id}</p>
            <p><span className="font-semibold text-gray-900">Үзлэг:</span> {repair.inspection?.title ?? 'Мэдээлэл байхгүй'}</p>
            <p><span className="font-semibold text-gray-900">Төхөөрөмж:</span> {repair.inspection?.device?.serialNumber} ({repair.inspection?.device?.assetTag})</p>
            {repair.inspection?.device?.model && (
              <p><span className="font-semibold text-gray-900">Загвар:</span> {repair.inspection.device.model.manufacturer} {repair.inspection.device.model.model}</p>
            )}
            <p><span className="font-semibold text-gray-900">Хэсэг:</span> {repair.section}</p>
            <p><span className="font-semibold text-gray-900">Талбар:</span> {repair.questionText || repair.fieldId}</p>
            {repair.originalStatus && (
              <p><span className="font-semibold text-gray-900">Анхны төлөв:</span> {repair.originalStatus}</p>
            )}
            {repair.description && (
              <p><span className="font-semibold text-gray-900">Тайлбар:</span> {repair.description}</p>
            )}
            <p>
              <span className="font-semibold text-gray-900">Төлөв:</span>{' '}
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(repair.repairStatus)}`}>
                {getStatusText(repair.repairStatus)}
              </span>
            </p>
            <p><span className="font-semibold text-gray-900">Үүсгэсэн огноо:</span> {new Date(repair.createdAt).toLocaleString('mn-MN')}</p>
            {repair.repairedAt && (
              <p><span className="font-semibold text-gray-900">Засварласан огноо:</span> {new Date(repair.repairedAt).toLocaleString('mn-MN')}</p>
            )}
            {repair.verifiedAt && (
              <p><span className="font-semibold text-gray-900">Баталгаажсан огноо:</span> {new Date(repair.verifiedAt).toLocaleString('mn-MN')}</p>
            )}
            {repair.creator && (
              <p><span className="font-semibold text-gray-900">Үүсгэгч:</span> {repair.creator.fullName}</p>
            )}
            {repair.repairer && (
              <p><span className="font-semibold text-gray-900">Засварчин:</span> {repair.repairer.fullName}</p>
            )}
            {repair.verifier && (
              <p><span className="font-semibold text-gray-900">Баталгаажуулагч:</span> {repair.verifier.fullName}</p>
            )}
            {repair.images && repair.images.length > 0 && (
              <p><span className="font-semibold text-gray-900">Зургууд:</span> {repair.images.length} ширхэг</p>
            )}
          </div>
        </div>

        {repair?.inspectionId && (
          <A4Preview repairInspectionId={repair.inspectionId} repairId={repair.id} />
        )}
      </main>
      </div>
    </div>
  );
}

