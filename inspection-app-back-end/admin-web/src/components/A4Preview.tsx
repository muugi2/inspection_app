'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '@/lib/api';

interface FieldValue {
  status: string;
  comment: string;
  question: string;
}

interface PreviewResponse {
  data: {
    inspection: {
      id: string;
      title: string;
      status: string;
      type: string;
    };
    answer: {
      id: string;
      answeredAt: string | null;
    } | null;
    d: {
      contractor: {
        company: string;
        contract_no: string;
        contact: string;
      };
      metadata: {
        date: string;
        inspector: string;
        location: string;
        scale_id_serial_no: string;
        model: string;
        platformLength?: string | number;
        platformWidth?: string | number;
        platformCount?: string | number;
      };
      repair?: {
        section: string;
        field: string;
        section_field: string; // Section - Field нэрийг нэгтгэсэн
        before_text: string;
        after_text: string;
        before_image?: any;
        after_image?: any;
        beforeImagePreview?: {
          base64: string;
          mimeType: string;
          imageUrl: string;
        };
        afterImagePreview?: {
          base64: string;
          mimeType: string;
          imageUrl: string;
        };
      };
      repairRows?: Array<any>; // Deprecated: use repair instead
      exterior?: Record<string, FieldValue>;
      indicator?: Record<string, FieldValue>;
      jbox?: Record<string, FieldValue>;
      sensor?: Record<string, FieldValue>;
      foundation?: Record<string, FieldValue>;
      cleanliness?: Record<string, FieldValue>;
      remarks?: string;
      signatures?: {
        inspector?:
          | {
              data: string;
              mimeType: string;
            }
          | null;
      };
      images?: Array<{
        id: string | null;
        section: string | null;
        fieldId: string | null;
        order: number;
        imageUrl: string;
        storagePath: string;
        base64: string | null;
        mimeType: string;
        uploadedAt: string | null;
      }>;
    };
  };
}

interface RowDefinition {
  label: string;
  path: string;
}

// Template-defined fields for each section (based on MySQL template structure)
const templateFields: Record<string, string[]> = {
  exterior: ['platform_plate', 'beam_joint_plate', 'stop_bolt', 'interplatform_bolts', 'base'],
  indicator: ['led_display', 'power_plug', 'seal_bolt', 'buttons', 'junction_wiring', 'serial_converter', 'control_screen'],
  jbox: ['box_integrity', 'collector_board', 'wire_tightener', 'protective_box', 'resistance_element'], // resistance_element for digital
  sensor: ['signal_wire', 'ball', 'ball_cup_thin', 'plate'],
  foundation: ['cross_base', 'anchor_plate', 'ramp_angle', 'ramp_stopper', 'ramp', 'slab_base'],
  cleanliness: ['under_platform', 'top_platform', 'gap_platform_ramp', 'both_sides_area'],
};

// Dynamic function to generate rows from backend data
// Shows only template-defined fields from backend data, with labels from fieldLabelMap if available
function generateRowsFromData(
  sectionData: Record<string, FieldValue>,
  sectionName: string,
  fieldLabelMap: Record<string, string>
): RowDefinition[] {
  if (!sectionData) return [];
  
  // Get template-defined fields for this section
  const allowedFields = templateFields[sectionName] || [];
  
  // Include only template-defined fields from backend data
  // Use label from fieldLabelMap if available, otherwise use the field key as label
  return Object.keys(sectionData)
    .filter(key => {
      // Filter out null/undefined values and metadata fields
      const value = sectionData[key];
      const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
      
      // Filter out battery field from indicator section
      if (sectionName === 'indicator' && key === 'battery') {
        return false;
      }
      
      // Filter out serial_converter_plug (only show serial_converter from template)
      if (sectionName === 'indicator' && key === 'serial_converter_plug') {
        return false;
      }
      
      // Filter out resistor_element (only show resistance_element from template)
      if (sectionName === 'jbox' && key === 'resistor_element') {
        return false;
      }
      
      // Filter out base from sensor section (not in template)
      if (sectionName === 'sensor' && key === 'base') {
        return false;
      }
      
      // Filter out sensor_base from foundation section (not in template)
      if (sectionName === 'foundation' && key === 'sensor_base') {
        return false;
      }
      
      // Only include fields that are in the template definition
      const isTemplateField = allowedFields.includes(key);
      
      return value !== null && 
             value !== undefined && 
             !excludedKeys.includes(key) &&
             isTemplateField;
    })
    .map(key => ({
      label: fieldLabelMap[key] || key, // Use label from map, or fallback to key
      path: `${sectionName}.${key}`,
    }));
}

