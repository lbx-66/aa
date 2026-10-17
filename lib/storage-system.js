// 存储键与转义、ZIP 读写（章节持久化与 EPUB 导出用）。

// === 存储键与转义 ===
export function niServerFileId(value) {
    return String(value || '').replace(/^ni_data_/, '');
}

export function niB64(str) {
    const bytes = new TextEncoder().encode(str);
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
}

export function niEscHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

export function niEscAttr(value) {
    return niEscHtml(value);
}

// === ZIP 导入导出 ===
export function _u8(str) { return new TextEncoder().encode(str); }
export function _str(u8) { return new TextDecoder().decode(u8); }

export function _buildZip(files) {
    const centralDir = [];
    const parts = [];
    let offset = 0;

    for (const f of files) {
        const nameBytes = _u8(f.name);
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
        const crc = _crc32(data);
        const header = _localHeader(nameBytes, data.length, crc);
        centralDir.push({ nameBytes, offset, size: data.length, crc });
        parts.push(header, data);
        offset += header.length + data.length;
    }

    const cdParts = centralDir.map(e => _centralHeader(e.nameBytes, e.offset, e.size, e.crc));
    const cdSize = cdParts.reduce((a, b) => a + b.length, 0);
    const eocd = _eocd(centralDir.length, cdSize, offset);

    const total = [...parts, ...cdParts, eocd].reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of [...parts, ...cdParts, eocd]) { out.set(p, pos); pos += p.length; }
    return out;
}

function _w16(v) { return [v & 0xff, (v >> 8) & 0xff]; }
function _w32(v) { return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]; }

function _localHeader(name, size, crc) {
    return new Uint8Array([
        0x50,0x4b,0x03,0x04, 0x14,0x00, 0x00,0x00, 0x00,0x00,
        0x00,0x00, 0x00,0x00,
        ..._w32(crc), ..._w32(size), ..._w32(size),
        ..._w16(name.length), 0x00,0x00,
        ...name,
    ]);
}

function _centralHeader(name, offset, size, crc) {
    return new Uint8Array([
        0x50,0x4b,0x01,0x02, 0x14,0x00, 0x14,0x00,
        0x00,0x00, 0x00,0x00, 0x00,0x00, 0x00,0x00,
        ..._w32(crc), ..._w32(size), ..._w32(size),
        ..._w16(name.length), 0x00,0x00, 0x00,0x00, 0x00,0x00,
        0x00,0x00, 0x00,0x00, 0x00,0x00,
        ..._w32(offset),
        ...name,
    ]);
}

function _eocd(count, cdSize, cdOffset) {
    return new Uint8Array([
        0x50,0x4b,0x05,0x06, 0x00,0x00, 0x00,0x00,
        ..._w16(count), ..._w16(count),
        ..._w32(cdSize), ..._w32(cdOffset),
        0x00,0x00,
    ]);
}

function _crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 异步 ZIP 解析（STORE 直拷 + DEFLATE 解压）：
 * 外部 EPUB 几乎都是 DEFLATE 压缩，本函数同时支持两种压缩方式。
 * method 8 条目用 DecompressionStream('deflate-raw') 解压（Chrome/Edge/现代 Safari/安卓 WebView 支持）；
 * 不支持的压缩方式（如 bzip2/lzma）跳过该条目并告警。
 * @returns {Promise<Object<string, Uint8Array>>}
 */
export async function niParseZip(buffer) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    const files = {};
    const inflateJobs = [];
    let i = 0;
    while (i < u8.length - 4) {
        if (view.getUint32(i, true) !== 0x04034b50) { i++; continue; }
        const method    = view.getUint16(i + 8, true);
        const nameLen   = view.getUint16(i + 26, true);
        const extraLen  = view.getUint16(i + 28, true);
        const compSize  = view.getUint32(i + 18, true);
        const name      = _str(u8.slice(i + 30, i + 30 + nameLen));
        const dataStart = i + 30 + nameLen + extraLen;
        const comp      = u8.slice(dataStart, dataStart + compSize);
        if (method === 0) {
            files[name] = comp;
        } else if (method === 8) {
            inflateJobs.push({ name, comp });
        } else {
            console.warn('[NI] ZIP 条目使用了不支持的压缩方式（method', method + '），已跳过:', name);
        }
        i = dataStart + compSize;
    }
    for (const job of inflateJobs) {
        try {
            if (typeof DecompressionStream !== 'function') {
                throw new Error('当前环境不支持 DecompressionStream，无法解压 DEFLATE 条目');
            }
            const ds = new DecompressionStream('deflate-raw');
            const stream = new Blob([job.comp]).stream().pipeThrough(ds);
            const ab = await new Response(stream).arrayBuffer();
            files[job.name] = new Uint8Array(ab);
        } catch (e) {
            console.warn('[NI] ZIP 条目解压失败，跳过:', job.name, e?.message || e);
        }
    }
    return files;
}

