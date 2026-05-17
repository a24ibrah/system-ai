const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Persist folder path in userData so it survives app restarts without
// relying on the renderer sending it back via IPC.
function getConfigPath() {
  return path.join(app.getPath('userData'), 'rag-config.json');
}

function loadPersistedFolder() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw).folder || null;
  } catch {
    return null;
  }
}

function persistFolder(folderPath) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify({ folder: folderPath || null }), 'utf-8');
  } catch (err) {
    console.warn('[RAG] Could not persist folder config:', err.message);
  }
}

// Load on startup
let ragFolderPath = loadPersistedFolder();
if (ragFolderPath) console.log('[RAG] Restored folder from config:', ragFolderPath);

function setFolder(folderPath) {
  ragFolderPath = folderPath || null;
  persistFolder(ragFolderPath);
}

function getFolder() {
  return ragFolderPath;
}

async function extractPdfText(filePath) {
  try {
    // Lazy require to avoid top-level side effects in Electron
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