// Field label mapping (field ID -> Mongolian label)
const fieldLabels: Record<string, Record<string, string>> = {
  exterior: {
    platform_plate: 'Тавцангийн лист',
    beam_joint_plate: 'Дам нуруу холбосон лист',
    stop_bolt: 'Хязгаарлагчийн боолт',
    interplatform_bolts: 'Тавцан хоорондын боолт',
    base: 'Мэдрэгчийн суурь', // Added base field mapping for exterior section
  },
  indicator: {
    led_display: 'Лед дэлгэц',
    power_plug: 'Тэжээлийн залгуур',
    seal_bolt: 'Лац болон лацны боолт',
    buttons: 'Товчлуур',
    junction_wiring: 'Холбогч хайрцаг болон сигналын утас',
    serial_converter: 'Сериал хөрвүүлэгч залгуур', 
    control_screen: 'Хяналтын дэлгэц', 
  },
  jbox: {
    box_integrity: 'Хайрцагны бүрэн бүтэн байдал',
    collector_board: 'Сигналын утас цуглуулагч хавтан',
    wire_tightener: 'Сигналын утас чангалагч',
    resistance_element: 'Эсэргүүцлийн элемент', // Backend uses 'resistance_element'
    protective_box: 'Холбогч хайрцагны хамгаалалтын гадна хайрцаг',
  },
  sensor: {
    signal_wire: 'Сигналын утас',
    ball: 'Ган бөмбөлөг',
    ball_cup_thin: 'Ган бөмбөлгийн аяган суурь /нимгэн/',
    plate: 'Ялтсан хавтан',
  },
  foundation: {
    cross_base: 'Хөндлөн суурь',
    anchor_plate: 'Суурийн анкер лист',
    ramp_angle: 'Налуу замын угольник',
    ramp_stopper: 'Налуу замын өшиглүүр',
    ramp: 'Налуу зам',
    slab_base: 'Нил суурь',
  },
  cleanliness: {
    under_platform: 'Тавцангийн доод тал',
    top_platform: 'Тавцангийн дээд тал',
    gap_platform_ramp: 'Автожингийн тавцан болон Налуу зам хоорондын завсар',
    both_sides_area: 'Автожингийн 2 талын талбай',
  },
};

// Legacy hardcoded rows (fallback if needed)
const exteriorRows: RowDefinition[] = [
  { label: 'Тавцангийн лист', path: 'exterior.platform_plate' },
  { label: 'Дам нуруу холбосон лист', path: 'exterior.beam_joint_plate' },
  { label: 'Хязгаарлагчийн боолт', path: 'exterior.stop_bolt' },
  { label: 'Тавцан хоорондын боолт', path: 'exterior.interplatform_bolts' },
];

const indicatorRows: RowDefinition[] = [
  { label: 'Лед дэлгэц', path: 'indicator.led_display' },
  { label: 'Тэжээлийн залгуур', path: 'indicator.power_plug' },
  { label: 'Лац болон лацны боолт', path: 'indicator.seal_and_bolt' },
  { label: 'Товчлуур', path: 'indicator.buttons' },
  {
    label: 'Холбогч хайрцаг болон сигналын утас',
    path: 'indicator.junction_wiring',
  },
  {
    label: 'Тооцоолуур',
    path: 'indicator.serial_converter_plug',
  },
  // battery removed as requested
];

const jboxRows: RowDefinition[] = [
  {
    label: 'Хайрцагны бүрэн бүтэн байдал',
    path: 'jbox.box_integrity',
  },
  {
    label: 'Сигналын утас цуглуулагч хавтан',
    path: 'jbox.collector_board',
  },
  { label: 'Сигналын утас чангалагч', path: 'jbox.wire_tightener' },
  { label: 'Эсэргүүцлийн элемент', path: 'jbox.resistance_element' },
  {
    label: 'Холбогч хайрцагны хамгаалалтын хайрцаг',
    path: 'jbox.protective_box',
  },
];

const sensorRows: RowDefinition[] = [
  { label: 'Сигналын утас', path: 'sensor.signal_wire' },
  { label: 'Ган бөмбөлөг', path: 'sensor.ball' },
  { label: 'Мэдрэгчийн суурь', path: 'sensor.base' },
  { label: 'Ган бөмбөлгийн аяган суурь /нимгэн/', path: 'sensor.ball_cup_thin' },
  { label: 'Ялтсан хавтан', path: 'sensor.plate' },
];

const foundationRows: RowDefinition[] = [
  { label: 'Хөндлөн суурь', path: 'foundation.cross_base' },
  { label: 'Суурийн анкер лист', path: 'foundation.anchor_plate' },
  { label: 'Налуу замын угольник', path: 'foundation.ramp_angle' },
  { label: 'Налуу замын өшиглүүр', path: 'foundation.ramp_stopper' },
  { label: 'Налуу зам', path: 'foundation.ramp' },
  { label: 'Нил суурь', path: 'foundation.slab_base' },
  { label: 'Мэдрэгчийн суурь', path: 'foundation.sensor_base' },
];

