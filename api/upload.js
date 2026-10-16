const axios = require('axios');
const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const conf = require('../config');

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: conf.MAX_FILE_SIZE },
    });

    let fileInfo = null;
    let filePath = null;
    let writeStream = null;

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const tmpName = `upload_\( {Date.now()}_ \){Math.random().toString(36).slice(2)}`;
      filePath = path.join(os.tmpdir(), tmpName);
      writeStream = fs.createWriteStream(filePath);

      file.pipe(writeStream);

      fileInfo = {
        filename: filename || 'file',
        mimeType: mimeType || 'application/octet-stream',
        path: filePath,
        size: 0,
      };

      file.on('data', (data) => {
        fileInfo.size += data.length;
      });

      file.on('limit', () => {
        reject(new Error('File terlalu besar (maks 200MB)'));
      });
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (!fileInfo) return reject(new Error('Tidak ada file yang diupload'));
      if (writeStream) {
        writeStream.end(() => resolve(fileInfo));
      } else {
        resolve(fileInfo);
      }
    });

    req.pipe(busboy);
  });
}

async function uploadToCatbox(filePath, fileName) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath), fileName);
  if (conf.USERHASH) form.append('userhash', conf.USERHASH);

  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 90000,
  });

  const result = String(res.data || '').trim();
  if (!result.startsWith('https://')) throw new Error(result || 'Upload gagal ke Catbox');
  return result;
}

async function notifyOwner(url, filename, size) {
  const text =
    `🔔 <b>Upload dari Web</b>\n\n` +
    `📁 <code>${filename}</code>\n` +
    `📦 ${(size / 1024 / 1024).toFixed(2)} MB\n` +
    `🔗 ${url}`;

  for (const id of conf.OWNER_ID) {
    try {
      await axios.post(`https://api.telegram.org/bot${conf.BOT_TOKEN}/sendMessage`, {
        chat_id: id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });
    } catch (e) {}
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  let tmpPath = null;

  try {
    const file = await parseMultipart(req);
    tmpPath = file.path;

    if (!file.size) throw new Error('File kosong');

    const url = await uploadToCatbox(file.path, file.filename);

    try { fs.unlinkSync(file.path); } catch (e) {}
    tmpPath = null;

    notifyOwner(url, file.filename, file.size).catch(() => {});

    return res.status(200).json({
      success: true,
      url,
      filename: file.filename,
      size: file.size,
    });
  } catch (err) {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (e) {}
    return res.status(500).json({
      success: false,
      error: err.message || 'Upload gagal',
    });
  }
};
