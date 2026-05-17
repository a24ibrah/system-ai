const fs = require('fs');
const path = require('path');

let ragFolderPath = null;

function setFolder(folderPath) {
  ragFolderPath = folderPath || null;
}

function getFolder() {
  return ragFolderPath;
}

async function extractPdfText(filePath) {
  try {
    const pdfParse = require('pdf-parse');
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
async function buildContext() {
  if (!ragFolderPath) return '';

  let files;
  try {
    files = fs.readdirSync(ragFolderPath);
  } catch (err) {
    console.warn('[RAG] Cannot read folder:', err.message);
    return '';
  }

  const pdfFiles = files.filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) return '';

  const sections = [];
  for (const file of pdfFiles) {
    const filePath = path.join(ragFolderPath, file);
    const text = await extractPdfText(filePath);
    if (text && text.trim()) {
      sections.push(`### ${file}\n${text.trim()}`);
    }
  }

  if (sections.length === 0) return '';

  return (
    `\n\n## Knowledge Base (your documents — use this to answer questions):\n` +
    sections.join('\n\n---\n\n')
  );
}

module.exports = { setFolder, getFolder, buildContext };