const cleanlinessRows: RowDefinition[] = [
  { label: 'Тавцангийн доод тал', path: 'cleanliness.under_platform' },
  { label: 'Тавцангийн дээд тал', path: 'cleanliness.top_platform' },
  {
    label: 'Тавцан болон Налуу зам хоорондын завсар',
    path: 'cleanliness.gap_platform_ramp',
  },
  { label: 'Автожингийн 2 талын талбай', path: 'cleanliness.both_sides_area' },
];

function classNameForStatus(status: string) {
  if (!status) return 'bg-gray-100 text-gray-700';
  const normalized = status.toLowerCase();
  if (normalized.includes('солих') || normalized.includes('шаардлагатай')) {
    return 'bg-red-100 text-red-700';
  }
  if (
    normalized.includes('зүгээр') ||
    normalized.includes('бүтэн') ||
    normalized.includes('цэвэр')
  ) {
    return 'bg-green-100 text-green-700';
  }
  return 'bg-yellow-100 text-yellow-700';
}

function getField(data: PreviewResponse['data']['d'], path: string): FieldValue {
  const segments = path.split('.');
  let current: any = data;
  for (const segment of segments) {
    if (current && segment in current) {
      current = current[segment];
    } else {
      return { status: '', comment: '', question: '' };
    }
  }

  return {
    status: current.status || '',
    comment: current.comment || '',
    question: current.question || '',
  };
}

function toSignatureSrc(
  signature:
    | {
        data: string;
        mimeType: string;
      }
    | null
    | undefined
) {
  if (!signature?.data || !signature.mimeType) {
    return null;
  }
  return `data:${signature.mimeType};base64,${signature.data}`;
}

function toImageSrc(image: { base64: string | null; mimeType: string } | null | undefined) {
  if (!image?.base64 || !image.mimeType) {
    return null;
  }
  return `data:${image.mimeType};base64,${image.base64}`;
}

function getImagesForField(
  images: PreviewResponse['data']['d']['images'] | undefined,
  section: string,
  fieldId: string
) {
  if (!images || !Array.isArray(images)) {
    return [];
  }
  return images
    .filter(img => img.section === section && img.fieldId === fieldId)
    .sort((a, b) => a.order - b.order);
}

