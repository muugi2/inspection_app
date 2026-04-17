/**
 * Inspect installation-report DOCX: extract text and count structure for loops verification.
 * Run: node scripts/inspect-installation-docx.js
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const docxPath = path.join(__dirname, '..', 'templates', 'installation-report-38 (3).docx');
if (!fs.existsSync(docxPath)) {
  console.error('File not found:', docxPath);
  process.exit(1);
}

const buf = fs.readFileSync(docxPath);
JSZip.loadAsync(buf)
  .then((zip) => zip.file('word/document.xml').async('string'))
  .then((xml) => {
    const pCount = (xml.match(/<w:p\s/g) || []).length;
    const drawingCount = (xml.match(/<a:blip/g) || []).length;
    const tblCount = (xml.match(/<w:tbl\s/g) || []).length;

    // Extract all text from w:t elements to see content order
    const texts = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(xml)) !== null) texts.push(m[1]);

    const fullText = texts.join('');
    const lines = fullText.split(/\s+/).filter(Boolean);

    console.log('=== installation-report-38 (3).docx structure ===');
    console.log('Paragraphs (w:p):', pCount);
    console.log('Tables (w:tbl):', tblCount);
    console.log('Images (a:blip):', drawingCount);
    console.log('');
    console.log('--- Extracted text (first ~2500 chars) ---');
    console.log(fullText.substring(0, 2500));
    console.log('');
    console.log('--- Key phrases check ---');
    const hasContract = fullText.includes('Гэрээт') || fullText.includes('Гэрээний');
    const hasAct = fullText.includes('Акт') || fullText.includes('Гарчиг');
    const hasSection = fullText.includes('Ерөнхий') || fullText.includes('Байршил');
    console.log('Contract section:', hasContract);
    console.log('Act / Гарчиг:', hasAct);
    console.log('General/Section-like:', hasSection);

    const eronkhiiCount = (fullText.match(/Ерөнхий мэдээлэл/g) || []).length;
    const aktCount = (fullText.match(/Акт\s/g) || []).length;
    const garchigCount = (fullText.match(/Гарчиг:/g) || []).length;
    const tailbarCount = (fullText.match(/Тайлбар:/g) || []).length;
    console.log('');
    console.log('--- Loop counts ---');
    console.log('"Ерөнхий мэдээлэл" blocks (expected: 1 per installationItem):', eronkhiiCount);
    console.log('"Акт" headings:', aktCount);
    console.log('"Гарчиг:" (act + field titles):', garchigCount);
    console.log('"Тайлбар:" (act + field comments):', tailbarCount);
    console.log('');
    console.log('--- Full extracted text ---');
    console.log(fullText);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
