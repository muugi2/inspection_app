import axios from 'axios';

// Backend port (Docker: 4555, must match BACKEND_PORT)
const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT || '4555';

// API Configuration
// In the browser: always use current hostname + backend port so that
// - http://192.168.1.54:3002 -> API http://192.168.1.54:4555
// - http://localhost:3000 -> API http://localhost:4555
// This fixes PDF download, inspection delete, and mail when opening via Docker IP.
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${BACKEND_PORT}`;
  }
  // SSR / build: use env or fallback
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  return `http://192.168.1.54:${BACKEND_PORT}`;
}

export const API_CONFIG = {
  BASE_URL: getApiBaseUrl(),
  TIMEOUT: 120000, // 2 minutes for large file downloads (docx)
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
    ASSIGN_BY_SITE: '/api/inspections/site/:siteId/assign',
    ASSIGN_BY_CONTRACT: '/api/inspections/contract/:contractId/assign',
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
    ANSWER_PDF: '/api/documents/answers/:id/pdf',
    ANSWER_EMAIL: '/api/documents/answers/:id/email',
    MONTHLY_REPORT: '/api/documents/organizations/:orgId/monthly-report',
    MONTHLY_REPORT_EMAIL: '/api/documents/organizations/:orgId/monthly-report/email',
    REPAIR_PREVIEW: '/api/documents/repairs/:inspectionId/preview',
    REPAIR_DOCX: '/api/documents/repairs/:inspectionId/docx',
    INSTALLATION_REPORT: '/api/documents/contracts/:contractId/installation-report',
  },
  REPAIRS: {
    LIST: '/api/repairs',
    DETAIL: '/api/repairs/:id',
    BY_INSPECTION: '/api/repairs/inspection/:inspectionId',
    ANALYZE: '/api/repairs/analyze/:inspectionId',
    UPDATE: '/api/repairs/:id',
    UPLOAD_IMAGES: '/api/repairs/:id/upload-images',
    ASSIGN: '/api/repairs/:id/assign',
  },
  INSTALLATION_ASSIGNMENTS: {
    LIST: '/api/installation-assignments',
    CREATE: '/api/installation-assignments',
    BY_USER: '/api/installation-assignments/user/:userId',
    DETAIL: '/api/installation-assignments/:id',
    UPDATE: '/api/installation-assignments/:id',
    DELETE: '/api/installation-assignments/:id',
  },
  VERIFICATIONS: {
    LIST: '/api/verifications',
    CREATE: '/api/verifications',
    BY_USER: '/api/verifications/user/:userId',
    DETAIL: '/api/verifications/:id',
    UPDATE: '/api/verifications/:id',
    DELETE: '/api/verifications/:id',
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
      deviceType: string;
      specs?: any;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.DEVICE_MODELS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      manufacturer?: string;
      model?: string;
      deviceType?: string;
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
      scheduleType?: string;
      title: string;
      scheduledAt?: string;
      startedAt?: string;
      completedAt?: string;
      notes?: string;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.INSPECTIONS.CREATE, data);
      return response.data;
    },
    
    update: async (id: string, data: {
      title?: string;
      scheduledAt?: string;
      startedAt?: string;
      completedAt?: string;
      notes?: string;
      status?: string;
      scheduleType?: string;
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
    
    assign: async (inspectionId: string, userId: string | string[]) => {
      const url = API_ENDPOINTS.INSPECTIONS.ASSIGN.replace(':id', inspectionId);
      // Support both single userId and array of userIds
      const payload = Array.isArray(userId) 
        ? { userIds: userId }
        : { userId };
      const response = await apiClient.put(url, payload);
      return response.data;
    },

    assignBySite: async (siteId: string, userId: string) => {
      const url = API_ENDPOINTS.INSPECTIONS.ASSIGN_BY_SITE.replace(':siteId', siteId);
      const response = await apiClient.put(url, {
        userId,
      });
      return response.data;
    },

    assignByContract: async (contractId: string, userId: string) => {
      const url = API_ENDPOINTS.INSPECTIONS.ASSIGN_BY_CONTRACT.replace(':contractId', contractId);
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
      const url = API_ENDPOINTS.TEMPLATES.BY_TYPE.replace(':type', type);
      const response = await apiClient.get(url);
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
      const url = `/api/inspection-answers/${answerId}/question-images`;
      const response = await apiClient.get(url, { params });
      return response.data;
    },

    getDocxData: async (id: string) => {
      const response = await apiClient.get(`/api/inspection-answers/${id}/docx-data`);
      return response.data;
    },

    update: async (id: string, data: { date?: string; remarks?: string; section?: string; fieldId?: string; comment?: string }) => {
      const response = await apiClient.put(`/api/inspection-answers/${id}`, data);
      return response.data;
    },

    /** Delete only this answer and related data (question images, repairs, repair images). Does not delete the inspection. */
    delete: async (answerId: string) => {
      const response = await apiClient.delete(`/api/inspection-answers/${answerId}`);
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

    getRepairPreview: async (inspectionId: string, repairId?: string) => {
      const url = API_ENDPOINTS.REPORTS.REPAIR_PREVIEW.replace(':inspectionId', inspectionId);
      const params = repairId ? { repairId } : {};
      const response = await apiClient.get(url, { params });
      return response.data;
    },

    downloadAnswerPdf: async (answerId: string) => {
      const url = API_ENDPOINTS.REPORTS.ANSWER_PDF.replace(':id', answerId);
      try {
        const response = await apiClient.get(url, {
          responseType: 'blob',
          timeout: 600000,
        });
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

    sendAnswerEmail: async (answerId: string) => {
      const url = API_ENDPOINTS.REPORTS.ANSWER_EMAIL.replace(':id', answerId);
      // Олон зурагтай үед PDF + SMTP удаан — default 2 мин хүрэлцэхгүй
      // body-parser strict JSON нь primitive/null body-г reject хийдэг тул {} илгээнэ
      const response = await apiClient.post(url, {}, { timeout: 600000 });
      return response.data;
    },

    downloadMonthlyReport: async (
      orgId: string,
      year: number,
      month: number,
      startDay?: number,
      endDay?: number
    ) => {
      const url = API_ENDPOINTS.REPORTS.MONTHLY_REPORT.replace(':orgId', orgId);
      try {
        const params: Record<string, number> = { year, month };
        if (typeof startDay === 'number') params.startDay = startDay;
        if (typeof endDay === 'number') params.endDay = endDay;

        const response = await apiClient.get(url, {
          params,
          responseType: 'blob',
        });
        
        // Ensure blob has correct PDF MIME type from response header
        const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
        console.log('Response Content-Type:', contentType);
        console.log('Response data type:', response.data instanceof Blob ? 'Blob' : typeof response.data);
        console.log('Response data size:', response.data instanceof Blob ? response.data.size : 'unknown');
        
        // Check if response is actually a blob
        if (!(response.data instanceof Blob)) {
          console.error('Response data is not a Blob:', typeof response.data);
          throw new Error('Invalid response format: expected Blob');
        }
        
        // Ensure PDF MIME type
        if (contentType.includes('application/pdf') || response.data.type === 'application/pdf') {
          // If blob type is already correct, return as is
          if (response.data.type === 'application/pdf') {
            return response.data;
          }
          // Otherwise, create new blob with correct type
          return new Blob([response.data], { type: 'application/pdf' });
        }
        
        // If content type is not PDF but we got a blob, try to use it anyway
        // (sometimes server doesn't set content-type correctly)
        if (response.data.size > 0) {
          console.warn('Response Content-Type is not PDF, but creating PDF blob anyway');
          return new Blob([response.data], { type: 'application/pdf' });
        }
        
        throw new Error('Empty or invalid PDF response');
      } catch (error: any) {
        console.error('Error downloading monthly report:', error);
        
        // If error response is a blob (JSON error message), parse it
        if (error.response?.data instanceof Blob) {
          try {
            const blobType = error.response.data.type;
            if (blobType === 'application/json' || blobType === 'text/json') {
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
                console.error('Failed to parse error JSON:', parseError);
                throw error;
              }
            }
          } catch (blobError) {
            console.error('Failed to read error blob:', blobError);
          }
        }
        throw error;
      }
    },

    sendMonthlyReportEmail: async (
      orgId: string,
      year: number,
      month: number,
      startDay?: number,
      endDay?: number
    ) => {
      const url = API_ENDPOINTS.REPORTS.MONTHLY_REPORT_EMAIL.replace(':orgId', orgId);
      const params: Record<string, number> = { year, month };
      if (typeof startDay === 'number') params.startDay = startDay;
      if (typeof endDay === 'number') params.endDay = endDay;
      const response = await apiClient.post(url, {}, { params, timeout: 600000 });
      return response.data;
    },

    downloadRepairDocx: async (inspectionId: string, repairId?: string) => {
      const url = API_ENDPOINTS.REPORTS.REPAIR_DOCX.replace(':inspectionId', inspectionId);
      const params = repairId ? { repairId } : {};
      try {
        const response = await apiClient.get(url, { params, responseType: 'blob' });
        return response.data;
      } catch (error: any) {
        // If error response is a blob (JSON error message), parse it
        if (error.response?.data instanceof Blob && error.response.data.type === 'application/json') {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            const parsedError = new Error(errorData.message || errorData.error || 'Failed to download repair report');
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

    downloadInstallationReport: async (contractId: string) => {
      const url = API_ENDPOINTS.REPORTS.INSTALLATION_REPORT.replace(':contractId', contractId);
      try {
        const response = await apiClient.get(url, { responseType: 'blob' });
        return response.data;
      } catch (error: any) {
        if (error.response?.data instanceof Blob && error.response.data.type === 'application/json') {
          const text = await error.response.data.text();
          try {
            const errorData = JSON.parse(text);
            const parsedError = new Error(errorData.message || errorData.error || 'Суурилуулалтын тайлан татахад алдаа гарлаа');
            (parsedError as any).response = { ...error.response, data: errorData };
            throw parsedError;
          } catch (_) {
            throw error;
          }
        }
        throw error;
      }
    },
  },

  // Repairs services
  repairs: {
    getAll: async (params?: { 
      inspectionId?: string; 
      status?: string; 
      page?: number; 
      limit?: number;
    }) => {
      const response = await apiClient.get(API_ENDPOINTS.REPAIRS.LIST, { params });
      return response.data;
    },

    getById: async (id: string) => {
      const url = API_ENDPOINTS.REPAIRS.DETAIL.replace(':id', id);
      const response = await apiClient.get(url);
      return response.data;
    },

    getByInspection: async (inspectionId: string) => {
      const url = API_ENDPOINTS.REPAIRS.BY_INSPECTION.replace(':inspectionId', inspectionId);
      const response = await apiClient.get(url);
      return response.data;
    },

    analyze: async (inspectionId: string) => {
      const url = API_ENDPOINTS.REPAIRS.ANALYZE.replace(':inspectionId', inspectionId);
      const response = await apiClient.post(url);
      return response.data;
    },

    update: async (id: string, data: {
      description?: string;
      repairDescription?: string;
      repairStatus?: string;
      repairedAt?: string;
      verifiedAt?: string;
    }) => {
      const url = API_ENDPOINTS.REPAIRS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },

    uploadImages: async (id: string, images: File[]) => {
      const url = API_ENDPOINTS.REPAIRS.UPLOAD_IMAGES.replace(':id', id);
      const formData = new FormData();
      images.forEach((image) => {
        formData.append('images', image);
      });
      const response = await apiClient.post(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },

    assign: async (repairId: string, userId: string) => {
      const url = API_ENDPOINTS.REPAIRS.ASSIGN.replace(':id', repairId);
      const response = await apiClient.put(url, {
        userId,
      });
      return response.data;
    },
  },
  
  // Installation Assignment services
  installationAssignments: {
    getAll: async (params?: {
      contractId?: string;
      templateId?: string;
      userId?: string;
      status?: string;
      page?: number;
      limit?: number;
    }) => {
      const response = await apiClient.get(API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.LIST, { params });
      return response.data;
    },
    
    create: async (data: {
      contractId: string;
      templateIds: string[];
      userIds: string[];
      title: string;
      extraInfo?: any;
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.CREATE, data);
      return response.data;
    },
    
    getByUser: async (userId: string) => {
      const url = API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.BY_USER.replace(':userId', userId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    getById: async (id: string) => {
      const url = API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.DETAIL.replace(':id', id);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    update: async (id: string, data: {
      status?: string;
      title?: string;
      extraInfo?: any;
      actUrl?: string | null;
      actFileName?: string | null;
      actFileSize?: number | null;
    }) => {
      const url = API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.INSTALLATION_ASSIGNMENTS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
  
  // Verification services
  verifications: {
    getAll: async (params?: {
      orgId?: string;
      siteId?: string;
      contractId?: string;
      userId?: string;
      status?: string;
      page?: number;
      limit?: number;
    }) => {
      const response = await apiClient.get(API_ENDPOINTS.VERIFICATIONS.LIST, { params });
      return response.data;
    },
    
    create: async (data: {
      orgId: string;
      siteId?: string;
      contractId?: string;
      title: string;
      userIds: string[];
    }) => {
      const response = await apiClient.post(API_ENDPOINTS.VERIFICATIONS.CREATE, data);
      return response.data;
    },
    
    getByUser: async (userId: string) => {
      const url = API_ENDPOINTS.VERIFICATIONS.BY_USER.replace(':userId', userId);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    getById: async (id: string) => {
      const url = API_ENDPOINTS.VERIFICATIONS.DETAIL.replace(':id', id);
      const response = await apiClient.get(url);
      return response.data;
    },
    
    update: async (id: string, data: {
      status?: string;
      comment?: string;
      image1Url?: string;
      image2Url?: string;
    }) => {
      const url = API_ENDPOINTS.VERIFICATIONS.UPDATE.replace(':id', id);
      const response = await apiClient.put(url, data);
      return response.data;
    },
    
    delete: async (id: string) => {
      const url = API_ENDPOINTS.VERIFICATIONS.DELETE.replace(':id', id);
      const response = await apiClient.delete(url);
      return response.data;
    },
  },
};
