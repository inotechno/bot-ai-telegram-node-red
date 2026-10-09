'use strict';

function token() {
    const t = process.env.TELEGRAM_BOT_TOKEN;
    if (!t) throw new Error('TELEGRAM_BOT_TOKEN tidak diatur');
    return t;
}

async function uploadStickerFile(userId, buffer, fmt) {
    const format = fmt === 'webp' ? 'webp' : 'png';
    const fd = new FormData();
    fd.append('user_id', String(userId));
    fd.append('sticker_format', 'static');
    fd.append('sticker', new Blob([buffer], { type: 'image/' + format }), 'sticker.' + format);
    const res = await fetch('https://api.telegram.org/bot' + token() + '/uploadStickerFile', { method: 'POST', body: fd });
    const json = await res.json();
    if (json.ok && json.result && typeof json.result === 'object' && json.result.file_id) {
        json.result = json.result.file_id;
    }
    return json;
}

async function addStickerToSet(userId, name, inputStickerJson) {
    const body = new URLSearchParams();
    body.set('user_id', String(userId));
    body.set('name', name);
    body.set('sticker', inputStickerJson);
    const res = await fetch('https://api.telegram.org/bot' + token() + '/addStickerToSet', { method: 'POST', body });
    return res.json();
}

async function createNewStickerSet(userId, name, title, stickersJson) {
    const body = new URLSearchParams();
    body.set('user_id', String(userId));
    body.set('name', name);
    body.set('title', title);
    body.set('stickers', stickersJson);
    const res = await fetch('https://api.telegram.org/bot' + token() + '/createNewStickerSet', { method: 'POST', body });
    return res.json();
}

module.exports = { uploadStickerFile, addStickerToSet, createNewStickerSet };
