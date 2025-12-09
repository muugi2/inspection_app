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
      };
      exterior: Record<string, FieldValue>;
      indicator: Record<string, FieldValue>;
      jbox: Record<string, FieldValue>;
      sensor: Record<string, FieldValue>;
      foundation: Record<string, FieldValue>;
      cleanliness: Record<string, FieldValue>;
      remarks: string;
      signatures: {
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

// Dynamic function to generate rows from backend data
// Shows all fields from backend, with labels from fieldLabelMap if available
function generateRowsFromData(
  sectionData: Record<string, FieldValue>,
  sectionName: string,
  fieldLabelMap: Record<string, string>
): RowDefinition[] {
  if (!sectionData) return [];
  
  // Include all fields from backend data
  // Use label from fieldLabelMap if available, otherwise use the field key as label
  return Object.keys(sectionData)
    .filter(key => {
      // Filter out null/undefined values and metadata fields
      const value = sectionData[key];
      const excludedKeys = ['metadata', 'section', 'sessionStartedAt', 'lastUpdatedAt', 'sectionStatus', 'completedAt'];
      return value !== null && 
             value !== undefined && 
             !excludedKeys.includes(key);
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
  },
  indicator: {
    led_display: 'Лед дэлгэц',
    power_plug: 'Тэжээлийн залгуур',
    seal_bolt: 'Лац болон лацны боолт',
    buttons: 'Товчлуур',
    junction_wiring: 'Холбогч хайрцаг болон сигналын утас',
    serial_converter_plug: 'Сериал хөрвүүлэгч залгуур', // Backend maps 'serial_converter' to 'serial_converter_plug'
    battery: 'Батарей',
  },
  jbox: {
    box_integrity: 'Хайрцагны бүрэн бүтэн байдал',
    collector_board: 'Сигналын утас цуглуулагч хавтан',
    wire_tightener: 'Сигналын утас чангалагч',
    resistor_element: 'Эсэргүүцлийн элемент',
    protective_box: 'Холбогч хайрцагны хамгаалалтын гадна хайрцаг',
  },
  sensor: {
    signal_wire: 'Сигналын утас',
    ball: 'Шаариг',
    base: 'Мэдрэгчийн суурь',
    ball_cup_thin: 'Шааригны аяган суурь /нимгэн/',
    plate: 'Ялтсан хавтан',
  },
  foundation: {
    cross_base: 'Хөндлөн суурь',
    anchor_plate: 'Суурийн анкер лист',
    ramp_angle: 'Пандусын угольник',
    ramp_stopper: 'Пандусын өшиглүүр',
    ramp: 'Пандус',
    slab_base: 'Нил суурь',
    sensor_base: 'Мэдрэгчийн суурь',
  },
  cleanliness: {
    under_platform: 'Тавцангийн доод тал',
    top_platform: 'Тавцангийн дээд тал',
    gap_platform_ramp: 'Автожингийн тавцан болон Пандус хоорондын завсар',
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
    label: 'Сериал хөрвүүлэгч залгуур',
    path: 'indicator.serial_converter_plug',
  },
  { label: 'Батарей', path: 'indicator.battery' },
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
  { label: 'Эсэргүүцлийн элемент', path: 'jbox.resistor_element' },
  {
    label: 'Холбогч хайрцагны хамгаалалтын хайрцаг',
    path: 'jbox.protective_box',
  },
];

const sensorRows: RowDefinition[] = [
  { label: 'Сигналын утас', path: 'sensor.signal_wire' },
  { label: 'Шаариг', path: 'sensor.ball' },
  { label: 'Мэдрэгчийн суурь', path: 'sensor.base' },
  { label: 'Шааригны аяган суурь /нимгэн/', path: 'sensor.ball_cup_thin' },
  { label: 'Ялтсан хавтан', path: 'sensor.plate' },
];

const foundationRows: RowDefinition[] = [
  { label: 'Хөндлөн суурь', path: 'foundation.cross_base' },
  { label: 'Суурийн анкер лист', path: 'foundation.anchor_plate' },
  { label: 'Пандусын угольник', path: 'foundation.ramp_angle' },
  { label: 'Пандусын өшиглүүр', path: 'foundation.ramp_stopper' },
  { label: 'Пандус', path: 'foundation.ramp' },
  { label: 'Нил суурь', path: 'foundation.slab_base' },
  { label: 'Мэдрэгчийн суурь', path: 'foundation.sensor_base' },
];

const cleanlinessRows: RowDefinition[] = [
  { label: 'Тавцангийн доод тал', path: 'cleanliness.under_platform' },
  { label: 'Тавцангийн дээд тал', path: 'cleanliness.top_platform' },
  {
    label: 'Тавцан болон Пандус хоорондын завсар',
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
}: {
  title: string;
  rows: RowDefinition[];
  data: PreviewResponse['data']['d'];
  sectionName: string;
  onImageClick?: (src: string, alt: string) => void;
}) {
  // Field ID mapping - maps display field ID to backend field ID
  // Backend uses 'serial_converter' but frontend displays as 'serial_converter_plug'
  const fieldIdMap: Record<string, string> = {
    'exterior.platform_plate': 'platform_plate',
    'exterior.beam_joint_plate': 'beam_joint_plate',
    'exterior.stop_bolt': 'stop_bolt',
    'exterior.interplatform_bolts': 'interplatform_bolts',
    'indicator.led_display': 'led_display',
    'indicator.power_plug': 'power_plug',
    'indicator.seal_bolt': 'seal_bolt',
    'indicator.buttons': 'buttons',
    'indicator.junction_wiring': 'junction_wiring',
    'indicator.serial_converter_plug': 'serial_converter', // Backend field ID
    'indicator.battery': 'battery',
    'jbox.box_integrity': 'box_integrity',
    'jbox.collector_board': 'collector_board',
    'jbox.wire_tightener': 'wire_tightener',
    'jbox.resistor_element': 'resistor_element',
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
                <td className="border border-gray-300 px-3 py-2 whitespace-pre-line">
                  {field.comment || '—'}
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
  answerId: string;
}

export default function A4Preview({ answerId }: A4PreviewProps) {
  const [preview, setPreview] = useState<PreviewResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enlargedImage, setEnlargedImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const fetchPreview = async () => {
      if (!answerId) return;
      try {
        setIsLoading(true);
        setError(null);
        const response: PreviewResponse = await apiService.reports.getAnswerPreview(
          answerId
        );
        setPreview(response.data);
      } catch (err: any) {
        console.error('Failed to load report preview:', err);
        setError(
          err?.response?.data?.message ||
            'Тайлангийн мэдээлэл ачаалахад алдаа гарлаа.'
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreview();
  }, [answerId]);

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
          Үзлэгийн ID: {preview.answer?.id || answerId} • Үзлэг: {preview.inspection.title || 'Гарчиггүй'}
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
                      {preview.d.contractor.company || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Гэрээний дугаар
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.contractor.contract_no || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Холбоо барих
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.contractor.contact || '—'}
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
                      {preview.d.metadata.date || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Шалгагч
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.metadata.inspector || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Байршил
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.metadata.location || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Автожингийн дугаар
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.metadata.scale_id_serial_no || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-gray-100 border border-gray-300 px-3 py-2 font-medium">
                      Модель
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {preview.d.metadata.model || '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <TableSection 
            title="Автожингийн тавцан" 
            rows={generateRowsFromData(preview.d.exterior, 'exterior', fieldLabels.exterior)} 
            data={preview.d} 
            sectionName="exterior" 
            onImageClick={handleImageToggle} 
          />
          <TableSection 
            title="Тооцоолуур" 
            rows={generateRowsFromData(preview.d.indicator, 'indicator', fieldLabels.indicator)} 
            data={preview.d} 
            sectionName="indicator" 
            onImageClick={handleImageToggle} 
          />
          <TableSection 
            title="Автожингийн холбогч хайрцаг" 
            rows={generateRowsFromData(preview.d.jbox, 'jbox', fieldLabels.jbox)} 
            data={preview.d} 
            sectionName="jbox" 
            onImageClick={handleImageToggle} 
          />
          <TableSection 
            title="Мэдрэгч элемент" 
            rows={generateRowsFromData(preview.d.sensor, 'sensor', fieldLabels.sensor)} 
            data={preview.d} 
            sectionName="sensor" 
            onImageClick={handleImageToggle} 
          />
          <TableSection 
            title="Суурь" 
            rows={generateRowsFromData(preview.d.foundation, 'foundation', fieldLabels.foundation)} 
            data={preview.d} 
            sectionName="foundation" 
            onImageClick={handleImageToggle} 
          />
          <TableSection 
            title="Автожингийн бохирдол" 
            rows={generateRowsFromData(preview.d.cleanliness, 'cleanliness', fieldLabels.cleanliness)} 
            data={preview.d} 
            sectionName="cleanliness" 
            onImageClick={handleImageToggle} 
          />

          <section className="px-8 py-6 border-t border-gray-200">
            <h3 className="font-semibold text-lg uppercase tracking-wide mb-3">
              Санал, тэмдэглэл
            </h3>
            <div className="border border-gray-300 px-4 py-3 min-h-[120px] text-sm whitespace-pre-line">
              {preview.d.remarks || '—'}
            </div>
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
                  Нэр: {preview.d.metadata.inspector || '—'}
                </p>
              </div>
            </div>
          </section>
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

