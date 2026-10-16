const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');

const bot = new Telegraf(config.BOT_TOKEN);
const TEMP = os.tmpdir();

async function uploadToCatbox(filePath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath));
  if (config.USERHASH) form.append('userhash', config.USERHASH);

  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 90000,
  });

  const result = String(res.data || '').trim();
  if (!result.startsWith('https://')) throw new Error(result || 'Upload gagal');
  return result;
}

function getFile(msg) {
  if (msg.photo) {
    const p = msg.photo[msg.photo.length - 1];
    return { id: p.file_id, name: `${p.file_id}.jpg`, size: p.file_size || 0, type: 'Foto' };
  }
  if (msg.video) return { id: msg.video.file_id, name: msg.video.file_name || 'video.mp4', size: msg.video.file_size || 0, type: 'Video' };
  if (msg.document) return { id: msg.document.file_id, name: msg.document.file_name || 'file', size: msg.document.file_size || 0, type: 'Dokumen' };
  if (msg.audio) return { id: msg.audio.file_id, name: msg.audio.file_name || 'audio.mp3', size: msg.audio.file_size || 0, type: 'Audio' };
  if (msg.voice) return { id: msg.voice.file_id, name: 'voice.ogg', size: msg.voice.file_size || 0, type: 'Voice' };
  if (msg.animation) return { id: msg.animation.file_id, name: msg.animation.file_name || 'anim.gif', size: msg.animation.file_size || 0, type: 'GIF' };
  if (msg.sticker) return { id: msg.sticker.file_id, name: 'sticker.webp', size: msg.sticker.file_size || 0, type: 'Sticker' };
  return null;
}

function notifyOwner(ctx, url, info) {
  const from = ctx.from?.username
    ? `@${ctx.from.username}`
    : (ctx.from?.first_name || 'User');

  const size = info.size ? `${(info.size / 1024 / 1024).toFixed(2)} MB` : '-';
  const text =
    `🔔 <b>Upload dari Bot</b>\n\n` +
    `👤 ${from}\n` +
    `📁 ${info.type}\n` +
    `📦 ${size}\n` +
    `🔗 ${url}`;

  for (const id of config.OWNER_ID) {
    if (Number(id) === Number(ctx.from?.id)) continue;
    ctx.telegram.sendMessage(id, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }).catch(() => {});
  }
}

bot.on(['photo', 'video', 'document', 'audio', 'voice', 'animation', 'sticker'], async (ctx) => {
  let statusMsg = null;
  let filePath = null;

  try {
    const info = getFile(ctx.message);
    if (!info) return ctx.reply('❌ Jenis file tidak didukung.');
    if (info.size > config.MAX_FILE_SIZE) return ctx.reply('❌ File terlalu besar.\nMaksimal 200 MB.');

    statusMsg = await ctx.reply('⏳ Sedang memproses mengirimkan data ke server key...');

    const fileLink = await ctx.telegram.getFileLink(info.id);
    filePath = path.join(TEMP, info.name);

    const res = await axios({
      url: fileLink.href,
      responseType: 'stream',
      timeout: 45000,
    });

    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const url = await uploadToCatbox(filePath);
    try { fs.unlinkSync(filePath); } catch (e) {}
    filePath = null;

    const sizeText = info.size ? `${(info.size / 1024 / 1024).toFixed(2)} MB` : '-';

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `✅ <b>Upload Berhasil</b>\n\n` +
      `📁 ${info.type}\n` +
      `📦 ${sizeText}\n\n` +
      `🔗 ${url}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('Buka Link', url)],
          [Markup.button.callback('Hapus Pesan', `del_${statusMsg.message_id}`)],
        ]),
      }
    );

    notifyOwner(ctx, url, info);

  } catch (err) {
    if (filePath) try { fs.unlinkSync(filePath); } catch (e) {}
    const msg = `❌ Gagal upload\n<code>${err.message}</code>`;
    if (statusMsg) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, msg, { parse_mode: 'HTML' });
      } catch (e) {
        await ctx.reply(msg, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    }
  }
});

bot.action(/del_(\d+)/, async (ctx) => {
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, parseInt(ctx.match[1]));
    await ctx.answerCbQuery('Pesan dihapus');
  } catch (e) {
    await ctx.answerCbQuery('Gagal menghapus');
  }
});

bot.start((ctx) => {
  ctx.reply(
    `Halo! 👋\n\n` +
    `Kirim <b>foto, video, dokumen</b> ke bot ini.\n` +
    `Saya akan ubah menjadi link Catbox credit by key.\n\n` +
    `📌 Maksimal ukuran: <b>200 MB</b>`,
    { parse_mode: 'HTML' }
  );
});

bot.help((ctx) => {
  ctx.reply('Cukup kirim file ke bot ini, nanti langsung dapat link-nya.');
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
};