function TableSection({
  title,
  rows,
  data,
  sectionName,
  onImageClick,
  answerId,
  editingComment,
  editComment,
  onEditComment,
  onSaveComment,
  onCancelComment,
  isSaving,
}: {
  title: string;
  rows: RowDefinition[];
  data: PreviewResponse['data']['d'];
  sectionName: string;
  onImageClick?: (src: string, alt: string) => void;
  answerId?: string;
  editingComment: { section: string; fieldId: string } | null;
  editComment: string;
  onEditComment: (section: string, fieldId: string, currentComment: string) => void;
  onSaveComment: (section: string, fieldId: string) => void;
  onCancelComment: () => void;
  isSaving: boolean;
}) {
  // Field ID mapping - maps display field ID to backend field ID
  // Backend uses 'serial_converter' but frontend displays as 'serial_converter_plug'
  const fieldIdMap: Record<string, string> = {
    'exterior.platform_plate': 'platform_plate',
    'exterior.beam_joint_plate': 'beam_joint_plate',
    'exterior.stop_bolt': 'stop_bolt',
    'exterior.interplatform_bolts': 'interplatform_bolts',
    'exterior.base': 'base', // Added base field mapping for exterior section
    'indicator.led_display': 'led_display',
    'indicator.power_plug': 'power_plug',
    'indicator.seal_bolt': 'seal_bolt',
    'indicator.buttons': 'buttons',
    'indicator.junction_wiring': 'junction_wiring',
    'indicator.serial_converter': 'serial_converter', // Backend field ID

    'indicator.control_screen': 'control_screen', // Added control_screen field mapping
    // 'indicator.battery': 'battery', // Removed as requested
    'jbox.box_integrity': 'box_integrity',
    'jbox.collector_board': 'collector_board',
    'jbox.wire_tightener': 'wire_tightener',
    'jbox.resistor_element': 'resistor_element',
    'jbox.resistance_element': 'resistance_element', // Backend uses 'resistance_element'
    'jbox.protective_box': 'protective_box',
    'sensor.signal_wire': 'signal_wire',
    'sensor.ball': 'ball',
    'sensor.base': 'base',
    'sensor.ball_cup_thin': 'ball_cup_thin',
    'sensor.plate': 'plate',
    'foundation.cross_base': 'cross_base',
    'foundation.anchor_plate': 'anchor_plate',
    'foundation.ramp_angle': 'ramp_angle',
    'foundation.sensor_base': 'sensor_base',
    'foundation.ramp_stopper': 'ramp_stopper',
    'foundation.ramp': 'ramp',
    'foundation.slab_base': 'slab_base',
    'cleanliness.under_platform': 'under_platform',
    'cleanliness.top_platform': 'top_platform',
    'cleanliness.gap_platform_ramp': 'gap_platform_ramp',
    'cleanliness.both_sides_area': 'both_sides_area',
  };
  
  // Helper function to get field ID for image lookup
  function getFieldIdForImages(sectionName: string, fieldKey: string): string {
    const path = `${sectionName}.${fieldKey}`;
    return fieldIdMap[path] || fieldKey;
  }

  return (
    <section className="px-8 py-6">
      <h3 className="font-semibold text-lg uppercase tracking-wide mb-4">
        {title}
      </h3>
      <table className="w-full text-sm border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="w-12 border border-gray-300 px-2 py-2 text-center">
              №
            </th>
            <th className="w-64 border border-gray-300 px-3 py-2 text-left">
              Үзлэгийн эд анги
            </th>
            <th className="w-36 border border-gray-300 px-3 py-2 text-left">
              Төлөв
            </th>
            <th className="border border-gray-300 px-3 py-2 text-left">
              Тайлбар
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const field = getField(data, row.path);
            const fieldKey = row.path.split('.').pop() || '';
            const backendFieldId = getFieldIdForImages(sectionName, fieldKey);
            const isEditing = answerId && editingComment?.section === sectionName && editingComment?.fieldId === backendFieldId;
            
            return (
              <tr key={row.path} className="align-top">
                <td className="border border-gray-300 px-2 py-2 text-center font-medium">
                  {index + 1}
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  {row.label}
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  <span
                    className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${classNameForStatus(
                      field.status
                    )}`}
                  >
                    {field.status || '—'}
                  </span>
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editComment}
                        onChange={(e) => onEditComment(sectionName, backendFieldId, e.target.value)}
                        className="w-full min-h-[60px] text-sm border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        disabled={isSaving}
                        placeholder="Тайлбар оруулах..."
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onSaveComment(sectionName, backendFieldId)}
                          disabled={isSaving}
                          className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:bg-gray-400"
                        >
                          {isSaving ? '...' : '✓'}
                        </button>
                        <button
                          onClick={onCancelComment}
                          disabled={isSaving}
                          className="px-3 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 disabled:bg-gray-200"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className={`whitespace-pre-line ${answerId ? 'group cursor-pointer relative' : ''}`}
                      onClick={() => answerId && onEditComment(sectionName, backendFieldId, field.comment || '')}
                    >
                      {field.comment || '—'}
                      {answerId && (
                        <span className="absolute top-1 right-1 text-xs text-gray-400 opacity-0 group-hover:opacity-100">
                          ✏️
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      
      {/* Field бүрийн зурагуудыг хүснэгтийн гадна, field бүрийн доор харуулах */}
      {rows.map((row) => {
        const fieldKey = row.path.split('.').pop() || '';
        const fieldId = getFieldIdForImages(sectionName, fieldKey);
        const fieldImages = getImagesForField(data.images, sectionName, fieldId);
        const hasImages = fieldImages.length > 0;

        if (!hasImages) {
          return null;
        }

        return (
          <div key={`images-${row.path}`} className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="font-medium text-base mb-3 text-gray-900">
              {row.label}:
            </h4>
            <div className="flex flex-wrap gap-3">
              {fieldImages.map((img, imgIndex) => {
                const imageSrc = toImageSrc(img);
                const displaySrc = imageSrc || img.imageUrl || '';
                const altText = `${row.label} - Зураг ${img.order}`;
                return (
                  <div key={img.id || imgIndex} className="flex-shrink-0">
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={altText}
                        className="max-w-xs max-h-48 object-contain border border-gray-200 rounded cursor-zoom-in"
                        onClick={() => displaySrc && onImageClick?.(displaySrc, altText)}
                      />
                    ) : img.imageUrl ? (
                      <img
                        src={img.imageUrl}
                        alt={altText}
                        className="max-w-xs max-h-48 object-contain border border-gray-200 rounded cursor-zoom-in"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                        onClick={() => displaySrc && onImageClick?.(displaySrc, altText)}
                      />
                    ) : (
                      <div className="w-48 h-32 bg-gray-100 border border-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
                        Зураг ачаалж чадсангүй
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

interface A4PreviewProps {
  answerId?: string;
  repairInspectionId?: string;
  repairId?: string; // Зөвхөн тухайн засварыг харуулах
}

export default function A4Preview({ answerId, repairInspectionId, repairId }: A4PreviewProps) {
  const [preview, setPreview] = useState<PreviewResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<{ src: string; alt: string } | null>(null);
  
  // Inline editing states (only for inspection answers, not repair reports)
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [isEditingRemarks, setIsEditingRemarks] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Comment editing state: { section: string, fieldId: string } | null
  const [editingComment, setEditingComment] = useState<{ section: string; fieldId: string } | null>(null);
  const [editComment, setEditComment] = useState('');
  
  // Repair after_text editing state
  const [editingRepairAfterText, setEditingRepairAfterText] = useState(false);
  const [editRepairAfterText, setEditRepairAfterText] = useState('');
  
  // Ensure repairId is string
  const repairIdString = repairId ? String(repairId) : null;
  
  // Debug: Log repairId to verify it's being passed correctly
  useEffect(() => {
    if (repairInspectionId) {
      console.log('[A4Preview] Repair props:', { repairInspectionId, repairId, repairIdString });
    }
  }, [repairInspectionId, repairId, repairIdString]);

  useEffect(() => {
    const fetchPreview = async () => {
      if (!answerId && !repairInspectionId) return;
      try {
        setIsLoading(true);
        setError(null);
        
        let response: PreviewResponse;
        if (repairInspectionId) {
          // Fetch repair report preview
          // repairId байвал зөвхөн тухайн засварыг шүүх
          response = await apiService.reports.getRepairPreview(repairInspectionId, repairId);
        } else if (answerId) {
          // Fetch inspection answer preview
          response = await apiService.reports.getAnswerPreview(answerId);
        } else {
          throw new Error('No ID provided');
        }
        
        setPreview(response.data);
        
        // Initialize edit values from preview data
        if (response.data?.d) {
          setEditDate(response.data.d.metadata?.date || '');
          setEditRemarks(response.data.d.remarks || '');
          // Initialize repair after_text if repair exists
          if (response.data.d.repair) {
            setEditRepairAfterText(response.data.d.repair.after_text || '');
          }
        }
      } catch (err: any) {
        setError(
          err?.response?.data?.message ||
            'Тайлангийн мэдээлэл ачаалахад алдаа гарлаа.'
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreview();
  }, [answerId, repairInspectionId, repairId]);

  const handleSaveDate = async () => {
    if (!answerId) return;
    
    try {
      setIsSaving(true);
      await apiService.inspectionAnswers.update(answerId, {
        date: editDate,
      });
      
      // Reload preview to get updated data
      const response = await apiService.reports.getAnswerPreview(answerId);
      setPreview(response.data);
      setEditDate(response.data.d?.metadata?.date || '');
      
      setIsEditingDate(false);
    } catch (err: any) {
      console.error('Failed to update date:', err);
      alert('Огноо хадгалахад алдаа гарлаа');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRemarks = async () => {
    if (!answerId) return;
    
    try {
      setIsSaving(true);
      await apiService.inspectionAnswers.update(answerId, {
        remarks: editRemarks,
      });
      
      // Reload preview to get updated data
      const response = await apiService.reports.getAnswerPreview(answerId);
      setPreview(response.data);
      setEditRemarks(response.data.d?.remarks || '');
      
      setIsEditingRemarks(false);
    } catch (err: any) {
      console.error('Failed to update remarks:', err);
      alert('Санал тэмдэглэл хадгалахад алдаа гарлаа');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveComment = async (section: string, fieldId: string) => {
    if (!answerId) return;
    
    try {
      setIsSaving(true);
      await apiService.inspectionAnswers.update(answerId, {
        section,
        fieldId,
        comment: editComment,
      });
      
      // Reload preview to get updated data
      const response = await apiService.reports.getAnswerPreview(answerId);
      setPreview(response.data);
      
      setEditingComment(null);
      setEditComment('');
    } catch (err: any) {
      console.error('Failed to update comment:', err);
      alert('Тайлбар хадгалахад алдаа гарлаа');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelComment = () => {
    setEditingComment(null);
    setEditComment('');
  };

  const handleSaveRepairAfterText = async () => {
    if (!repairIdString) return;
    
    try {
      setIsSaving(true);
      await apiService.repairs.update(repairIdString, {
        repairDescription: editRepairAfterText,
      });
      
      // Reload preview to get updated data
      if (repairInspectionId) {
        const response = await apiService.reports.getRepairPreview(repairInspectionId, repairIdString);
        setPreview(response.data);
        setEditRepairAfterText(response.data.d?.repair?.after_text || '');
      }
      
      setEditingRepairAfterText(false);
    } catch (err: any) {
      console.error('Failed to update repair after_text:', err);
      alert('Дараах байдлын тайлбар хадгалахад алдаа гарлаа');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelRepairAfterText = () => {
    setEditingRepairAfterText(false);
    // Reset to original value
    if (preview?.d?.repair) {
      setEditRepairAfterText(preview.d.repair.after_text || '');
    }
  };

  const signatureSrc = useMemo(
    () => toSignatureSrc(preview?.d.signatures?.inspector || null),
    [preview]
  );

  const handleImageToggle = (src: string, alt: string) => {
    if (!src) return;
    setEnlargedImage(prev => (prev && prev.src === src ? null : { src, alt }));
  };

  if (isLoading) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
        <div className="px-4 py-6 sm:px-6">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-4 text-gray-600 text-sm">A4 preview ачаалж байна...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
        <div className="px-4 py-6 sm:px-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
        <div className="px-4 py-6 sm:px-6">
          <div className="text-center py-8">
            <p className="text-gray-500">Тайлангийн мэдээлэл олдсонгүй</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white shadow overflow-hidden sm:rounded-md mb-6">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">A4 Preview</h3>
        <p className="text-sm text-gray-500">
          {repairInspectionId ? 'Засварын тайлан' : 'Үзлэгийн тайлан'} • {preview.inspection.title || 'Гарчиггүй'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="bg-white shadow-xl border border-gray-300 w-[794px] min-h-[1123px] mx-auto my-6 print:w-full">
          <header className="px-8 py-6 border-b border-gray-300 text-center">
            <p className="uppercase text-sm text-gray-500 tracking-[0.4em]">
              Exterior
            </p>
            <h2 className="text-2xl font-bold text-gray-900 mt-2">
              АВТО ЖИН ХЭМЖҮҮРИЙН ҮЗЛЭГИЙН ХУУДАС
            </h2>
          </header>

          <section className="px-8 py-6 grid grid-cols-2 gap-6 border-b border-gray-200">
            <div>
              <h3 className="font-semibold text-lg uppercase tracking-wide mb-3">
                Гэрээний мэдээлэл
              </h3>
              <table className="w-full text-sm border border-gray-300">
                <tbody>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Гэрээт компанийн нэр
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.contractor?.company || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Гэрээний дугаар
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.contractor?.contract_no || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Холбоо барих
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.contractor?.contact || '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-semibold text-lg uppercase tracking-wide mb-3">
                Ерөнхий мэдээлэл
              </h3>
              <table className="w-full text-sm border border-gray-300">
                <tbody>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Огноо
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {answerId && isEditingDate ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                            disabled={isSaving}
                          />
                          <button
                            onClick={handleSaveDate}
                            disabled={isSaving}
                            className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:bg-gray-400"
                          >
                            {isSaving ? '...' : '✓'}
                          </button>
                          <button
                            onClick={() => {
                              setEditDate(preview.d?.metadata?.date || '');
                              setIsEditingDate(false);
                            }}
                            disabled={isSaving}
                            className="px-3 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 disabled:bg-gray-200"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div 
                          className="flex items-center justify-between group cursor-pointer"
                          onClick={() => answerId && setIsEditingDate(true)}
                        >
                          <span>{preview.d?.metadata?.date || '—'}</span>
                          {answerId && (
                            <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 ml-2">
                              ✏️
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Шалгагч
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.metadata?.inspector || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Байршил
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.metadata?.location || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Автожингийн дугаар
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.metadata?.scale_id_serial_no || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Модель
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d?.metadata?.model || '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Үзлэгийн тайлангийн хэсгүүд (зөвхөн answerId байгаа үед) */}
          {!repairInspectionId && preview.d?.exterior && (
            <>
              <TableSection 
                title="Автожингийн тавцан" 
                rows={generateRowsFromData(preview.d.exterior || {}, 'exterior', fieldLabels.exterior)} 
                data={preview.d} 
                sectionName="exterior" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />
              <TableSection 
                title="Тооцоолуур" 
                rows={generateRowsFromData(preview.d.indicator || {}, 'indicator', fieldLabels.indicator)} 
                data={preview.d} 
                sectionName="indicator" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />
              <TableSection 
                title="Автожингийн холбогч хайрцаг" 
                rows={generateRowsFromData(preview.d.jbox || {}, 'jbox', fieldLabels.jbox)} 
                data={preview.d} 
                sectionName="jbox" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />
              <TableSection 
                title="Мэдрэгч элемент" 
                rows={generateRowsFromData(preview.d.sensor || {}, 'sensor', fieldLabels.sensor)} 
                data={preview.d} 
                sectionName="sensor" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />
              <TableSection 
                title="Суурь" 
                rows={generateRowsFromData(preview.d.foundation || {}, 'foundation', fieldLabels.foundation)} 
                data={preview.d} 
                sectionName="foundation" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />
              <TableSection 
                title="Автожингийн бохирдол" 
                rows={generateRowsFromData(preview.d.cleanliness || {}, 'cleanliness', fieldLabels.cleanliness)} 
                data={preview.d} 
                sectionName="cleanliness" 
                onImageClick={handleImageToggle}
                answerId={answerId}
                editingComment={editingComment}
                editComment={editComment}
                onEditComment={(section, fieldId, currentComment) => {
                  setEditingComment({ section, fieldId });
                  setEditComment(currentComment);
                }}
                onSaveComment={handleSaveComment}
                onCancelComment={handleCancelComment}
                isSaving={isSaving}
              />

              <section className="px-8 py-6 border-t border-gray-200">
                <h3 className="font-semibold text-lg uppercase tracking-wide mb-3">
                  Санал, тэмдэглэл
                </h3>
                {answerId && isEditingRemarks ? (
                  <div className="border border-gray-300 px-4 py-3">
                    <textarea
                      value={editRemarks}
                      onChange={(e) => setEditRemarks(e.target.value)}
                      className="w-full min-h-[120px] text-sm border-0 focus:outline-none resize-none"
                      disabled={isSaving}
                      placeholder="Санал тэмдэглэл оруулах..."
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={handleSaveRemarks}
                        disabled={isSaving}
                        className="px-4 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:bg-gray-400"
                      >
                        {isSaving ? 'Хадгалж байна...' : 'Хадгалах'}
                      </button>
                      <button
                        onClick={() => {
                          setEditRemarks(preview.d?.remarks || '');
                          setIsEditingRemarks(false);
                        }}
                        disabled={isSaving}
                        className="px-4 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400 disabled:bg-gray-200"
                      >
                        Цуцлах
                      </button>
                    </div>
                  </div>
                ) : (
                  <div 
                    className="border border-gray-300 px-4 py-3 min-h-[120px] text-sm whitespace-pre-line group cursor-pointer relative"
                    onClick={() => answerId && setIsEditingRemarks(true)}
                  >
                    {preview.d.remarks || '—'}
                    {answerId && (
                      <span className="absolute top-2 right-2 text-xs text-gray-400 opacity-0 group-hover:opacity-100">
                        ✏️ Засах
                      </span>
                    )}
                  </div>
                )}
              </section>

              <section className="px-8 py-6 border-t border-gray-200">
                <h3 className="font-semibold text-lg uppercase tracking-wide mb-4">
                  Гарын үсэг
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="border border-gray-300 px-4 py-4 min-h-[140px] flex flex-col justify-between">
                    <p className="text-sm font-medium text-gray-700 mb-4">
                      Үзлэг хийсэн хүний гарын үсэг
                    </p>
                    {signatureSrc ? (
                      <img
                        src={signatureSrc}
                        alt="Inspector Signature"
                        className="h-20 object-contain"
                      />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-xs text-gray-400">
                        Гарын үсэг ирээгүй
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-4">
                      Нэр: {preview.d?.metadata?.inspector || '—'}
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* Засварын тайлангийн хэсгүүд (зөвхөн repairInspectionId байгаа үед) */}
          {repairInspectionId && preview.d?.repair && (
            <section className="px-8 py-6 border-t border-gray-200">
              {/* Section-Field нэрийг харуулах */}
              <div className="mb-4">
                <h3 className="font-semibold text-lg uppercase tracking-wide">
                  {preview.d.repair.section_field || `${preview.d.repair.section} - ${preview.d.repair.field}` || 'Засварын мэдээлэл'}
                </h3>
              </div>

              {/* Засварын мэдээлэл - хүснэгт */}
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-3 py-2 text-left font-medium">Өмнөх байдал</th>
                      <th className="border border-gray-300 px-3 py-2 text-left font-medium">Дараах байдал</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 px-3 py-2">
                        {preview.d.repair.before_text || '—'}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {repairIdString && editingRepairAfterText ? (
                          <div className="flex flex-col">
                            <textarea
                              value={editRepairAfterText}
                              onChange={(e) => setEditRepairAfterText(e.target.value)}
                              className="w-full min-h-[60px] text-sm border-0 focus:outline-none resize-none"
                              disabled={isSaving}
                              placeholder="Дараах байдлын тайлбар оруулах..."
                            />
                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={handleSaveRepairAfterText}
                                disabled={isSaving}
                                className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:bg-gray-400"
                              >
                                {isSaving ? '...' : '✓ Хадгалах'}
                              </button>
                              <button
                                onClick={handleCancelRepairAfterText}
                                disabled={isSaving}
                                className="px-3 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 disabled:bg-gray-200"
                              >
                                ✕ Цуцлах
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="flex items-center justify-between group cursor-pointer min-h-[60px] relative"
                            onClick={() => {
                              console.log('[A4Preview] Click repair after_text, repairIdString:', repairIdString);
                              if (repairIdString) {
                                setEditingRepairAfterText(true);
                                setEditRepairAfterText(preview.d?.repair?.after_text || '');
                              } else {
                                console.warn('[A4Preview] repairIdString is null/undefined, cannot edit');
                              }
                            }}
                          >
                            <span className="whitespace-pre-line flex-1">{preview.d.repair.after_text || '—'}</span>
                            {repairIdString ? (
                              <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2">
                                ✏️ Засах
                              </span>
                            ) : (
                              <span className="text-xs text-red-400 opacity-50 absolute top-2 right-2">
                                (repairId байхгүй)
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Зургийн мөр */}
                    <tr>
                      <td className="border border-gray-300 px-3 py-2">
                        {preview.d.repair.beforeImagePreview ? (
                          <div className="flex items-center justify-center">
                            <img
                              src={preview.d.repair.beforeImagePreview.base64 
                                ? `data:${preview.d.repair.beforeImagePreview.mimeType};base64,${preview.d.repair.beforeImagePreview.base64}`
                                : preview.d.repair.beforeImagePreview.imageUrl
                              }
                              alt="Өмнөх зураг"
                              className="max-w-[200px] max-h-[150px] object-contain border border-gray-200 rounded cursor-zoom-in"
                              onClick={() => {
                                if (!preview.d.repair?.beforeImagePreview) return;
                                const src = preview.d.repair.beforeImagePreview.base64 
                                  ? `data:${preview.d.repair.beforeImagePreview.mimeType};base64,${preview.d.repair.beforeImagePreview.base64}`
                                  : preview.d.repair.beforeImagePreview.imageUrl;
                                handleImageToggle(src, 'Өмнөх зураг');
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'text-gray-400 text-xs';
                                errorDiv.textContent = 'Зураг ачаалж чадсангүй';
                                target.parentElement?.appendChild(errorDiv);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="text-gray-400 text-xs">Зураг байхгүй</div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-3 py-2">
                        {preview.d.repair.afterImagePreview ? (
                          <div className="flex items-center justify-center">
                            <img
                              src={preview.d.repair.afterImagePreview.base64 
                                ? `data:${preview.d.repair.afterImagePreview.mimeType};base64,${preview.d.repair.afterImagePreview.base64}`
                                : preview.d.repair.afterImagePreview.imageUrl
                              }
                              alt="Дараах зураг"
                              className="max-w-[200px] max-h-[150px] object-contain border border-gray-200 rounded cursor-zoom-in"
                              onClick={() => {
                                if (!preview.d.repair?.afterImagePreview) return;
                                const src = preview.d.repair.afterImagePreview.base64 
                                  ? `data:${preview.d.repair.afterImagePreview.mimeType};base64,${preview.d.repair.afterImagePreview.base64}`
                                  : preview.d.repair.afterImagePreview.imageUrl;
                                handleImageToggle(src, 'Дараах зураг');
                              }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'text-gray-400 text-xs';
                                errorDiv.textContent = 'Зураг ачаалж чадсангүй';
                                target.parentElement?.appendChild(errorDiv);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="text-gray-400 text-xs">Зураг байхгүй</div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              {/* Үзлэг хийсэн хүний гарын үсэг */}
              {preview.d?.signatures?.inspector && (
                <div className="mt-6 pt-4 border-t border-gray-300">
                  <h4 className="font-semibold text-sm uppercase tracking-wide mb-3">
                    Үзлэг хийсэн хүний гарын үсэг
                  </h4>
                  <div className="flex justify-start">
                    {signatureSrc && (
                      <img
                        src={signatureSrc}
                        alt="Гарын үсэг"
                        className="max-w-[200px] max-h-[80px] object-contain border border-gray-200 rounded"
                      />
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      </div>
      {enlargedImage && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setEnlargedImage(null)}
          role="presentation"
        >
          <div className="relative max-w-5xl w-full">
            <img
              src={enlargedImage.src}
              alt={enlargedImage.alt}
              className="max-h-[85vh] w-full object-contain rounded-lg shadow-2xl bg-white"
            />
            <button
              type="button"
              className="absolute top-4 right-4 bg-white/90 text-gray-900 rounded-full p-2 shadow hover:bg-white"
              onClick={(e) => {
                e.stopPropagation();
                setEnlargedImage(null);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}

