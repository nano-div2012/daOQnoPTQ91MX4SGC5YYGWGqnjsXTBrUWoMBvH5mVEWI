// Pencarian dan unduh versi demo: JavaScript murni di browser, tanpa server Node.js.
// Semua panggilan jaringan lewat file ini.
(function () {
  "use strict";

  const C = window.NYR_CONFIG || {};
  const KUNCI_SAVETUBE = "C5D58EF67A7584E4A29F6C35BBC4EB12";
  const rute = { terakhir: "" };
  const gagalSesi = new Set();

  /* ---------- util ---------- */
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
  function hostDari(u) { try { return new URL(String(u).replace("{url}", "x")).hostname; } catch (e) { return String(u).slice(0, 30); } }
  function pesan(e) {
    if (!e) return "gagal";
    if (e.name === "AbortError") return "waktu habis";
    if (e.name === "TypeError") return "diblokir (CORS) atau jaringan";
    return String(e.message || "gagal").slice(0, 120);
  }
  function galat(msg, detail) { const e = new Error(msg); e.detail = detail || []; return e; }
  function jaga() {
    if (window.NYRProxy && !window.NYRProxy.hostDiizinkan()) throw galat("link tidak resmi! Tidak dapat dibuka!");
  }

  async function ambil(url, opsi, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, ms || 10000);
    try { return await fetch(url, Object.assign({}, opsi || {}, { signal: ctl.signal })); }
    finally { clearTimeout(timer); }
  }
  async function ambilJson(url, opsi, ms) {
    const r = await ambil(url, opsi, ms);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function adaInternet() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    try { await ambil("https://www.gstatic.com/generate_204", { mode: "no-cors", cache: "no-store" }, 4000); return true; }
    catch (e) { return false; }
  }

  /* ---------- label jenis & penggabungan hasil (sama seperti versi Node.js) ---------- */
  const POLA_JENIS = [
    ["mv", /\b(mv|music video|official video|video klip|klip resmi|official mv)\b/i],
    ["lirik", /\b(lirik|lyrics?|lyric video|video lirik)\b/i],
    ["cover", /\bcover\b/i],
    ["live", /\b(live|konser|concert|live session|live performance)\b/i],
    ["audio", /\b(official audio|audio only|full audio)\b/i],
  ];
  function jenisDari(judul) {
    const t = String(judul || "");
    return POLA_JENIS.filter(function (p) { return p[1].test(t); }).map(function (p) { return p[0]; });
  }
  function gabung(daftar, batas) {
    const maksHasil = batas || 36;
    const lihat = new Set();
    const hasil = [];
    const maks = Math.max.apply(null, [0].concat(daftar.map(function (d) { return d.length; })));
    for (let i = 0; i < maks && hasil.length < maksHasil; i++) {
      for (let k = 0; k < daftar.length; k++) {
        const item = daftar[k][i];
        if (!item || !item.id || lihat.has(item.id)) continue;
        lihat.add(item.id);
        hasil.push(Object.assign({}, item, { jenis: jenisDari(item.title) }));
        if (hasil.length >= maksHasil) break;
      }
    }
    return hasil;
  }

  function fmtDur(s) {
    s = Number(s);
    if (!isFinite(s) || s <= 0) return "";
    const m = Math.floor(s / 60), d = Math.floor(s % 60), j = Math.floor(m / 60);
    const dd = String(d).padStart(2, "0");
    return j ? j + ":" + String(m % 60).padStart(2, "0") + ":" + dd : m + ":" + dd;
  }
  const thumbDari = function (id) { return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"; };

  /* ---------- daftar instance Piped ---------- */
  async function daftarPiped() {
    const c = lsGet("nyr_piped_cache", null);
    if (c && Array.isArray(c.list) && c.list.length && Date.now() - c.t < 6 * 3600 * 1000) return c.list;
    let dinamis = [];
    if (C.sumberDaftarPiped) {
      try {
        const j = await ambilJson(C.sumberDaftarPiped, {}, 6000);
        dinamis = (Array.isArray(j) ? j : [])
          .map(function (x) { return x && (x.api_url || x.apiUrl || x.url); })
          .filter(function (u) { return typeof u === "string" && /^https:\/\//.test(u); });
      } catch (e) { /* pakai daftar bawaan */ }
    }
    const list = Array.from(new Set((C.piped || []).concat(dinamis).map(function (u) { return u.replace(/\/+$/, ""); }))).slice(0, 15);
    if (dinamis.length) lsSet("nyr_piped_cache", { t: Date.now(), list: list });
    return list;
  }

  // Kandidat jalur: yang terakhir berhasil didahulukan, yang gagal di sesi ini dilewati.
  function semuaRute(piped) {
    return piped.map(function (b) { return { jenis: "piped", alamat: b }; })
      .concat((C.gerbangCors || []).map(function (g) { return { jenis: "gerbang", alamat: g }; }));
  }
  function urutanRute(piped) {
    const semua = semuaRute(piped);
    const baik = semua.filter(function (r) { return !gagalSesi.has(r.alamat); });
    const kandidat = baik.length ? baik : semua;
    if (rute.terakhir) kandidat.sort(function (a, b) { return (b.alamat === rute.terakhir) - (a.alamat === rute.terakhir); });
    return kandidat;
  }

  /* ---------- pencarian ---------- */
  function petaPiped(x) {
    if (!x || (x.type !== "stream" && !/watch\?v=/.test(String(x.url)))) return null;
    const m = String(x.url || "").match(/[?&]v=([\w-]{11})/);
    if (!m || x.isShort) return null;
    return { id: m[1], title: x.title || "", author: x.uploaderName || "", thumbnail: thumbDari(m[1]), durasi: fmtDur(x.duration) };
  }

  async function cariPiped(base, q) {
    const j = await ambilJson(base + "/search?q=" + encodeURIComponent(q) + "&filter=videos", {}, 7000);
    return (j.items || []).map(petaPiped).filter(Boolean);
  }

  function parseYt(html) {
    const m = html && (html.match(/var ytInitialData = (\{[\s\S]*?\});/) || html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*var/));
    if (!m) throw new Error("data YouTube tidak terbaca");
    const json = JSON.parse(m[1]);
    const sections = (json.contents && json.contents.twoColumnSearchResultsRenderer && json.contents.twoColumnSearchResultsRenderer.primaryContents &&
      json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer && json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents) || [];
    const isi = [];
    sections.forEach(function (s) { ((s.itemSectionRenderer && s.itemSectionRenderer.contents) || []).forEach(function (c) { isi.push(c); }); });
    return isi.filter(function (c) { return c.videoRenderer && /^[\w-]{11}$/.test(String(c.videoRenderer.videoId)); }).map(function (c) {
      const d = c.videoRenderer;
      return {
        id: d.videoId,
        title: (d.title && d.title.runs && d.title.runs[0] && d.title.runs[0].text) || "",
        author: (d.ownerText && d.ownerText.runs && d.ownerText.runs[0] && d.ownerText.runs[0].text) || "",
        thumbnail: thumbDari(d.videoId),
        durasi: (d.lengthText && d.lengthText.simpleText) || "",
      };
    });
  }

  async function cariGerbang(gerbang, q) {
    const target = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
    const r = await ambil(gerbang.replace("{url}", encodeURIComponent(target)), {}, 11000);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parseYt(await r.text());
  }

  async function cariSatu(q, diag) {
    jaga();
    const piped = await daftarPiped();
    const kandidat = urutanRute(piped).slice(0, 6);
    const dicoba = new Set(kandidat.map(function (r) { return r.alamat; }));
    semuaRute(piped).forEach(function (r) {
      if (!dicoba.has(r.alamat)) diag.push(hostDari(r.alamat) + ": dilewati (gagal sebelumnya)");
    });
    for (let i = 0; i < kandidat.length; i++) {
      const r = kandidat[i];
      try {
        const hasil = r.jenis === "piped" ? await cariPiped(r.alamat, q) : await cariGerbang(r.alamat, q);
        if (hasil.length) { rute.terakhir = r.alamat; return hasil; }
        diag.push(hostDari(r.alamat) + ": hasil kosong");
      } catch (e) {
        gagalSesi.add(r.alamat);
        diag.push(hostDari(r.alamat) + ": " + pesan(e));
      }
    }
    throw galat("Pencarian gagal di semua jalur", diag);
  }

  // Pencarian asli + variasi lirik, cover, live, digabung bergantian (maks 36).
  async function cariSemua(q) {
    const dasar = await cariSatu(q, []);
    const varian = await Promise.allSettled(["lirik", "cover", "live"].map(function (v) { return cariSatu(q + " " + v, []); }));
    return gabung([dasar].concat(varian.map(function (s) { return s.status === "fulfilled" ? s.value : []; })));
  }

  // Hasil teratas untuk tiap judul (beranda). Jalur yang hidup dipelajari dulu dari judul pertama.
  async function teratas(daftar) {
    const hasil = new Array(daftar.length);
    async function satu(i) {
      try {
        const r = await cariSatu(daftar[i], []);
        hasil[i] = { query: daftar[i], hasil: r[0] ? Object.assign({}, r[0], { jenis: jenisDari(r[0].title) }) : null };
      } catch (e) {
        hasil[i] = { query: daftar[i], hasil: null, error: pesan(e), detail: e.detail || [] };
      }
    }
    if (!daftar.length) return hasil;
    await satu(0);
    if (hasil[0].error) {
      for (let i = 1; i < daftar.length; i++) hasil[i] = { query: daftar[i], hasil: null, error: hasil[0].error, detail: hasil[0].detail };
      return hasil;
    }
    for (let i = 1; i < daftar.length; i += 4) {
      const kelompok = [];
      for (let k = i; k < Math.min(i + 4, daftar.length); k++) kelompok.push(satu(k));
      await Promise.all(kelompok);
    }
    return hasil;
  }

  /* ---------- mesin unduh ---------- */
  async function dekripsi(base64) {
    if (!window.crypto || !window.crypto.subtle) throw new Error("browser tidak mendukung enkripsi (butuh https)");
    const mentah = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });
    const kunciBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) kunciBytes[i] = parseInt(KUNCI_SAVETUBE.substr(i * 2, 2), 16);
    const kunci = await window.crypto.subtle.importKey("raw", kunciBytes, { name: "AES-CBC" }, false, ["decrypt"]);
    const bytes = await window.crypto.subtle.decrypt({ name: "AES-CBC", iv: mentah.slice(0, 16) }, kunci, mentah.slice(16));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function viaSavetube(p) {
    const videoUrl = "https://www.youtube.com/watch?v=" + p.id;
    const cdn = (await ambilJson("https://media.savetube.vip/api/random-cdn", {}, 8000)).cdn;
    if (!cdn) throw new Error("cdn kosong");
    const kepala = { "Content-Type": "application/json" };
    const info = await ambilJson("https://" + cdn + "/v2/info", { method: "POST", headers: kepala, body: JSON.stringify({ url: videoUrl }) }, 12000);
    if (!info.status) throw new Error(info.message || "gagal ambil info video");
    const data = await dekripsi(info.data);
    const dl = await ambilJson("https://" + cdn + "/download", {
      method: "POST", headers: kepala,
      body: JSON.stringify({ downloadType: "audio", quality: String(p.quality), key: data.key }),
    }, 20000);
    const url = dl && dl.data && dl.data.downloadUrl;
    if (!url) throw new Error("link kosong dari savetube");
    return { url: url, title: data.title || "", quality: p.quality + "kbps", ext: "mp3" };
  }

  async function viaPiped(p) {
    const piped = await daftarPiped();
    const diag = [];
    const kandidat = urutanRute(piped).filter(function (r) { return r.jenis === "piped"; }).slice(0, 4);
    for (let i = 0; i < kandidat.length; i++) {
      const base = kandidat[i].alamat;
      try {
        const j = await ambilJson(base + "/streams/" + p.id, {}, 9000);
        const aliran = (j.audioStreams || []).filter(function (s) { return s && /^https:\/\//.test(String(s.url)); });
        if (!aliran.length) throw new Error("tidak ada aliran audio");
        const m4a = function (s) { return /mp4|m4a/i.test(String(s.mimeType || s.format || "")) ? 1 : 0; };
        const target = Number(p.quality) * 1000 || 128000;
        aliran.sort(function (a, b) { return (m4a(b) - m4a(a)) || (Math.abs((a.bitrate || 0) - target) - Math.abs((b.bitrate || 0) - target)); });
        const s = aliran[0];
        return { url: s.url, title: j.title || "", quality: s.quality || (Math.round((s.bitrate || 0) / 1000) + "kbps"), ext: m4a(s) ? "m4a" : "webm" };
      } catch (e) { diag.push(hostDari(base) + ": " + pesan(e)); }
    }
    throw galat("piped gagal (" + diag.join("; ") + ")", diag);
  }

  const MESIN = [
    { id: "savetube", name: "savetube (mp3)", run: viaSavetube },
    { id: "piped", name: "piped (audio m4a)", run: viaPiped },
  ];

  async function resolve(idMesin, p) {
    jaga();
    const m = MESIN.find(function (x) { return x.id === idMesin; });
    if (!m) throw galat("mesin tidak dikenal");
    const t0 = Date.now();
    const out = await Promise.race([
      m.run(p),
      new Promise(function (_, tolak) { setTimeout(function () { tolak(new Error("waktu habis")); }, 35000); }),
    ]);
    if (!out || !out.url) throw galat("mesin tidak memberi link");
    return Object.assign({ ms: Date.now() - t0 }, out);
  }

  window.NYRNet = {
    cariSemua: cariSemua,
    teratas: teratas,
    resolve: resolve,
    mesin: MESIN.map(function (m) { return { id: m.id, name: m.name }; }),
    adaInternet: adaInternet,
    jenisDari: jenisDari,
    gabung: gabung,
    parseYt: parseYt,
  };
})();
