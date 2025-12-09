import axios from 'axios';

// API Configuration
// Use NEXT_PUBLIC_API_URL environment variable or fallback to default
// For production, set NEXT_PUBLIC_API_URL in .env.local file
// Example: NEXT_PUBLIC_API_URL=http://192.168.1.71:4555
function getApiBaseUrl(): string {
  // Check if NEXT_PUBLIC_API_URL is set (highest priority)
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  
  // Check if we're in browser (client-side)
  if (typeof window !== 'undefined') {
    // Client-side: use current hostname to determine API URL
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4555';
    }
    // Use server IP for network access
    return 'http://192.168.1.71:4555';
  }
  
  // Server-side: check NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    return 'http://192.168.1.71:4555';
  }
  
  // Default to localhost for development
  return 'http://localhost:4555';
}

export const API_CONFIG = {
  BASE_URL: getApiBaseUrl(),
  TIMEOUT: 10000,
};

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Log detailed error in development
    if (process.env.NODE_ENV === 'development' && error.response) {
      console.error('[API Error]', {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.config?.url,
        method: error.config?.method,
        data: error.response.data,
      });
    }
    
    if (error.response?.status === 401) {
      // Token expired or invalid
      if (typeof window !== 'undefined') {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// API endpoints
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    VERIFY: '/api/auth/verify',
  },
  ORGANIZATIONS: {
    LIST: '/api/organizations',
    CREATE: '/api/organizations',
    UPDATE: '/api/organizations/:id',
    DELETE: '/api/organizations/:id',
    DETAIL: '/api/organizations/:id',
  },
  SITES: {
    LIST: '/api/sites',
    CREATE: '/api/sites',
    UPDATE: '/api/sites/:id',
    DELETE: '/api/sites/:id',
    BY_ORG: '/api/sites/organization/:orgId',
  },
  CONTRACTS: {
    LIST: '/api/contracts',
    CREATE: '/api/contracts',
    UPDATE: '/api/contracts/:id',
    DELETE: '/api/contracts/:id',
    BY_ORG: '/api/contracts/organization/:orgId',
  },
  DEVICE_MODELS: {
    LIST: '/api/device-models',
    CREATE: '/api/device-models',
    UPDATE: '/api/device-models/:id',
    DELETE: '/api/device-models/:id',
  },
  DEVICES: {
    LIST: '/api/devices',
    CREATE: '/api/devices',
    UPDATE: '/api/devices/:id',
    DELETE: '/api/devices/:id',
    BY_ORG: '/api/devices/organization/:orgId',
    DETAIL: '/api/devices/:id',
  },
  INSPECTIONS: {
    LIST: '/api/inspections',
    CREATE: '/api/inspections',
    UPDATE: '/api/inspections/:id',
    DELETE: '/api/inspections/:id',
    ASSIGNED: '/api/inspections/assigned',
    BY_TYPE: '/api/inspections/assigned/type',
    BY_DEVICE: '/api/inspections/device/:deviceId',
    TEMPLATE: '/api/inspections/:id/template',
    SECTION_ANSWERS: '/api/inspections/section-answers',
    ASSIGN: '/api/inspections/:id/assign',
    IMAGE_GALLERY: '/api/inspections/:id/image-gallery',
  },
  USERS: {
    LIST: '/api/users',
    CREATE: '/api/users',
    UPDATE: '/api/users/:id',
    DELETE: '/api/users/:id',
    BY_ORG: '/api/users/organization/:orgId',
  },
  TEMPLATES: {
    LIST: '/api/templates',
    BY_TYPE: '/api/templates/type/:type',
    DETAIL: '/api/templates/:id',
  },
  REPORTS: {
    ANSWER_PREVIEW: '/api/documents/answers/:id/preview',
    ANSWER_DOCX: '/api/documents/answers/:id/docx',
    MONTHLY_REPORT: '/api/documents/sites/:siteId/monthly-report',
  },
};

