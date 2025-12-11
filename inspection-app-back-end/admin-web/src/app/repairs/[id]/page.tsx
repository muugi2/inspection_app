'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import TopNavbar from '@/components/TopNavbar';

interface Repair {
  id: string;
  inspectionId: string;
  fieldId: string;
  section: string;
  questionText: string;
  originalStatus?: string;
  description?: string;
  repairStatus: string;
  images?: Array<{
    order: number;
    fileName: string;
    imageUrl: string;
    relativePath: string;
    fileSize?: number;
    mimeType?: string;
    uploadedAt?: string;
  }>;
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
}

export default function RepairDetailPage() {
  const params = useParams();
  const router = useRouter();
  const repairId = params?.id as string;

  const [repair, setRepair] = useState<Repair | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [repairStatus, setRepairStatus] = useState('');
  const [selectedImages, setSelectedImages] = useState<File[]>([]);

  useEffect(() => {
    if (repairId) {
      fetchRepair();
    }
  }, [repairId]);

  const fetchRepair = async () => {
    try {
      setLoading(true);
      const response = await apiService.repairs.getById(repairId);
      const repairData = response.data as Repair;
      setRepair(repairData);
      setDescription(repairData.description || '');
      setRepairStatus(repairData.repairStatus);
    } catch (error: any) {
      console.error('Failed to fetch repair:', error);
      alert('❌ ' + (error.response?.data?.message || error.message || 'Засварын мэдээллийг ачаалахад алдаа гарлаа'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiService.repairs.update(repairId, {
        description: description.trim() || undefined,
        repairStatus: repairStatus,
      });

      // Upload images if any
      if (selectedImages.length > 0) {
        await apiService.repairs.uploadImages(repairId, selectedImages);
      }

      await fetchRepair();
      setSelectedImages([]);
      alert('✅ Засварын мэдээлэл амжилттай хадгалагдлаа');
    } catch (error: any) {
      console.error('Failed to save repair:', error);
      alert('❌ ' + (error.response?.data?.message || error.message || 'Хадгалахад алдаа гарлаа'));
    } finally {
      setSaving(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedImages((prev) => [...prev, ...files]);
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNavbar />
          <main className="flex-1 overflow-y-auto p-6">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="mt-2 text-gray-600">Ачааллаж байна...</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!repair) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNavbar />
          <main className="flex-1 overflow-y-auto p-6">
            <div className="text-center py-12">
              <p className="text-gray-500">Засварын мэдээлэл олдсонгүй.</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNavbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6">
              <button
                onClick={() => router.back()}
                className="text-indigo-600 hover:text-indigo-800 mb-4 flex items-center"
              >
                ← Буцах
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Засварын дэлгэрэнгүй</h1>
            </div>

            {/* Inspection Info */}
            {repair.inspection && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Үзлэгийн мэдээлэл</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">Гарчиг</label>
                    <p className="text-gray-900">{repair.inspection.title}</p>
                  </div>
                  {repair.inspection.device && (
                    <>
                      <div>
                        <label className="text-sm font-medium text-gray-500">Сериал дугаар</label>
                        <p className="text-gray-900">{repair.inspection.device.serialNumber}</p>
                      </div>
                      {repair.inspection.device.model && (
                        <div>
                          <label className="text-sm font-medium text-gray-500">Загвар</label>
                          <p className="text-gray-900">
                            {repair.inspection.device.model.manufacturer} {repair.inspection.device.model.model}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Repair Details */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Засварын мэдээлэл</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Асуулт</label>
                  <p className="text-gray-900">{repair.questionText}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                  <p className="text-gray-900">{repair.section}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Анхны төлөв</label>
                  <p className="text-gray-900">{repair.originalStatus || 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Төлөв</label>
                  <select
                    value={repairStatus}
                    onChange={(e) => setRepairStatus(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md ${getStatusColor(repairStatus)}`}
                  >
                    <option value="PENDING">Хүлээгдэж байна</option>
                    <option value="IN_PROGRESS">Хийгдэж байна</option>
                    <option value="COMPLETED">Дууссан</option>
                    <option value="VERIFIED">Баталгаажсан</option>
                    <option value="CANCELLED">Цуцлагдсан</option>
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Засварын тайлбар
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Засварын тайлбараа оруулна уу..."
                />
              </div>

              {/* Images */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Зураг</label>
                
                {/* Existing Images */}
                {repair.images && repair.images.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-2">Одоогийн зураг:</p>
                    <div className="grid grid-cols-4 gap-4">
                      {repair.images.map((img, index) => (
                        <div key={index} className="relative">
                          <img
                            src={img.imageUrl}
                            alt={`Repair image ${index + 1}`}
                            className="w-full h-32 object-cover rounded-lg border border-gray-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder-image.png';
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* New Images */}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageSelect}
                    className="hidden"
                    id="image-upload"
                  />
                  <label
                    htmlFor="image-upload"
                    className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 cursor-pointer"
                  >
                    Зураг нэмэх
                  </label>

                  {selectedImages.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm text-gray-600 mb-2">Шинээр нэмсэн зураг:</p>
                      <div className="grid grid-cols-4 gap-4">
                        {selectedImages.map((file, index) => (
                          <div key={index} className="relative">
                            <img
                              src={URL.createObjectURL(file)}
                              alt={`New image ${index + 1}`}
                              className="w-full h-32 object-cover rounded-lg border border-gray-200"
                            />
                            <button
                              onClick={() => removeSelectedImage(index)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Хадгалж байна...' : 'Хадгалах'}
                </button>
                <button
                  onClick={() => router.back()}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  Цуцлах
                </button>
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Мэдээлэл</h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-medium text-gray-500">Үүсгэсэн огноо</label>
                  <p className="text-gray-900">
                    {new Date(repair.createdAt).toLocaleString('mn-MN')}
                  </p>
                </div>
                {repair.creator && (
                  <div>
                    <label className="font-medium text-gray-500">Үүсгэсэн хүн</label>
                    <p className="text-gray-900">{repair.creator.fullName}</p>
                  </div>
                )}
                {repair.repairedAt && (
                  <div>
                    <label className="font-medium text-gray-500">Засвар хийсэн огноо</label>
                    <p className="text-gray-900">
                      {new Date(repair.repairedAt).toLocaleString('mn-MN')}
                    </p>
                  </div>
                )}
                {repair.repairer && (
                  <div>
                    <label className="font-medium text-gray-500">Засвар хийсэн хүн</label>
                    <p className="text-gray-900">{repair.repairer.fullName}</p>
                  </div>
                )}
                {repair.verifiedAt && (
                  <div>
                    <label className="font-medium text-gray-500">Баталгаажуулсан огноо</label>
                    <p className="text-gray-900">
                      {new Date(repair.verifiedAt).toLocaleString('mn-MN')}
                    </p>
                  </div>
                )}
                {repair.verifier && (
                  <div>
                    <label className="font-medium text-gray-500">Баталгаажуулсан хүн</label>
                    <p className="text-gray-900">{repair.verifier.fullName}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}



