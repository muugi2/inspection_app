'use client';

import fileDownload from 'js-file-download';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import A4Preview from '@/components/A4Preview';

interface InspectionAnswer {
  id: string;
  inspectionId: string;
  answers: any;
  answeredBy: string;
  answeredAt: string;
  createdAt: string;
  updatedAt: string;
  inspection?: {
    id: string;
    title: string;
    type: string;
    status: string;
  };
  user?: {
    fullName: string;
  };
}

export default function InspectionAnswerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, setUser] = useState<User | null>(null);
  const [answer, setAnswer] = useState<InspectionAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const router = useRouter();
  const resolvedParams = use(params);

  useEffect(() => {
    let id = resolvedParams?.id;
    
    if (!id && typeof window !== 'undefined') {
      const pathParts = window.location.pathname.split('/');
      id = pathParts[pathParts.length - 1];
    }
    
    if (id) {
      setAnswerId(id);
    } else {
      setError('Үзлэгийн ID олдсонгүй');
      setIsLoading(false);
    }
  }, [resolvedParams?.id]);

  useEffect(() => {
    const initializePage = async () => {
      if (!answerId) return;
      
      try {
        if (!authUtils.isAuthenticated()) {
          router.push('/login');
          return;
        }

        const currentUser = authUtils.getUser();
        if (currentUser) {
          setUser(currentUser);
        }

        await loadInspectionAnswer(answerId);
      } catch (err) {
        console.error('Error initializing page:', err);
        setError('Хуудсыг ачаалахад алдаа гарлаа');
        setIsLoading(false);
      }
    };

    initializePage();
  }, [router, answerId]);

  const loadInspectionAnswer = async (id: string) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.inspectionAnswers.getById(id);
      const payload = (response as { data?: InspectionAnswer })?.data ?? (response as InspectionAnswer);
      setAnswer(payload);
    } catch (err) {
      console.error('Failed to load inspection answer:', err);
      setError('Үзлэгийн хариултыг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
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

  if (!answer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-500">Үзлэгийн хариулт олдсонгүй</p>
          <button
            onClick={() => router.push('/inspection-answers')}
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
                  onClick={() => router.push('/inspection-answers')}
                  className="text-indigo-600 hover:text-indigo-800 mb-2 text-sm font-medium"
                >
                  ← Буцах
                </button>
                <h1 className="text-xl font-bold text-gray-900">Үзлэгийн хариулт</h1>
                <p className="text-sm text-gray-500">Үзлэгийн дэлгэрэнгүй</p>
              </div>
              <div className="flex items-center gap-3">
                {answer?.id && (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          const blob = await apiService.reports.downloadAnswerPdf(
                            answer.id
                          );
                          fileDownload(blob, `inspection-answer-${answer.id}.pdf`);
                        } catch (err: any) {
                          let errorMessage = 'PDF татах явцад алдаа гарлаа.';
                          if (err?.response?.data) {
                            const errorData = err.response.data;
                            errorMessage = errorData.message || errorData.error || errorMessage;
                          } else if (err?.message) {
                            errorMessage = err.message;
                          }
                          
                          setError(`PDF татах алдаа: ${errorMessage}`);
                        }
                      }}
                      className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      PDF татах
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          setError('');
                          await apiService.reports.sendAnswerEmail(answer.id);
                          alert('Үзлэгийн тайланг mail-ээр амжилттай илгээлээ.');
                        } catch (err: any) {
                          let errorMessage = 'Mail илгээх явцад алдаа гарлаа.';
                          if (err?.response?.data) {
                            const errorData = err.response.data;
                            errorMessage = errorData.message || errorData.error || errorMessage;
                          } else if (err?.message) {
                            errorMessage = err.message;
                          }
                          setError(errorMessage);
                        }
                      }}
                      className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      Mail илгээх
                    </button>
                    <button
                      onClick={async () => {
                        if (!answer.id) {
                          setError('Үзлэгийн хариултын ID олдсонгүй.');
                          return;
                        }
                        if (!confirm('Энэ үзлэгийн хариултыг (асуултын зургууд, засварын мэдээлэл, FTP зургуудтай хамт) бүрмөсөн устгах уу? Үзлэг (inspections) хүснэгтэд үлдэнэ. Энэ үйлдлийг буцааж болохгүй.')) {
                          return;
                        }
                        try {
                          setIsDeleting(true);
                          setError('');
                          await apiService.inspectionAnswers.delete(String(answer.id));
                          alert('Үзлэгийн хариулт амжилттай устгагдлаа.');
                          router.push('/inspection-answers');
                        } catch (err: any) {
                          let errorMessage = 'Үзлэгийн хариулт устгах явцад алдаа гарлаа.';
                          if (err?.response?.data) {
                            const errorData = err.response.data;
                            errorMessage = errorData.message || errorData.error || errorMessage;
                          } else if (err?.message) {
                            errorMessage = err.message;
                          }
                          setError(errorMessage);
                        } finally {
                          setIsDeleting(false);
                        }
                      }}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    >
                      {isDeleting ? 'Устгаж байна...' : 'Үзлэгийн хариулт устгах'}
                    </button>
                  </>
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
              onClick={() => answerId && loadInspectionAnswer(answerId)}
              className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
            >
              Дахин ачаалах
            </button>
          </div>
        )}

        <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Үзлэгийн мэдээлэл</h3>
            <p className="mt-1 text-sm text-gray-500">
              A4 хэлбэрийн тайланг preview болон DOCX татах товчоор нээн харж болно. Огноо болон санал тэмдэглэлийг A4 preview дээр шууд засах боломжтой.
            </p>
          </div>
          <div className="border-t border-gray-200 px-4 py-6 sm:px-6 space-y-3 text-sm text-gray-700">
            <p><span className="font-semibold text-gray-900">Үзлэгийн ID:</span> {answer.id}</p>
            <p><span className="font-semibold text-gray-900">Үзлэг:</span> {answer.inspection?.title ?? 'Мэдээлэл байхгүй'}</p>
            <p><span className="font-semibold text-gray-900">Хариулсан огноо:</span> {answer.answeredAt ? new Date(answer.answeredAt).toLocaleString() : 'Мэдээлэл байхгүй'}</p>
            <p><span className="font-semibold text-gray-900">Шалгагч:</span> {answer.user?.fullName ?? 'Мэдээлэл байхгүй'}</p>
          </div>
        </div>

        {answer?.id && (
          <A4Preview answerId={answer.id} />
        )}
      </main>
      </div>
    </div>
  );
}




