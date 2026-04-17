'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authUtils, User } from '@/lib/auth';
import { apiService } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Inspection {
  id: string;
  title: string;
  type: string;
  status: string;
  progress: number;
  scheduledAt: string;
  completedAt: string;
  device: {
    serialNumber: string;
    assetTag: string;
  };
  assignee: {
    fullName: string;
  };
}

interface InstallationAssignment {
  id: string;
  title: string;
  status: string;
  contractName?: string;
  contractNumber?: string;
  templateName?: string;
  deviceType?: string;
  userName?: string;
  userEmail?: string;
  assignedByName?: string;
  notes?: string;
  extraInfo?: any;
  createdAt: string;
  updatedAt: string;
}

interface GroupedInstallationAssignment {
  title: string;
  contractName?: string;
  contractNumber?: string;
  status: string; // Most common status or worst status
  assignments: InstallationAssignment[];
  templates: Array<{ name?: string; deviceType?: string }>;
  users: Array<{ name?: string; email?: string }>;
  createdAt: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [allInspections, setAllInspections] = useState<Inspection[]>([]); // All inspections (active + inactive)
  const [installationAssignments, setInstallationAssignments] = useState<GroupedInstallationAssignment[]>([]);
  const [allInstallationAssignments, setAllInstallationAssignments] = useState<GroupedInstallationAssignment[]>([]); // All installation assignments (active + inactive)
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'complete' | 'delete';
    inspectionId?: string;
    installationAssignmentId?: string;
    title: string;
    itemType: 'inspection' | 'installation';
  } | null>(null);
  const [editInstallation, setEditInstallation] = useState<{
    isOpen: boolean;
    originalTitle: string;
    assignmentIds: string[];
    title: string;
    truckTotalLengthM: string;
    platformLengthM: string;
    platformWidthM: string;
    platformCount: string;
    capacityKg: string;
    indicatorType: string;
    indicatorModel: string;
    manufacturerModel: string;
    loadCellCount: string;
    junctionBoxCount: string;
  }>({
    isOpen: false,
    originalTitle: '',
    assignmentIds: [],
    title: '',
    truckTotalLengthM: '',
    platformLengthM: '',
    platformWidthM: '',
    platformCount: '',
    capacityKg: '',
    indicatorType: '',
    indicatorModel: '',
    manufacturerModel: '',
    loadCellCount: '',
    junctionBoxCount: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'all'>('active'); // Tab state
  const router = useRouter();

  useEffect(() => {
    const initializeDashboard = async () => {
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

      // Verify token with backend
      try {
        const verification = await authUtils.verifyToken();
        if (!verification.valid) {
          router.push('/login');
          return;
        }
        
        if (verification.user) {
          setUser(verification.user);
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        router.push('/login');
        return;
      }

      // Load inspections and installation assignments
      await Promise.all([
        loadInspections(),
        loadInstallationAssignments(),
      ]);
      
      setIsLoading(false);
    };

    initializeDashboard();
  }, [router]);

  const ACTIVE_STATUSES = ['draft', 'in_progress', 'submitted'];
  const ACTIVE_INSTALLATION_STATUSES = ['PENDING', 'IN_PROGRESS'];

  const loadInspections = async () => {
    try {
      // Get all inspections
      const response = await apiService.inspections.getAll();
      const allInspectionsData: Inspection[] = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
      
      // Filter for active ones
      const active = allInspectionsData.filter((inspection: Inspection) =>
        ACTIVE_STATUSES.includes(inspection.status?.toLowerCase?.() || '')
      );
      
      setInspections(active);
      setAllInspections(allInspectionsData); // Store all inspections
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Үзлэгүүдийг ачаалахад алдаа гарлаа';
      setError(message);
    }
  };

  const groupAssignmentsByTitle = (assignments: InstallationAssignment[]): GroupedInstallationAssignment[] => {
    const groupedMap = new Map<string, GroupedInstallationAssignment>();

    assignments.forEach((assignment) => {
      const title = assignment.title || 'Тодорхойгүй';
      
      if (!groupedMap.has(title)) {
        groupedMap.set(title, {
          title,
          contractName: assignment.contractName,
          contractNumber: assignment.contractNumber,
          status: assignment.status,
          assignments: [],
          templates: [],
          users: [],
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
        });
      }

      const grouped = groupedMap.get(title)!;
      grouped.assignments.push(assignment);

      // Add template if not already added
      if (assignment.templateName) {
        const templateExists = grouped.templates.some(
          t => t.name === assignment.templateName
        );
        if (!templateExists) {
          grouped.templates.push({
            name: assignment.templateName,
            deviceType: assignment.deviceType,
          });
        }
      }

      // Add user if not already added
      if (assignment.userName) {
        const userExists = grouped.users.some(
          u => u.name === assignment.userName
        );
        if (!userExists) {
          grouped.users.push({
            name: assignment.userName,
            email: assignment.userEmail,
          });
        }
      }

      // Update status to worst status (PENDING < IN_PROGRESS < COMPLETED < CANCELLED)
      const statusPriority: { [key: string]: number } = {
        'PENDING': 1,
        'IN_PROGRESS': 2,
        'COMPLETED': 3,
        'CANCELLED': 4,
      };
      const currentPriority = statusPriority[grouped.status?.toUpperCase() || ''] || 0;
      const assignmentPriority = statusPriority[assignment.status?.toUpperCase() || ''] || 0;
      if (assignmentPriority > currentPriority) {
        grouped.status = assignment.status;
      }

      // Update dates to earliest created and latest updated
      if (new Date(assignment.createdAt) < new Date(grouped.createdAt)) {
        grouped.createdAt = assignment.createdAt;
      }
      if (new Date(assignment.updatedAt) > new Date(grouped.updatedAt)) {
        grouped.updatedAt = assignment.updatedAt;
      }
    });

    return Array.from(groupedMap.values());
  };

  const loadInstallationAssignments = async () => {
    try {
      // Get installation assignments with reasonable limit
      // For dashboard, we don't need all assignments, just recent ones
      const response = await apiService.installationAssignments.getAll({ 
        limit: 500, // Reasonable limit for dashboard
        page: 1 
      });
      
      const allAssignmentsData: InstallationAssignment[] = Array.isArray(response?.data) ? response.data : [];
      
      // Group assignments by title
      const groupedAll = groupAssignmentsByTitle(allAssignmentsData);
      
      // Filter for active ones (at least one assignment in the group is active)
      const active = groupedAll.filter((grouped: GroupedInstallationAssignment) =>
        grouped.assignments.some((assignment: InstallationAssignment) =>
          ACTIVE_INSTALLATION_STATUSES.includes(assignment.status?.toUpperCase?.() || '')
        )
      );
      
      setInstallationAssignments(active);
      setAllInstallationAssignments(groupedAll); // Store all grouped installation assignments
    } catch (err: any) {
      console.error('Error loading installation assignments:', err);
      // Don't set error for installation assignments, just log it
      // Set empty arrays to prevent undefined errors
      setInstallationAssignments([]);
      setAllInstallationAssignments([]);
    }
  };

  const handleLogout = () => {
    authUtils.logout();
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'canceled': return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-800';
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

  const handleCompleteInspection = async (inspectionId: string) => {
    try {
      setIsProcessing(true);
      await apiService.inspections.update(inspectionId, {
        status: 'approved',
      });
      setConfirmAction(null);
      await Promise.all([
        loadInspections(),
        loadInstallationAssignments(),
      ]);
      setError('');
      alert('✅ Үзлэг амжилттай дууслаа!');
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Үзлэгийг дуусгахад алдаа гарлаа';
      setError(message);
      alert('❌ ' + message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteInspection = async (inspectionId: string) => {
    try {
      setIsProcessing(true);
      await apiService.inspections.delete(inspectionId);
      
      // Close confirmation dialog
      setConfirmAction(null);
      
      // Always refresh the list after deletion
      await Promise.all([
        loadInspections(),
        loadInstallationAssignments(),
      ]);
      
      setError('');
      alert('✅ Үзлэг амжилттай устгагдлаа! MySQL-аас хадгалалт устгагдсан.');
    } catch (err: any) {
      // Only log unexpected errors in development
      if (process.env.NODE_ENV === 'development' && err.response?.status >= 500) {
        console.error('Unexpected delete error:', err);
      }
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Үзлэгийг устгахад алдаа гарлаа';
      setError(message);
      alert('❌ ' + message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompleteInstallationAssignment = async (assignmentId: string, title: string) => {
    try {
      setIsProcessing(true);
      
      // Find all assignments with the same title
      const response = await apiService.installationAssignments.getAll({ limit: 1000 });
      const allAssignments: InstallationAssignment[] = Array.isArray(response?.data) ? response.data : [];
      const assignmentsToComplete = allAssignments.filter(a => 
        a.title === title && ACTIVE_INSTALLATION_STATUSES.includes(a.status?.toUpperCase?.() || '')
      );
      
      // Complete all assignments with the same title
      await Promise.all(
        assignmentsToComplete.map(assignment => 
          apiService.installationAssignments.update(assignment.id, {
            status: 'COMPLETED',
          })
        )
      );
      
      setConfirmAction(null);
      await loadInstallationAssignments();
      setError('');
      alert(`✅ Суурьлуулалтын үзлэг (${assignmentsToComplete.length} томилолт) амжилттай дууслаа!`);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Суурьлуулалтын үзлэгийг дуусгахад алдаа гарлаа';
      setError(message);
      alert('❌ ' + message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteInstallationAssignment = async (assignmentId: string, title: string) => {
    try {
      setIsProcessing(true);
      
      // Find all assignments with the same title
      const response = await apiService.installationAssignments.getAll({ limit: 1000 });
      const allAssignments: InstallationAssignment[] = Array.isArray(response?.data) ? response.data : [];
      const assignmentsToDelete = allAssignments.filter(a => a.title === title);
      
      // Delete all assignments with the same title
      await Promise.all(
        assignmentsToDelete.map(assignment => 
          apiService.installationAssignments.delete(assignment.id)
        )
      );
      
      // Close confirmation dialog
      setConfirmAction(null);
      
      // Always refresh the list after deletion
      await loadInstallationAssignments();
      
      setError('');
      alert(`✅ Суурьлуулалтын үзлэг (${assignmentsToDelete.length} томилолт) амжилттай устгагдлаа!`);
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || err.message || 'Суурьлуулалтын үзлэгийг устгахад алдаа гарлаа';
      setError(message);
      alert('❌ ' + message);
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditInstallationDialog = (grouped: GroupedInstallationAssignment) => {
    const first = grouped.assignments[0];
    const firstExtra = (first as any)?.extraInfo ?? null;

    const extra = (firstExtra && typeof firstExtra === 'object') ? firstExtra : {};
    const toStr = (v: any) => (v === undefined || v === null ? '' : String(v));

    setEditInstallation({
      isOpen: true,
      originalTitle: grouped.title,
      assignmentIds: grouped.assignments.map(a => a.id),
      title: grouped.title,
      truckTotalLengthM: toStr(extra.truck_total_length_m),
      platformLengthM: toStr(extra.platform?.length_m),
      platformWidthM: toStr(extra.platform?.width_m),
      platformCount: toStr(extra.platform?.count),
      capacityKg: toStr(extra.capacity_kg),
      indicatorType: toStr(extra.indicator?.type),
      indicatorModel: toStr(extra.indicator?.model),
      manufacturerModel: toStr(extra.manufacturer_model),
      loadCellCount: toStr(extra.load_cell?.count),
      junctionBoxCount: toStr(extra.junction_box?.count),
    });
  };

  const handleSaveInstallationEdit = async () => {
    try {
      setIsProcessing(true);
      const nextTitle = editInstallation.title.trim();
      if (!nextTitle) {
        alert('❌ Гарчиг хоосон байж болохгүй');
        return;
      }

      const toNumOrNull = (v: string) => {
        const t = (v || '').trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      const toStrOrEmpty = (v: string) => (v || '').trim();

      const extraInfoCandidate: any = {};
      const truckTotalLengthM = toNumOrNull(editInstallation.truckTotalLengthM);
      if (truckTotalLengthM !== null) extraInfoCandidate.truck_total_length_m = truckTotalLengthM;

      const capacityKg = toNumOrNull(editInstallation.capacityKg);
      if (capacityKg !== null) extraInfoCandidate.capacity_kg = capacityKg;

      const manufacturerModel = toStrOrEmpty(editInstallation.manufacturerModel);
      if (manufacturerModel) extraInfoCandidate.manufacturer_model = manufacturerModel;

      const platformLengthM = toNumOrNull(editInstallation.platformLengthM);
      const platformWidthM = toNumOrNull(editInstallation.platformWidthM);
      const platformCount = toNumOrNull(editInstallation.platformCount);
      if (platformLengthM !== null || platformWidthM !== null || platformCount !== null) {
        extraInfoCandidate.platform = {};
        if (platformLengthM !== null) extraInfoCandidate.platform.length_m = platformLengthM;
        if (platformWidthM !== null) extraInfoCandidate.platform.width_m = platformWidthM;
        if (platformCount !== null) extraInfoCandidate.platform.count = platformCount;
      }

      const indicatorType = toStrOrEmpty(editInstallation.indicatorType);
      const indicatorModel = toStrOrEmpty(editInstallation.indicatorModel);
      if (indicatorType || indicatorModel) {
        extraInfoCandidate.indicator = {};
        if (indicatorType) extraInfoCandidate.indicator.type = indicatorType;
        if (indicatorModel) extraInfoCandidate.indicator.model = indicatorModel;
      }

      const loadCellCount = toNumOrNull(editInstallation.loadCellCount);
      if (loadCellCount !== null) {
        extraInfoCandidate.load_cell = { count: loadCellCount };
      }

      const junctionBoxCount = toNumOrNull(editInstallation.junctionBoxCount);
      if (junctionBoxCount !== null) {
        extraInfoCandidate.junction_box = { count: junctionBoxCount };
      }

      const extraInfo =
        Object.keys(extraInfoCandidate).length === 0 ? null : extraInfoCandidate;

      await Promise.all(
        editInstallation.assignmentIds.map((id) =>
          apiService.installationAssignments.update(id, {
            title: nextTitle,
            extraInfo,
          })
        )
      );

      setEditInstallation({
        isOpen: false,
        originalTitle: '',
        assignmentIds: [],
        title: '',
        truckTotalLengthM: '',
        platformLengthM: '',
        platformWidthM: '',
        platformCount: '',
        capacityKg: '',
        indicatorType: '',
        indicatorModel: '',
        manufacturerModel: '',
        loadCellCount: '',
        junctionBoxCount: '',
      });
      await loadInstallationAssignments();
      alert('✅ Суурьлуулалтын гарчиг/дэлгэрэнгүй мэдээлэл амжилттай шинэчлэгдлээ!');
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err.message ||
        'Суурьлуулалтын мэдээлэл засахад алдаа гарлаа';
      alert('❌ ' + message);
    } finally {
      setIsProcessing(false);
    }
  };

  const openConfirmDialog = (
    type: 'complete' | 'delete',
    itemId: string,
    itemTitle: string,
    itemType: 'inspection' | 'installation'
  ) => {
    if (itemType === 'inspection') {
      setConfirmAction({ type, inspectionId: itemId, title: itemTitle, itemType });
    } else {
      setConfirmAction({ type, installationAssignmentId: itemId, title: itemTitle, itemType });
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
      {/* Sidebar */}
      <Sidebar currentUser={user} />

      {/* Main Content */}
      <div className="flex-1 ml-64">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="px-6 py-4">
            <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-sm text-gray-500">Inspection Management System</p>
          </div>
        </header>

        {/* Content */}
        <main className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800">{error}</div>
            <button 
              onClick={loadInspections}
              className="mt-2 text-red-600 hover:text-red-800 text-sm underline"
            >
              Дахин ачаалах
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">I</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Идэвхтэй үзлэг
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {inspections.length + installationAssignments.length}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">↗</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Илгээсэн (submitted)
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {
                        inspections.filter(
                          (i) => (i.status || '').toLowerCase() === 'submitted'
                        ).length
                      }
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">⏳</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Хийгдэж байгаа
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {
                        inspections.filter(
                          (i) => (i.status || '').toLowerCase() === 'in_progress'
                        ).length
                      }
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-gray-500 rounded-md flex items-center justify-center">
                    <span className="text-white text-sm font-bold">📝</span>
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Ноорог
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {
                        inspections.filter(
                          (i) => (i.status || '').toLowerCase() === 'draft'
                        ).length
                      }
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-white shadow rounded-md mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('active')}
                className={`${
                  activeTab === 'active'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
              >
                Одоо идэвхтэй байгаа нь ({inspections.length + installationAssignments.length})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`${
                  activeTab === 'all'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
              >
                Идэвхтэй болон идэвхгүй бүгд ({allInspections.length + allInstallationAssignments.length})
              </button>
            </nav>
          </div>
        </div>

        {/* Inspections Table */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  {activeTab === 'active' ? 'Идэвхтэй үзлэгүүд' : 'Бүх үзлэгүүд'}
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  {activeTab === 'active' 
                    ? 'Одоо үргэлжилж буй (draft, submitted, in_progress) үзлэгүүд'
                    : 'Бүх статустай үзлэгүүд (идэвхтэй болон идэвхгүй)'}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsLoading(true);
                  Promise.all([
                    loadInspections(),
                    loadInstallationAssignments(),
                  ]).finally(() => setIsLoading(false));
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                🔄 Шинэчлэх
              </button>
            </div>
          </div>
          
          {((activeTab === 'active' ? inspections : allInspections).length === 0 && 
            (activeTab === 'active' ? installationAssignments : allInstallationAssignments).length === 0) ? (
            <div className="text-center py-12">
              <p className="text-gray-500">
                {activeTab === 'active' ? 'Идэвхтэй үзлэг олдсонгүй' : 'Үзлэг олдсонгүй'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {/* Regular Inspections */}
              {(activeTab === 'active' ? inspections : allInspections).map((inspection) => (
                <li key={inspection.id}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {inspection.title}
                          </h4>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeColor(inspection.type)}`}>
                            {inspection.type}
                          </span>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(inspection.status)}`}>
                            {inspection.status}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
                          <div>
                            <span className="font-medium">Төхөөрөмж:</span> {inspection.device?.serialNumber} ({inspection.device?.assetTag})
                          </div>
                          <div>
                            <span className="font-medium">Хариуцсан:</span> {inspection.assignee?.fullName}
                          </div>
                          {inspection.progress && (
                            <div>
                              <span className="font-medium">Явц:</span> {inspection.progress}%
                            </div>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {inspection.scheduledAt && (
                            <span>Төлөвлөсөн: {new Date(inspection.scheduledAt).toLocaleDateString('mn-MN')}</span>
                          )}
                          {inspection.completedAt && (
                            <span className="ml-4">Дууссан: {new Date(inspection.completedAt).toLocaleDateString('mn-MN')}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        {/* Only show complete button for active inspections */}
                        {ACTIVE_STATUSES.includes(inspection.status?.toLowerCase?.() || '') && (
                        <button
                          onClick={() => openConfirmDialog('complete', inspection.id, inspection.title, 'inspection')}
                          disabled={isProcessing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ✓ Дуусгах
                        </button>
                        )}
                        <button
                          onClick={() => openConfirmDialog('delete', inspection.id, inspection.title, 'inspection')}
                          disabled={isProcessing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          🗑️ Устгах
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              
              {/* Installation Assignments - Grouped by Title */}
              {(activeTab === 'active' ? installationAssignments : allInstallationAssignments).map((grouped) => (
                <li key={`installation-group-${grouped.title}`}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {grouped.title}
                          </h4>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            INSTALLATION
                          </span>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(grouped.status)}`}>
                            {grouped.status}
                          </span>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            {grouped.assignments.length} томилолт
                          </span>
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500 space-x-4">
                          {grouped.contractName && (
                            <div>
                              <span className="font-medium">Гэрээ:</span> {grouped.contractName}
                              {grouped.contractNumber && ` (${grouped.contractNumber})`}
                            </div>
                          )}
                          {grouped.templates.length > 0 && (
                            <div>
                              <span className="font-medium">Template:</span> {grouped.templates.map(t => t.name || 'Тодорхойгүй').join(', ')}
                              {grouped.templates.some(t => t.deviceType) && (
                                <span className="text-gray-400"> ({grouped.templates.filter(t => t.deviceType).map(t => t.deviceType).join(', ')})</span>
                              )}
                            </div>
                          )}
                          {grouped.users.length > 0 && (
                            <div>
                              <span className="font-medium">Хариуцсан:</span> {grouped.users.map(u => u.name || 'Тодорхойгүй').join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {grouped.createdAt && (
                            <span>Үүсгэсэн: {new Date(grouped.createdAt).toLocaleDateString('mn-MN')}</span>
                          )}
                          {grouped.updatedAt && (
                            <span className="ml-4">Шинэчлэгдсэн: {new Date(grouped.updatedAt).toLocaleDateString('mn-MN')}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => openEditInstallationDialog(grouped)}
                          disabled={isProcessing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ✏️ Засвар
                        </button>
                        {/* Only show complete button if at least one assignment is active */}
                        {grouped.assignments.some(a => ACTIVE_INSTALLATION_STATUSES.includes(a.status?.toUpperCase?.() || '')) && (
                        <button
                          onClick={() => {
                            // Complete all active assignments in this group
                            const activeAssignments = grouped.assignments.filter(a => 
                              ACTIVE_INSTALLATION_STATUSES.includes(a.status?.toUpperCase?.() || '')
                            );
                            if (activeAssignments.length > 0) {
                              openConfirmDialog('complete', activeAssignments[0].id, grouped.title, 'installation');
                            }
                          }}
                          disabled={isProcessing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          ✓ Дуусгах (бүгд)
                        </button>
                        )}
                        <button
                          onClick={() => {
                            // Delete all assignments in this group
                            if (grouped.assignments.length > 0) {
                              openConfirmDialog('delete', grouped.assignments[0].id, grouped.title, 'installation');
                            }
                          }}
                          disabled={isProcessing}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          🗑️ Устгах (бүгд)
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        </main>
      </div>

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {confirmAction.type === 'complete' 
                  ? confirmAction.itemType === 'installation' ? 'Суурьлуулалтын үзлэг дуусгах' : 'Үзлэг дуусгах'
                  : confirmAction.itemType === 'installation' ? 'Суурьлуулалтын үзлэг устгах' : 'Үзлэг устгах'}
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                {confirmAction.type === 'complete' 
                  ? `Та "${confirmAction.title}" ${confirmAction.itemType === 'installation' ? 'суурьлуулалтын үзлэгийг' : 'үзлэгийг'} дуусгахдаа итгэлтэй байна уу?`
                  : `Та "${confirmAction.title}" ${confirmAction.itemType === 'installation' ? 'суурьлуулалтын үзлэгийг' : 'үзлэгийг'} устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй.`
                }
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  disabled={isProcessing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                >
                  Цуцлах
                </button>
                <button
                  onClick={() => {
                    if (confirmAction.type === 'complete') {
                      if (confirmAction.itemType === 'installation' && confirmAction.installationAssignmentId) {
                        handleCompleteInstallationAssignment(confirmAction.installationAssignmentId, confirmAction.title);
                      } else if (confirmAction.inspectionId) {
                        handleCompleteInspection(confirmAction.inspectionId);
                      }
                    } else {
                      if (confirmAction.itemType === 'installation' && confirmAction.installationAssignmentId) {
                        handleDeleteInstallationAssignment(confirmAction.installationAssignmentId, confirmAction.title);
                      } else if (confirmAction.inspectionId) {
                        handleDeleteInspection(confirmAction.inspectionId);
                      }
                    }
                  }}
                  disabled={isProcessing}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
                    confirmAction.type === 'complete'
                      ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                      : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                  }`}
                >
                  {isProcessing ? 'Түр хүлээнэ үү...' : confirmAction.type === 'complete' ? 'Дуусгах' : 'Устгах'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Installation Modal */}
      {editInstallation.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Суурьлуулалтын мэдээлэл засах
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Энэ засвар нь “{editInstallation.originalTitle}” бүлгийн {editInstallation.assignmentIds.length} томилолт дээр адилхан үйлчилнэ.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Гарчиг
                  </label>
                  <input
                    value={editInstallation.title}
                    onChange={(e) =>
                      setEditInstallation((p) => ({ ...p, title: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Гарчиг"
                    disabled={isProcessing}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Автожингийн нийт хэмжээ (m)
                    </label>
                    <input
                      value={editInstallation.truckTotalLengthM}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, truckTotalLengthM: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: 12"
                      disabled={isProcessing}
                      inputMode="decimal"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Автожингийн даац (kg)
                    </label>
                    <input
                      value={editInstallation.capacityKg}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, capacityKg: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: 15000"
                      disabled={isProcessing}
                      inputMode="numeric"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Тавцангийн хэмжээ / тоо
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        value={editInstallation.platformLengthM}
                        onChange={(e) =>
                          setEditInstallation((p) => ({ ...p, platformLengthM: e.target.value }))
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Урт (m)"
                        disabled={isProcessing}
                        inputMode="decimal"
                      />
                      <input
                        value={editInstallation.platformWidthM}
                        onChange={(e) =>
                          setEditInstallation((p) => ({ ...p, platformWidthM: e.target.value }))
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Өргөн (m)"
                        disabled={isProcessing}
                        inputMode="decimal"
                      />
                      <input
                        value={editInstallation.platformCount}
                        onChange={(e) =>
                          setEditInstallation((p) => ({ ...p, platformCount: e.target.value }))
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Тоо (ш)"
                        disabled={isProcessing}
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Тооцоолуурын төрөл
                    </label>
                    <select
                      value={
                        ['ANALOG', 'DIGITAL'].includes((editInstallation.indicatorType || '').toUpperCase())
                          ? (editInstallation.indicatorType || '').toUpperCase()
                          : ''
                      }
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, indicatorType: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      disabled={isProcessing}
                    >
                      <option value="">Сонгох...</option>
                      <option value="ANALOG">ANALOG</option>
                      <option value="DIGITAL">DIGITAL</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Тооцоолуурын загвар
                    </label>
                    <input
                      value={editInstallation.indicatorModel}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, indicatorModel: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: XK3190"
                      disabled={isProcessing}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Үйлдвэрлэгч / загвар
                    </label>
                    <input
                      value={editInstallation.manufacturerModel}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, manufacturerModel: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: CAS CI-2001A"
                      disabled={isProcessing}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ачаа мэдрэгчийн тоо
                    </label>
                    <input
                      value={editInstallation.loadCellCount}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, loadCellCount: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: 8"
                      disabled={isProcessing}
                      inputMode="numeric"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Холбох хайрцагийн оролтын тоо
                    </label>
                    <input
                      value={editInstallation.junctionBoxCount}
                      onChange={(e) =>
                        setEditInstallation((p) => ({ ...p, junctionBoxCount: e.target.value }))
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Жишээ: 1"
                      disabled={isProcessing}
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  Бүх талбарыг хоосон орхивол `extra_info` NULL болно.
                </p>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() =>
                    setEditInstallation({
                      isOpen: false,
                      originalTitle: '',
                      assignmentIds: [],
                      title: '',
                      truckTotalLengthM: '',
                      platformLengthM: '',
                      platformWidthM: '',
                      platformCount: '',
                      capacityKg: '',
                      indicatorType: '',
                      indicatorModel: '',
                      manufacturerModel: '',
                      loadCellCount: '',
                      junctionBoxCount: '',
                    })
                  }
                  disabled={isProcessing}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                >
                  Цуцлах
                </button>
                <button
                  onClick={handleSaveInstallationEdit}
                  disabled={isProcessing}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {isProcessing ? 'Түр хүлээнэ үү...' : 'Хадгалах'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
