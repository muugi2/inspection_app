/**
 * Monthly Report Verification Script
 * 
 * Энэ script нь 1 сарын тайлангийн PDF дээрх мэдээлэл болон
 * MySQL database дээрх мэдээлэл хоорондын зөрүүг шалгана.
 * 
 * Usage: node scripts/verify-monthly-report.js <orgId> <year> <month>
 * Example: node scripts/verify-monthly-report.js 29 2026 1
 */

const { PrismaClient } = require('@prisma/client');
const { buildInspectionReportData } = require('../services/report-service');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// PDF файлын суурь зам (жишээ: monthly-report-<orgId>-<year>-<month>.pdf)
function getPdfPath(orgId, year, month) {
  const filename = `monthly-report-${orgId}-${year}-${month}.pdf`;
  return path.join(__dirname, '..', 'templates', filename);
}

/**
 * Database-аас мэдээлэл авах
 */
async function getDatabaseData(orgId, year, month) {
  console.log(`\n📊 Database-аас мэдээлэл авах: orgId=${orgId}, year=${year}, month=${month}\n`);
  
  // Сарын эхлэл болон төгсгөлийн огноо тооцоолох
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  console.log(`📅 Огнооны хүрээ: ${startDate.toISOString()} - ${endDate.toISOString()}`);

  // Тухайн сард хийгдсэн бүх inspection answer-уудыг олох
  const answers = await prisma.InspectionAnswer.findMany({
    where: {
      inspection: {
        site: {
          orgId: BigInt(orgId),
        },
        deletedAt: null,
      },
      answeredAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      inspection: {
        include: {
          contract: { include: { organization: true } },
          site: { include: { organization: true } },
          device: { include: { model: true } },
        },
      },
    },
    orderBy: {
      answeredAt: 'asc',
    },
  });

  console.log(`✅ Олдсон үзлэгийн тоо: ${answers.length}\n`);

  if (answers.length === 0) {
    console.log('⚠️  Энэ сард үзлэг олдсонгүй!');
    return null;
  }

  // Бүх үзлэгүүдийн мэдээллийг бэлтгэх
  const inspectionsData = [];

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 Үзлэг #${i + 1} (Answer ID: ${answer.id.toString()})`);
    console.log(`${'='.repeat(80)}`);

    try {
      // Нэг үзлэгийн мэдээллийг бэлтгэх
      const reportData = await buildInspectionReportData(prisma, {
        answerId: answer.id,
      });

      const inspectionInfo = {
        answerId: answer.id.toString(),
        inspectionId: answer.inspection.id.toString(),
        answeredAt: answer.answeredAt,
        metadata: reportData.d?.metadata || {},
        contractor: reportData.d?.contractor || {},
        sections: {
          exterior: reportData.d?.exterior || {},
          indicator: reportData.d?.indicator || {},
          jbox: reportData.d?.jbox || {},
          sensor: reportData.d?.sensor || {},
          foundation: reportData.d?.foundation || {},
          cleanliness: reportData.d?.cleanliness || {},
        },
        remarks: reportData.d?.remarks || '',
        images: reportData.d?.images || [],
        device: {
          serialNumber: answer.inspection.device?.serialNumber || '',
          model: answer.inspection.device?.model?.model || '',
          manufacturer: answer.inspection.device?.model?.manufacturer || '',
        },
        site: {
          name: answer.inspection.site?.name || '',
        },
      };

      // Дэлгэрэнгүй мэдээлэл хэвлэх
      console.log(`\n📌 Ерөнхий мэдээлэл:`);
      console.log(`   - Огноо: ${inspectionInfo.metadata.date || 'N/A'}`);
      console.log(`   - Үзлэгч: ${inspectionInfo.metadata.inspector || 'N/A'}`);
      console.log(`   - Байршил: ${inspectionInfo.metadata.location || 'N/A'}`);
      console.log(`   - Модель: ${inspectionInfo.metadata.model || 'N/A'}`);
      console.log(`   - Серийн дугаар: ${inspectionInfo.metadata.scale_id_serial_no || 'N/A'}`);

      console.log(`\n📋 Гэрээний мэдээлэл:`);
      console.log(`   - Компани: ${inspectionInfo.contractor.company || 'N/A'}`);
      console.log(`   - Гэрээний дугаар: ${inspectionInfo.contractor.contract_no || 'N/A'}`);
      console.log(`   - Холбоо барих: ${inspectionInfo.contractor.contact || 'N/A'}`);

      console.log(`\n🔧 Төхөөрөмж:`);
      console.log(`   - Серийн дугаар: ${inspectionInfo.device.serialNumber || 'N/A'}`);
      console.log(`   - Модель: ${inspectionInfo.device.model || 'N/A'}`);
      console.log(`   - Үйлдвэрлэгч: ${inspectionInfo.device.manufacturer || 'N/A'}`);

      console.log(`\n📸 Зургийн тоо: ${inspectionInfo.images.length}`);

      // Section-уудын мэдээлэл
      console.log(`\n📊 Хэсгүүдийн мэдээлэл:`);
      const sections = ['exterior', 'indicator', 'jbox', 'sensor', 'foundation', 'cleanliness'];
      for (const section of sections) {
        const sectionData = inspectionInfo.sections[section];
        if (sectionData && Object.keys(sectionData).length > 0) {
          const fieldCount = Object.keys(sectionData).length;
          console.log(`   - ${section}: ${fieldCount} field(s)`);
          
          // Эхний 3 field-ийн мэдээлэл хэвлэх
          let count = 0;
          for (const [fieldKey, fieldData] of Object.entries(sectionData)) {
            if (count < 3 && fieldData && typeof fieldData === 'object') {
              console.log(`     • ${fieldKey}: ${fieldData.status || 'N/A'}`);
              count++;
            }
          }
        }
      }

      console.log(`\n💬 Санал тэмдэглэл: ${inspectionInfo.remarks || '(хоосон)'}`);

      inspectionsData.push(inspectionInfo);
    } catch (error) {
      console.error(`\n❌ Алдаа гарлаа (Answer ID: ${answer.id.toString()}):`, error.message);
      inspectionsData.push({
        answerId: answer.id.toString(),
        error: error.message,
      });
    }
  }

  return {
    orgId,
    year,
    month,
    totalInspections: answers.length,
    inspections: inspectionsData,
    summary: {
      totalAnswers: answers.length,
      totalImages: inspectionsData.reduce((sum, inv) => sum + (inv.images?.length || 0), 0),
      contractors: [...new Set(inspectionsData.map(inv => inv.contractor?.company).filter(Boolean))],
    },
  };
}

