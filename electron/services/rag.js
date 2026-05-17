const fs = require('fs');
const path = require('path');

let ragFolderPath = null;

function setFolder(folderPath) {
  ragFolderPath = folderPath || null;
}

function getFolder() {
  return ragFolderPath;
}

// pdf-parse v2.x — use the standard require
const pdfParse = require('pdf-parse');

async function extractPdfText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.warn(`[RAG] Failed to parse PDF "${path.basename(filePath)}":`, err.message);
    return null;
  }
}

/**
 * Read all PDFs from the configured folder and return a context string
 * ready to be appended to the system prompt.
 */
// Max characters of PDF content to inject — keeps context within small model limits
const MAX_CONTEXT_CHARS = 6000;

async function buildContext() {
  if (!ragFolderPath) return '';

  console.log('[RAG] Building context from folder:', ragFolderPath);

  let files;
  try {
    files = fs.readdirSync(ragFolderPath);
  } catch (err) {
    console.warn('[RAG] Cannot read folder:', err.message);
    return '';
  }

  const pdfFiles = files.filter((f) => f.toLowerCase().endsWith('.pdf'));
  console.log(`[RAG] Found ${pdfFiles.length} PDF(s):`, pdfFiles);
  if (pdfFiles.length === 0) return '';

  const sections = [];
  let totalChars = 0;

  for (const file of pdfFiles) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;
    const filePath = path.join(ragFolderPath, file);
    const text = await extractPdfText(filePath);
    if (text && text.trim()) {
      const remaining = MAX_CONTEXT_CHARS - totalChars;
      const chunk = text.trim().slice(0, remaining);
      sections.push(`### ${file}\n${chunk}`);
      totalChars += chunk.length;
      console.log(`[RAG] Added "${file}" (${chunk.length} chars)`);
    }
  }

  if (sections.length === 0) return '';

  console.log(`[RAG] Total context injected: ${totalChars} chars`);
  return (
    `\n\n## Knowledge Base (your documents — use this to answer questions):\n` +
    sections.join('\n\n---\n\n')
  );
}

module.exports = { setFolder, getFolder, buildContext };
