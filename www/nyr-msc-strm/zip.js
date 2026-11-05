// Pembuat dan pembaca file ZIP sederhana (tanpa library). Pembuat memakai metode "simpan" (tanpa kompresi),
// cocok untuk mp3. Pembaca mendukung metode simpan dan deflate.
(function () {
  "use strict";
  const TABEL = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8");

  // files: [{ nama: "data.json", data: Uint8Array | Blob }]
  async function buat(files, onProgress) {
    const bagian = [];
    const pusat = [];
    let offset = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const namaB = enc.encode(f.nama);
      const buf = f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
      const crc = crc32(buf);
      const size = buf.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true);
      lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, namaB.length, true);
      lh.setUint16(28, 0, true);
      bagian.push(lh.buffer, namaB, buf);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true);
      ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, namaB.length, true);
      ch.setUint32(42, offset, true);
      pusat.push(ch.buffer, namaB);

      offset += 30 + namaB.length + size;
      if (onProgress) onProgress(i + 1, files.length);
    }
    let ukuranPusat = 0;
    pusat.forEach((p) => { ukuranPusat += p.byteLength; });
    const akhir = new DataView(new ArrayBuffer(22));
    akhir.setUint32(0, 0x06054b50, true);
    akhir.setUint16(8, files.length, true);
    akhir.setUint16(10, files.length, true);
    akhir.setUint32(12, ukuranPusat, true);
    akhir.setUint32(16, offset, true);
    return new Blob(bagian.concat(pusat, [akhir.buffer]), { type: "application/zip" });
  }

  // Mengembalikan Map nama -> entri. Isi file diambil lewat ambil(entri).
  async function baca(file) {
    const size = file.size;
    if (size < 22) throw new Error("file bukan zip (terlalu kecil)");
    const panjangEkor = Math.min(size, 65557);
    const ekor = new DataView(await file.slice(size - panjangEkor, size).arrayBuffer());
    let eocd = -1;
    for (let i = panjangEkor - 22; i >= 0; i--) {
      if (ekor.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("file bukan zip yang valid");
    const total = ekor.getUint16(eocd + 10, true);
    const ukPusat = ekor.getUint32(eocd + 12, true);
    const offPusat = ekor.getUint32(eocd + 16, true);
    if (total === 0xffff || ukPusat === 0xffffffff || offPusat === 0xffffffff) throw new Error("zip64 tidak didukung");
    if (total > 10000) throw new Error("terlalu banyak file di dalam zip");
    if (offPusat + ukPusat > size) throw new Error("zip rusak");

    const cdBuf = await file.slice(offPusat, offPusat + ukPusat).arrayBuffer();
    const cd = new DataView(cdBuf);
    const cdBytes = new Uint8Array(cdBuf);
    const peta = new Map();
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error("direktori zip rusak");
      const nlen = cd.getUint16(p + 28, true);
      const elen = cd.getUint16(p + 30, true);
      const clen = cd.getUint16(p + 32, true);
      const nama = dec.decode(cdBytes.subarray(p + 46, p + 46 + nlen));
      peta.set(nama, {
        nama, file,
        flags: cd.getUint16(p + 8, true),
        method: cd.getUint16(p + 10, true),
        crc: cd.getUint32(p + 16, true),
        csize: cd.getUint32(p + 20, true),
        usize: cd.getUint32(p + 24, true),
        lho: cd.getUint32(p + 42, true),
      });
      p += 46 + nlen + elen + clen;
    }
    return peta;
  }

  async function ambil(e, maks) {
    if (e.flags & 1) throw new Error("zip terenkripsi tidak didukung");
    if (maks && e.usize > maks) throw new Error("file di dalam zip terlalu besar: " + e.nama);
    const lh = new DataView(await e.file.slice(e.lho, e.lho + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("header file zip rusak");
    const mulai = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const mentah = e.file.slice(mulai, mulai + e.csize);
    let bytes;
    if (e.method === 0) {
      bytes = new Uint8Array(await mentah.arrayBuffer());
    } else if (e.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("browser tidak mendukung zip terkompres");
      bytes = new Uint8Array(await new Response(mentah.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    } else {
      throw new Error("metode kompresi tidak didukung (" + e.method + ")");
    }
    if (bytes.length !== e.usize || crc32(bytes) !== e.crc) throw new Error("data rusak (CRC tidak cocok): " + e.nama);
    return bytes;
  }

  window.NYRZip = { buat, baca, ambil, crc32 };
})();