// API service functions
export const apiService = {
  // Auth services
  auth: {
    login: async (email: string, password: string) => {
      const response = await apiClient.post(API_ENDPOINTS.AUTH.LOGIN, {
        email,
        password,
      });
      return response.data;
    },
    
    verify: async () => {
      const response = await apiClient.get(API_ENDPOINTS.AUTH.VERIFY);
      return response.data;
    },
  },
  
  // Organization services
  organizations: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.ORGANIZATIONS.LIST);
      return response.data;
    },
    
    create: async (data: { name: string; code: string }) => {
      const response = await apiClient.post(API_ENDPOINTS.ORGANIZATIONS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: { name?: string; code?: string }) => {
      const url = API_ENDPOINTS.ORGANIZATIONS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.ORGANIZATIONS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Site services
  sites: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.SITES.LIST);
      return response.data;
    },
    
    getByOrganization: async (orgId: string) => {
      const url = API_ENDPOINTS.SITES.BY_ORG.replace(':orgId', orgId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    create: async (data: { name: string; orgId: string }) => {
      const response = await apiClient.post(API_ENDPOINTS.SITES.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: { name?: string; orgId?: string }) => {
      const url = API_ENDPOINTS.SITES.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.SITES.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Contract services
  contracts: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.CONTRACTS.LIST);
      return response.data;
    },
    
    getByOrganization: async (orgId: string) => {
      const url = API_ENDPOINTS.CONTRACTS.BY_ORG.replace(':orgId', orgId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    create: async (data: {
      contractName: string;
      contractNumber: string;
      startDate: string;
      endDate: string;
      orgId: string;
      metadata?: any;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.CONTRACTS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      contractName?: string;
      contractNumber?: string;
      startDate?: string;
      endDate?: string;
      orgId?: string;
      metadata?: any;
    }) => {
      const url = API_ENDPOINTS.CONTRACTS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.CONTRACTS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Device Model services
  deviceModels: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.DEVICE_MODELS.LIST);
      return response.data;
    },
    
    create: async (data: {
      manufacturer: string;
      model: string;
      specs?: any;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.DEVICE_MODELS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      manufacturer?: string;
      model?: string;
      specs?: any;
    }) => {
      const url = API_ENDPOINTS.DEVICE_MODELS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.DEVICE_MODELS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Device services
  devices: {
    getByOrganization: async (orgId: string) => {
      const url = API_ENDPOINTS.DEVICES.BY_ORG.replace(':orgId', orgId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    create: async (data: {
      orgId: string;
      siteId: string;
      contractId: string;
      modelId: string;
      serialNumber: string;
      assetTag: string;
      status?: string;
      installedAt?: string;
      metadata?: any;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.DEVICES.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      orgId?: string;
      siteId?: string;
      contractId?: string;
      modelId?: string;
      serialNumber?: string;
      assetTag?: string;
      status?: string;
      installedAt?: string;
      metadata?: any;
    }) => {
      const url = API_ENDPOINTS.DEVICES.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.DEVICES.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Inspection services
  inspections: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.INSPECTIONS.LIST);
      return response.data;
    },
    
    create: async (data: {
      orgId?: string;
      deviceId: string;
      siteId?: string;
      contractId?: string;
      templateId?: string;
      type: string;
      title: string;
      scheduledAt?: string;
      notes?: string;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.INSPECTIONS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      title?: string;
      scheduledAt?: string;
      notes?: string;
      status?: string;
    }) => {
      const url = API_ENDPOINTS.INSPECTIONS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.INSPECTIONS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
    
    getAssigned: async () => {
      const response = await apiClient.get(API_ENDPOINTS.INSPECTIONS.ASSIGNED);
      return response.data?.data ?? [];
    },
    
    getAssignedByType: async (type: string) => {
      const response = await apiClient.get(`${API_ENDPOINTS.INSPECTIONS.BY_TYPE}/${type}`);
      return response.data?.data ?? [];
    },
    
    getByDevice: async (deviceId: string) => {
      const url = API_ENDPOINTS.INSPECTIONS.BY_DEVICE.replace(':deviceId', deviceId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    assign: async (inspectionId: string, userId: string) => {
      const url = API_ENDPOINTS.INSPECTIONS.ASSIGN.replace(':id', inspectionId);
      const response = await apiClient.put(url, {
        userId,
      });
      return response.data;
    },

    getImageGallery: async (
      inspectionId: string,
      params?: { includeData?: boolean }
    ) => {
      const url = API_ENDPOINTS.INSPECTIONS.IMAGE_GALLERY.replace(
        ':id',
        inspectionId
      );
      const response = await apiClient.get(url, { params });
      return response.data;
    },
  },
  
  // User services
  users: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.USERS.LIST);
      return response.data;
    },
    
    getByOrganization: async (orgId: string) => {
      const url = API_ENDPOINTS.USERS.BY_ORG.replace(':orgId', orgId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    create: async (userData: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      roleIds: string[];
      orgId?: string;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.USERS.CREATE, userData);
      return response.data;
    },
    
    update: async (id: string, userData: {
      fullName?: string;
      phone?: string;
      isActive?: boolean;
      password?: string;
      roleIds?: string[];
    }) => {
      const url = API_ENDPOINTS.USERS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, userData);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.USERS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Template services
  templates: {
    getAll: async () => {
      const response = await apiClient.get(API_ENDPOINTS.TEMPLATES.LIST);
      return response.data;
    },
    
    getByType: async (type: string) => {
      const response = await apiClient.get(`${API_ENDPOINTS.TEMPLATES.BY_TYPE}/${type}`);
      return response.data;
    },
  },
  
  // Inspection Answers services
  inspectionAnswers: {
    getAll: async (params?: { page?: number; limit?: number; inspectionId?: string; answeredBy?: string }) => {
      const response = await apiClient.get('/api/inspection-answers', { params });
      return response.data;
    },
    
    getById: async (id: string) => {
      const response = await apiClient.get(`/api/inspection-answers/${id}`);
      return response.data;
    },
    
    getQuestionImages: async (answerId: string, params?: { fieldId?: string; section?: string }) => {
      console.log('\n=== API: getQuestionImages ===');
      console.log('Called with:', { answerId, params });
      const url = `/api/inspection-answers/${answerId}/question-images`;
      console.log('Request URL:', url);
      
      const response = await apiClient.get(url, { params });
      console.log('Response status:', response.status);
      console.log('Response data keys:', Object.keys(response.data || {}));
      console.log('Response data structure:', {
        hasData: !!response.data,
        hasDataData: !!response.data?.data,
        hasDataImages: !!response.data?.data?.images,
        hasMessage: !!response.data?.message,
        imageCount: response.data?.data?.images?.length || response.data?.images?.length || 0,
      });
      
      if (response.data?.data?.images && response.data.data.images.length > 0) {
        console.log('First image from API:', {
          keys: Object.keys(response.data.data.images[0]),
          hasImageData: !!response.data.data.images[0].imageData,
          imageDataLength: response.data.data.images[0].imageData?.length || 0,
          imageDataPreview: response.data.data.images[0].imageData?.substring(0, 100) || 'N/A',
          mimeType: response.data.data.images[0].mimeType,
          section: response.data.data.images[0].section,
        });
      }
      
      return response.data;
    },

    getDocxData: async (id: string) => {
      const response = await apiClient.get(`/api/inspection-answers/${id}/docx-data`);
      return response.data;
    },
  },
  
  // Document services
  documents: {
    generateDocument: async (answerId: string) => {
      const response = await apiClient.get(`/api/documents/generate/${answerId}`, {
        responseType: 'blob',
      });
      return response.data;
    },
    
    uploadTemplate: async (file: File) => {
      const formData = new FormData();
      formData.append('template', file);
      
      const response = await apiClient.post('/api/documents/upload-template', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return response.data;
    },
    
    getAvailableTemplates: async () => {
      const response = await apiClient.get('/api/documents/available-templates');
      return response.data;
    },
    
    getTemplate: async (filename: string) => {
      const encoded = encodeURIComponent(filename);
      const response = await apiClient.get(`/api/documents/template/${encoded}`, {
        responseType: 'arraybuffer'
      });
      return response.data;
    },
  },

  reports: {
    getAnswerPreview: async (answerId: string) => {
      const url = API_ENDPOINTS.REPORTS.ANSWER_PREVIEW.replace(':id', answerId);
      const response = await apiClient.get(url);
      return response.data;
    },

    downloadAnswerDocx: async (answerId: string) => {
      const url = API_ENDPOINTS.REPORTS.ANSWER_DOCX.replace(':id', answerId);
      try {
        const response = await apiClient.get(url, { responseType: 'blob' });
        return response.data;
      } catch (error: any) {
        // If error response is a blob (JSON error message), parse it
        if (error.response?.data instanceof Blob && error.response.data.type === 'application/json') {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            // Create a new error with parsed data
            const parsedError = new Error(errorData.message || errorData.error || 'Failed to download docx');
            (parsedError as any).response = {
              ...error.response,
              data: errorData,
            };
            throw parsedError;
          } catch (parseError) {
            // If parsing fails, throw original error
            throw error;
          }
        }
        throw error;
      }
    },

    downloadMonthlyReport: async (siteId: string, year: number, month: number) => {
      const url = API_ENDPOINTS.REPORTS.MONTHLY_REPORT.replace(':siteId', siteId);
      try {
        const response = await apiClient.get(url, {
          params: { year, month },
          responseType: 'blob',
        });
        return response.data;
      } catch (error: any) {
        // If error response is a blob (JSON error message), parse it
        if (error.response?.data instanceof Blob && error.response.data.type === 'application/json') {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            const parsedError = new Error(errorData.message || errorData.error || 'Failed to download monthly report');
            (parsedError as any).response = {
              ...error.response,
              data: errorData,
            };
            throw parsedError;
          } catch (parseError) {
            throw error;
          }
        }
        throw error;
      }
    },
  },
};
