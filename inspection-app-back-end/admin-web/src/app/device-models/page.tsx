'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import TopNavbar from '@/components/TopNavbar';
import DeleteErrorModal from '@/components/DeleteErrorModal';

interface DeviceModel {
  id: string;
  manufacturer: string;
  model: string;
  deviceType?: string;
  specs?: any;
  createdAt: string;
}

export default function DeviceModelsPage() {
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<DeviceModel | null>(null);
  const [formData, setFormData] = useState({
    manufacturer: '',
    model: '',
    deviceType: '',
    maxWeight: '',
    minWeight: '',
    precision: '',
    platformLength: '',
    platformWidth: '',
    platformCount: '',
  });
  const [isSaving, setIsSaving] = useState(false);
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
    loadModels();
  }, [router]);

  const loadModels = async () => {
    try {
      setIsLoading(true);
      const response = await apiService.deviceModels.getAll();
      setModels(response.data || []);
      setError('');
    } catch (err: any) {
      console.error('Failed to load device models:', err);
      setError('Загваруудыг ачаалахад алдаа гарлаа');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingModel(null);
    setFormData({
      manufacturer: '',
      model: '',
      deviceType: '',
      maxWeight: '',
      minWeight: '',
      precision: '',
      platformLength: '',
      platformWidth: '',
      platformCount: '',
    });
    setShowModal(true);
  };

  const handleEdit = (model: DeviceModel) => {
    setEditingModel(model);
    // Parse platform_size (e.g., "3*1.5") into length and width
    let platformLength = '';
    let platformWidth = '';
    if (model.specs?.platform_size) {
      const sizeStr = model.specs.platform_size.toString();
      const parts = sizeStr.split('*');
      if (parts.length === 2) {
        platformLength = parts[0].trim();
        platformWidth = parts[1].trim();
      }
    }
    
    setFormData({
      manufacturer: model.manufacturer,
      model: model.model,
      deviceType: (model as any).deviceType || '',
      maxWeight: model.specs?.max_weight || '',
      minWeight: model.specs?.min_weight || '',
      precision: model.specs?.precision || '',
      platformLength: platformLength,
      platformWidth: platformWidth,
      platformCount: model.specs?.platform_count?.toString() || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Та "${name}" загварыг устгахдаа итгэлтэй байна уу?\n\nАнхааруулга: Энэ загварыг ашиглаж байгаа төхөөрөмж байвал устгаж чадахгүй!`)) {
      return;
    }

    try {
      await apiService.deviceModels.delete(id);
      
      // Always refresh the list after deletion
      await loadModels();
      
      alert('✓ Загварыг амжилттай устгалаа! MySQL-аас хадгалалт устгагдсан.');
    } catch (err: any) {
      
      // Check if error has detailed information
      if (err.response?.data?.devices) {
        setErrorData({
          message: err.response.data.message,
          devices: err.response.data.devices,
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
    
    if (!formData.manufacturer || !formData.model || !formData.deviceType) {
      alert('Үйлдвэрлэгч, загвар болон төхөөрөмжийн төрөл шаардлагатай');
      return;
    }

    const specs: any = {};
    if (formData.maxWeight) specs.max_weight = formData.maxWeight;
    if (formData.minWeight) specs.min_weight = formData.minWeight;
    if (formData.precision) specs.precision = formData.precision;
    // Combine platform length and width into "length*width" format
    if (formData.platformLength && formData.platformWidth) {
      specs.platform_size = `${formData.platformLength}*${formData.platformWidth}`;
    } else if (formData.platformLength) {
      specs.platform_size = formData.platformLength;
    } else if (formData.platformWidth) {
      specs.platform_size = formData.platformWidth;
    }
    if (formData.platformCount) specs.platform_count = parseInt(formData.platformCount);

    try {
      setIsSaving(true);
      if (editingModel) {
        await apiService.deviceModels.update(editingModel.id, {
          manufacturer: formData.manufacturer,
          model: formData.model,
          deviceType: formData.deviceType,
          specs,
        });
        alert('✓ Загварыг амжилттай шинэчлэлээ!');
      } else {
        await apiService.deviceModels.create({
          manufacturer: formData.manufacturer,
          model: formData.model,
          deviceType: formData.deviceType,
          specs,
        });
        alert('✓ Загварыг амжилттай үүсгэлээ!');
      }
      setShowModal(false);
      await loadModels();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Хадгалахад алдаа гарлаа';
      alert('❌ ' + errorMessage);
    } finally {
      setIsSaving(false);
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
      <Sidebar currentUser={currentUser} />

      <div className="flex-1 ml-64 flex flex-col">
        <TopNavbar />
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4 flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Төхөөрөмжийн загвар удирдах</h1>
              <p className="text-sm text-gray-500">Төхөөрөмжийн загваруудын жагсаалт</p>
            </div>
            <button
              onClick={handleCreate}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
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
                onClick={loadModels}
                className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
              >
                Дахин оролдох
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {models.length === 0 ? (
              <div className="col-span-full text-center py-12 text-gray-500">
                Загвар олдсонгүй
              </div>
            ) : (
              models.map((model) => (
                <div key={model.id} className="bg-white shadow rounded-lg p-6 hover:shadow-lg transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {model.manufacturer}
                      </h3>
                      <p className="text-2xl font-bold text-indigo-600 mt-1">
                        {model.model}
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Идэвхтэй
                    </span>
                  </div>
                  
                  {(model.deviceType || model.specs) && (
                    <div className="border-t border-gray-200 pt-4 mt-4 space-y-2">
                      {model.deviceType && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Төхөөрөмжийн төрөл:</span>
                          <span className="font-medium">
                            {model.deviceType === 'ANALOG' ? 'Аналог' : model.deviceType === 'DIGITAL' ? 'Дижитал' : model.deviceType}
                          </span>
                        </div>
                      )}
                      {model.specs.max_weight && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Хамгийн их жин:</span>
                          <span className="font-medium">{model.specs.max_weight}</span>
                        </div>
                      )}
                      {model.specs.min_weight && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Хамгийн бага жин:</span>
                          <span className="font-medium">{model.specs.min_weight}</span>
                        </div>
                      )}
                      {model.specs.precision && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Нарийвчлал:</span>
                          <span className="font-medium">{model.specs.precision}</span>
                        </div>
                      )}
                      {model.specs.platform_size && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Тавцангийн хэмжээ:</span>
                          <span className="font-medium">{model.specs.platform_size}</span>
                        </div>
                      )}
                      {model.specs.platform_count && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Тавцангийн тоо:</span>
                          <span className="font-medium">{model.specs.platform_count}</span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => handleEdit(model)}
                      className="flex-1 px-3 py-2 bg-indigo-50 text-indigo-600 rounded-md hover:bg-indigo-100 text-sm font-medium"
                    >
                      Засах
                    </button>
                    <button
                      onClick={() => handleDelete(model.id, `${model.manufacturer} ${model.model}`)}
                      className="flex-1 px-3 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 text-sm font-medium"
                    >
                      Устгах
                    </button>
                  </div>
                  
                  <div className="mt-2 text-xs text-gray-400 text-center">
                    {new Date(model.createdAt).toLocaleDateString('mn-MN')}
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-10 mx-auto p-5 border w-[600px] shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                {editingModel ? 'Загвар засах' : 'Шинэ загвар нэмэх'}
              </h3>
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Үйлдвэрлэгч *
                    </label>
                    <input
                      type="text"
                      value={formData.manufacturer}
                      onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Жишээ: Puu"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Загвар *
                    </label>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Жишээ: Puu-1200"
                      required
                    />
                  </div>
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Төхөөрөмжийн төрөл *
                  </label>
                  <select
                    value={formData.deviceType}
                    onChange={(e) => setFormData({ ...formData, deviceType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    required
                  >
                    <option value="">Сонгоно уу</option>
                    <option value="ANALOG">Аналог</option>
                    <option value="DIGITAL">Дижитал</option>
                  </select>
                </div>
                
                <div className="border-t border-gray-200 pt-4 mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Техникийн үзүүлэлтүүд</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Хамгийн их жин
                      </label>
                      <input
                        type="text"
                        value={formData.maxWeight}
                        onChange={(e) => setFormData({ ...formData, maxWeight: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 150000kg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Хамгийн бага жин
                      </label>
                      <input
                        type="text"
                        value={formData.minWeight}
                        onChange={(e) => setFormData({ ...formData, minWeight: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 100kg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Нарийвчлал
                      </label>
                      <input
                        type="text"
                        value={formData.precision}
                        onChange={(e) => setFormData({ ...formData, precision: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 50kg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Тавцангийн урт
                      </label>
                      <input
                        type="text"
                        value={formData.platformLength}
                        onChange={(e) => setFormData({ ...formData, platformLength: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 3"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Тавцангийн өргөн
                      </label>
                      <input
                        type="text"
                        value={formData.platformWidth}
                        onChange={(e) => setFormData({ ...formData, platformWidth: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 1.5"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Тавцангийн тоо
                      </label>
                      <input
                        type="number"
                        value={formData.platformCount}
                        onChange={(e) => setFormData({ ...formData, platformCount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Жишээ: 5"
                      />
                    </div>
                  </div>
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