/**
 * PDF файлын мэдээлэл шалгах (зөвхөн файлын мэдээлэл)
 */
function checkPDFFile(orgId, year, month) {
  console.log(`\n📄 PDF файлыг шалгах...\n`);
  const PDF_PATH = getPdfPath(orgId, year, month);

  if (!fs.existsSync(PDF_PATH)) {
    console.log(`❌ PDF файл олдсонгүй: ${PDF_PATH}`);
    return null;
  }

  const stats = fs.statSync(PDF_PATH);
  console.log(`✅ PDF файл олдлоо:`);
  console.log(`   - Зам: ${PDF_PATH}`);
  console.log(`   - Хэмжээ: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Өөрчлөгдсөн огноо: ${stats.mtime.toISOString()}`);
  
  console.log(`\n⚠️  Анхаар: PDF файлын агуулгыг гараар шалгах хэрэгтэй.`);
  console.log(`   PDF файлыг нээж, database-аас гаргасан мэдээлэлтэй харьцуулна уу.\n`);

  return {
    path: PDF_PATH,
    size: stats.size,
    modified: stats.mtime,
  };
}

/**
 * Мэдээллийг JSON файл болгон хадгалах
 */
async function saveToJSON(data, filename) {
  const outputPath = path.join(__dirname, '..', 'templates', filename);
  // Маш их хэмжээний string-ээс зайлсхийхийн тулд зөвхөн summary + үндсэн тоонуудыг хадгална
  const lightweight = {
    orgId: data.orgId,
    year: data.year,
    month: data.month,
    totalInspections: data.totalInspections,
    summary: data.summary,
  };
  fs.writeFileSync(outputPath, JSON.stringify(lightweight, null, 2), 'utf8');
  console.log(`\n💾 Мэдээлэл хадгалагдлаа: ${outputPath}`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node scripts/verify-monthly-report.js <orgId> <year> <month>');
    console.log('Example: node scripts/verify-monthly-report.js 29 2026 1');
    process.exit(1);
  }

  const orgId = parseInt(args[0]);
  const year = parseInt(args[1]);
  const month = parseInt(args[2]);

  if (isNaN(orgId) || isNaN(year) || isNaN(month)) {
    console.error('❌ Буруу параметрүүд! orgId, year, month нь тоо байх ёстой.');
    process.exit(1);
  }

  if (month < 1 || month > 12) {
    console.error('❌ Сар нь 1-12 хооронд байх ёстой.');
    process.exit(1);
  }

  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 1 САРЫН ТАЙЛАНГИЙН МЭДЭЭЛЭЛ ШАЛГАХ');
    console.log('='.repeat(80));

    // Database-аас мэдээлэл авах
    const dbData = await getDatabaseData(orgId, year, month);
    
    // PDF файлыг шалгах (monthly-report-<orgId>-<year>-<month>.pdf)
    const pdfInfo = checkPDFFile(orgId, year, month);

    // Мэдээллийг JSON файл болгон хадгалах
    if (dbData) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await saveToJSON(dbData, `monthly-report-db-data-${orgId}-${year}-${month}-${timestamp}.json`);
    }

    // Дүгнэлт
    console.log('\n' + '='.repeat(80));
    console.log('📊 ДҮГНЭЛТ');
    console.log('='.repeat(80));
    
    if (dbData) {
      console.log(`\n✅ Database-аас ${dbData.totalInspections} үзлэг олдлоо.`);
      console.log(`📄 JSON summary файл үүсгэгдсэн. PDF файлын мэдээлэлтэй харьцуулна уу.`);
      
      if (dbData.summary) {
        console.log(`\n📈 Товч мэдээлэл:`);
        console.log(`   - Нийт үзлэг: ${dbData.summary.totalAnswers}`);
        console.log(`   - Нийт зураг: ${dbData.summary.totalImages}`);
        console.log(`   - Гэрээний компани: ${dbData.summary.contractors.join(', ') || 'N/A'}`);
      }
    }

    if (pdfInfo) {
      console.log(`\n✅ PDF файл олдлоо: ${pdfInfo.path}`);
    }

    console.log(`\n💡 Зөвлөмж:`);
    console.log(`   1. JSON файлыг нээж, database-аас гаргасан мэдээллийг шалгана уу.`);
    console.log(`   2. PDF файлыг нээж, JSON файл дээрх мэдээлэлтэй харьцуулна уу.`);
    console.log(`   3. Зөрүүтэй хэсгүүдийг тэмдэглэж, код-ийг шалгана уу.\n`);

  } catch (error) {
    console.error('\n❌ Алдаа гарлаа:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Script ажиллуулах
main();
