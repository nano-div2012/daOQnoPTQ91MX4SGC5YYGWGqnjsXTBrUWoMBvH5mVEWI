(function () {
  "use strict";

  /* ================= util ================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const cfg = window.NYR_CONFIG || { lagu: [], artis: [], akhiranPopuler: "" };
  const audio = $("#audio");
  const WARNA = ["#FFD93D", "#6BCB77", "#4D96FF", "#FF6B6B", "#FFFFFF"];
  const TEKS_OFFLINE = "Tidak ada koneksi internet!";
  const TIPE_AUDIO = { mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm" };
  const MODE = [
    ["auto", "AUTO", "Auto play: lanjut otomatis ke lagu berikutnya"],
    ["satu", "1X", "Play 1x: lagu diputar sekali lalu berhenti"],
    ["ulang", "ULANG", "Play ulangi: lagu ini diputar berulang terus"],
  ];

  const state = {
    queue: [], index: -1, resolveCache: new Map(),
    playToken: 0, blobUrl: null, currentEngine: "", mesinGagal: {}, busy: false, dataBusy: false, homeGagal: false,
    pipWin: null, pipTimer: null, canvas: null,
    userPaused: false, interrupted: false, switching: false, errRetry: {},
    hasil: [], filter: "semua",
    populer: [], urutArtis: [], populerIdx: 0,
    playlists: [], bukaPl: null,
  };

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (kids || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } }

  function cleanName(raw) {
    const n = String(raw || "lagu").replace(/\.(mp3|m4a|webm|zip)$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 120);
    return n || "lagu";
  }
    const coverOf = (t) => t.thumbnail || ("https://i.ytimg.com/vi/" + t.id + "/hqdefault.jpg");

  function extractId(text) {
    const s = String(text || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : null;
  }

  function simpanBlobSebagai(blob, namaFile) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = namaFile;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }
  const simpanFile = (blob, name, ext) => simpanBlobSebagai(blob, cleanName(name) + "." + (ext || "mp3"));

  /* ================= pengaturan & nama guest ================= */
  const SET_DEFAULT = { mode: "auto", kualitas: "320", offline: true };
  const getSet = () => Object.assign({}, SET_DEFAULT, lsGet("nyr_pengaturan", {}));
  const setSet = (patch) => lsSet("nyr_pengaturan", Object.assign(getSet(), patch));
  const getNama = () => window.NYRData.nama(lsGet("nyr_nama", "Guest"));

  function renderNama() {
    $("#btn-nama").textContent = getNama();
    $("#in-nama").value = getNama();
  }

  function terapkanPengaturan() {
    const s = getSet();
    $("#sel-kualitas").value = s.kualitas;
    $("#chk-offline").checked = !!s.offline;
    const m = MODE.find((x) => x[0] === s.mode) || MODE[0];
    $("#p-mode").textContent = m[1];
    audio.loop = s.mode === "ulang";
  }

  /* ================= IndexedDB (riwayat + lagu offline) ================= */
  function dbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("nyr-musik", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("lagu", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await dbOpen();
    return new Promise((res, rej) => {
      const t = db.transaction("lagu", mode);
      const rq = fn(t.objectStore("lagu"));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbPut = (v) => tx("readwrite", (s) => s.put(v));
  const dbDel = (id) => tx("readwrite", (s) => s.delete(id));
  async function dbGet(id) { try { return await tx("readonly", (s) => s.get(id)); } catch { return undefined; } }
  async function dbAll() { try { return (await tx("readonly", (s) => s.getAll())) || []; } catch { return []; } }

  /* ================= modal kecil ================= */
  function modal(judul, isi, onTutup) {
    const bg = el("div", { class: "modal-bg" });
    let tertutup = false;
    function tutup() {
      if (tertutup) return;
      tertutup = true;
      bg.remove();
      if (onTutup) onTutup();
    }
    bg.addEventListener("click", (e) => { if (e.target === bg) tutup(); });
    bg.appendChild(el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      el("h3", { text: judul }),
      ...isi,
      el("button", { class: "btn small", type: "button", text: "TUTUP", onclick: tutup }),
    ]));
    document.body.appendChild(bg);
    return tutup;
  }

  function tanyaTeks(judul, awal, tombol) {
    return new Promise((res) => {
      let nilai = null;
      const inp = el("input", { type: "text", maxlength: "40", value: awal || "", "aria-label": judul });
      let tutup;
      const form = el("form", { onsubmit: (e) => {
        e.preventDefault();
        const v = inp.value.replace(/\s+/g, " ").trim();
        if (!v) { toast("Nama tidak boleh kosong"); return; }
        nilai = v.slice(0, 40);
        tutup();
      } }, [inp, el("button", { class: "btn", type: "submit", text: tombol || "SIMPAN" })]);
      tutup = modal(judul, [form], () => res(nilai));
      inp.focus(); inp.select();
    });
  }

  /* ================= tab & offline ================= */
  function showTab(name) {
    $$(".tab").forEach((s) => { s.hidden = s.id !== "tab-" + name; });
    $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (name === "unduh") renderSaved();
    if (name === "playlist") renderPlaylists();
    if (name === "data") renderData();
  }
  function applyNet() {
    const off = !navigator.onLine;
    document.body.classList.toggle("offline", off);
    $("#net-badge").textContent = off ? "OFFLINE" : "ONLINE";
    $("#offline-note").hidden = !off;
    $("#form-unduh").style.display = off ? "none" : "";
    $("#unduh-offline").hidden = !off;
    if (!off && state.homeGagal) { state.homeGagal = false; muatLagu(); muatPopuler(true); }
  }

  /* ================= daftar lagu ================= */
  // opts.plId: tampilkan tombol HAPUS (dari playlist) menggantikan tombol + PLAYLIST
  function renderTracks(list, target, opts) {
    const box = target || $("#results");
    const o = opts || {};
    box.replaceChildren();
    if (!list.length) { box.appendChild(el("p", { class: "empty", text: o.kosong || "Tidak ada hasil." })); return; }
    list.forEach((t, i) => {
      const meta = [t.author, t.durasi].filter(Boolean).join(" - ");
      const tags = (t.jenis || []).map((j) => el("span", { class: "tagline", text: j.toUpperCase() }));
      if (t.label) tags.unshift(el("span", { class: "tagline blue", text: t.label.toUpperCase() }));
      const acts = [
        el("button", { class: "btn small blue", type: "button", text: "PUTAR", onclick: () => { state.queue = list.slice(); putar(i); } }),
        el("button", { class: "btn small green only-online", type: "button", text: "UNDUH", onclick: () => mulaiUnduh(t) }),
      ];
      if (o.plId) {
        acts.push(el("button", { class: "btn small red", type: "button", text: "HAPUS", onclick: () => hapusLagu(o.plId, t.id) }));
      } else {
        acts.push(el("button", { class: "btn small", type: "button", text: "+ LIST", onclick: () => tambahKePlaylist(t) }));
      }
      box.appendChild(el("div", { class: "item" }, [
        el("img", { src: coverOf(t), alt: "", loading: "lazy", width: "72", height: "54" }),
        el("div", { class: "meta" }, [
          el("strong", { text: t.title || t.id }),
          el("span", { text: meta }),
          tags.length ? el("div", { class: "tags" }, tags) : null,
        ]),
        el("div", { class: "acts" }, acts),
      ]));
    });
  }
  const normTrack = (r) => ({ id: r.id, title: r.title, author: r.author, thumbnail: r.thumbnail, durasi: r.durasi || "", jenis: r.jenis || [] });

  /* ================= pencarian ================= */
  const FILTERS = [["semua", "SEMUA"], ["mv", "MV"], ["lirik", "LIRIK"], ["cover", "COVER"], ["live", "LIVE"], ["audio", "AUDIO"]];

  function tampilHasil() {
    const chips = $("#filter-chips");
    chips.replaceChildren();
    const semua = state.hasil;
    FILTERS.forEach(([k, label]) => {
      const n = k === "semua" ? semua.length : semua.filter((t) => t.jenis.includes(k)).length;
      if (k !== "semua" && !n) return;
      chips.appendChild(el("button", {
        class: "chip" + (state.filter === k ? " on" : ""), type: "button", text: label + " (" + n + ")",
        onclick: () => { state.filter = k; tampilHasil(); },
      }));
    });
    chips.hidden = !semua.length;
    renderTracks(state.filter === "semua" ? semua : semua.filter((t) => t.jenis.includes(state.filter)));
  }

  const pesanOffline = () => el("p", { class: "empty", text: TEKS_OFFLINE });

  // Gagal memuat: kalau memang tidak ada internet tampilkan teks offline, kalau tidak tampilkan alasan dan rinciannya.
  async function pesanGagal(e, aksi) {
    if (!(await window.NYRNet.adaInternet())) return [pesanOffline()];
    const rinci = (e.detail || []).slice(0, 6).join("\n");
    return [
      el("p", { class: "empty", text: "Gagal " + aksi + ": " + (e.message || "tidak diketahui") }),
      rinci ? el("pre", { class: "rinci", text: rinci }) : null,
    ].filter(Boolean);
  }

  async function cari(q, judul) {
    showTab("cari");
    $("#in-cari").value = q;
    $("#judul-hasil").textContent = judul || ("Hasil: " + q);
    $("#filter-chips").hidden = true;
    const box = $("#results");
    if (!navigator.onLine) { box.replaceChildren(pesanOffline()); return; }
    box.replaceChildren(el("p", { class: "empty", text: "Mencari semua versi (MV, lirik, cover, live)..." }));
    try {
      const hasil = await window.NYRNet.cariSemua(q);
      state.hasil = hasil.map(normTrack);
      state.filter = "semua";
      tampilHasil();
    } catch (e) {
      box.replaceChildren(...(await pesanGagal(e, "mencari")));
    }
  }

  /* ================= beranda ================= */
  function artisUrut() {
    return (cfg.artis || []).slice().sort((a, b) => a.localeCompare(b, "id", { sensitivity: "base" }));
  }

  function renderHome() {
    const ag = $("#artist-grid");
    ag.replaceChildren();
    artisUrut().forEach((nama, i) => {
      ag.appendChild(el("button", { class: "tile", type: "button", style: "background:" + WARNA[(i + 2) % WARNA.length], onclick: () => cari(nama, "Artis: " + nama) }, [
        el("span", { class: "mono", text: nama.trim().charAt(0).toUpperCase() }),
        el("span", { text: nama }),
      ]));
    });
  }

  async function muatLagu() {
    const box = $("#home-songs");
    const daftar = cfg.lagu || [];
    if (!daftar.length) { box.replaceChildren(); return; }
    if (!navigator.onLine) { state.homeGagal = true; box.replaceChildren(pesanOffline()); return; }
    box.replaceChildren(el("p", { class: "empty", text: "Memuat lagu pilihan..." }));
    try {
      const j = await window.NYRNet.teratas(daftar.map((l) => l.cari));
      const tracks = [];
      const gagal = [];
      j.forEach((l, i) => {
        if (l.hasil) tracks.push(Object.assign(normTrack(l.hasil), { label: daftar[i].judul }));
        else gagal.push(daftar[i]);
      });
      if (!tracks.length) { const e = new Error((j[0] && j[0].error) || "tidak ada hasil"); e.detail = (j[0] && j[0].detail) || []; throw e; }
      renderTracks(tracks, box);
      gagal.forEach((g) => box.appendChild(el("button", { class: "btn small", type: "button", text: "CARI: " + g.judul, onclick: () => cari(g.cari, "Lagu: " + g.judul) })));
    } catch (e) {
      state.homeGagal = true;
      const pesan = await pesanGagal(e, "memuat lagu pilihan");
      box.replaceChildren(...pesan, el("button", { class: "btn small", type: "button", text: "COBA LAGI", onclick: muatLagu }));
    }
  }

  // Lagu populer tiap artis: hasil teratas dari "<artis> official music video", dimuat 12 artis per tahap.
  async function muatPopuler(ulang) {
    const box = $("#home-populer");
    const btn = $("#btn-populer-lagi");
    if (ulang === true) { state.urutArtis = []; state.populer = []; state.populerIdx = 0; }
    if (!navigator.onLine) { state.homeGagal = true; btn.hidden = true; box.replaceChildren(pesanOffline()); return; }
    if (!state.urutArtis.length) {
      const a = (cfg.artis || []).slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      state.urutArtis = a;
      state.populerIdx = 0;
      state.populer = [];
    }
    const tahap = state.urutArtis.slice(state.populerIdx, state.populerIdx + 12);
    if (!tahap.length) { btn.hidden = true; return; }
    btn.disabled = true;
    btn.hidden = false;
    btn.textContent = "MEMUAT...";
    if (!state.populer.length) box.replaceChildren(el("p", { class: "empty", text: "Memuat lagu populer artis..." }));
    try {
      const j = await window.NYRNet.teratas(tahap.map((a) => a + (cfg.akhiranPopuler || " official music video")));
      j.forEach((l, i) => {
        if (l.hasil) state.populer.push(Object.assign(normTrack(l.hasil), { label: tahap[i] }));
      });
      state.populerIdx += tahap.length;
      if (!state.populer.length) { const e = new Error((j[0] && j[0].error) || "tidak ada hasil"); e.detail = (j[0] && j[0].detail) || []; throw e; }
      renderTracks(state.populer, box);
      btn.textContent = "MUAT LAGI";
      btn.hidden = state.populerIdx >= state.urutArtis.length;
    } catch (e) {
      state.homeGagal = true;
      if (!state.populer.length) box.replaceChildren(...(await pesanGagal(e, "memuat lagu populer")));
      btn.textContent = "COBA LAGI";
      state.populerIdx = Math.min(state.populerIdx, state.populer.length ? state.populerIdx : 0);
    }
    btn.disabled = false;
  }
  $("#btn-populer-lagi").addEventListener("click", () => muatPopuler());

  /* ================= playlist ================= */
  const simpanPl = () => lsSet("nyr_playlists", state.playlists);
  const cariPl = (id) => state.playlists.find((p) => p.id === id);

  function buatPlaylist(nama) {
    if (state.playlists.length >= 100) { toast("Maksimal 100 playlist"); return null; }
    const pl = { id: "pl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nama, dibuat: Date.now(), lagu: [] };
    state.playlists.push(pl);
    simpanPl();
    return pl;
  }

  function tambahLagu(plId, t) {
    const pl = cariPl(plId);
    if (!pl) return;
    if (pl.lagu.some((x) => x.id === t.id)) { toast("Lagu sudah ada di " + pl.nama); return; }
    if (pl.lagu.length >= 500) { toast("Playlist penuh (maks 500 lagu)"); return; }
    pl.lagu.push({ id: t.id, title: t.title || t.id, author: t.author || "", thumbnail: t.thumbnail || "", durasi: t.durasi || "" });
    simpanPl();
    toast("Ditambahkan ke " + pl.nama);
    if (state.bukaPl === plId) renderPlaylists();
  }

  function hapusLagu(plId, idLagu) {
    const pl = cariPl(plId);
    if (!pl) return;
    pl.lagu = pl.lagu.filter((x) => x.id !== idLagu);
    simpanPl();
    renderPlaylists();
  }

  async function ubahNamaPl(plId) {
    const pl = cariPl(plId);
    if (!pl) return;
    const nama = await tanyaTeks("Ubah nama playlist", pl.nama, "SIMPAN");
    if (!nama) return;
    pl.nama = nama;
    simpanPl();
    renderPlaylists();
  }

  function hapusPlaylist(plId) {
    const pl = cariPl(plId);
    if (!pl) return;
    if (!window.confirm("Hapus playlist \"" + pl.nama + "\" beserta " + pl.lagu.length + " lagu di dalamnya? Lagu yang sudah diunduh tidak ikut terhapus.")) return;
    state.playlists = state.playlists.filter((p) => p.id !== plId);
    if (state.bukaPl === plId) state.bukaPl = null;
    simpanPl();
    renderPlaylists();
  }

  function tambahKePlaylist(t) {
    const box = el("div", { class: "list" });
    let tutup;
    state.playlists.forEach((pl) => box.appendChild(el("button", {
      class: "btn small", type: "button", text: pl.nama + " (" + pl.lagu.length + ")",
      onclick: () => { tambahLagu(pl.id, t); tutup(); },
    })));
    if (!state.playlists.length) box.appendChild(el("p", { class: "empty", text: "Belum ada playlist. Buat yang pertama." }));
    const baru = el("button", { class: "btn small green", type: "button", text: "+ PLAYLIST BARU", onclick: async () => {
      const nama = await tanyaTeks("Nama playlist baru", "", "BUAT");
      if (!nama) return;
      const pl = buatPlaylist(nama);
      if (!pl) return;
      tambahLagu(pl.id, t);
      tutup();
    } });
    tutup = modal("Tambah ke playlist", [box, baru]);
  }

  async function playlistBaruLewatForm() {
    const nama = await tanyaTeks("Nama playlist baru", "", "BUAT");
    if (!nama) return;
    const pl = buatPlaylist(nama);
    if (pl) { state.bukaPl = pl.id; renderPlaylists(); }
  }

  function renderPlaylists() {
    const root = $("#pl-root");
    root.replaceChildren();
    const pl = state.bukaPl ? cariPl(state.bukaPl) : null;
    if (state.bukaPl && !pl) state.bukaPl = null;

    if (pl) {
      root.appendChild(el("h2", { text: pl.nama }));
      root.appendChild(el("p", { class: "hint", text: pl.lagu.length + " lagu" }));
      root.appendChild(el("div", { class: "bar-aksi" }, [
        el("button", { class: "btn small", type: "button", text: "KEMBALI", onclick: () => { state.bukaPl = null; renderPlaylists(); } }),
        el("button", { class: "btn small blue", type: "button", text: "PUTAR SEMUA", onclick: () => {
          if (!pl.lagu.length) { toast("Playlist masih kosong"); return; }
          state.queue = pl.lagu.slice(); putar(0);
        } }),
        el("button", { class: "btn small", type: "button", text: "UBAH NAMA", onclick: () => ubahNamaPl(pl.id) }),
        el("button", { class: "btn small red", type: "button", text: "HAPUS PLAYLIST", onclick: () => hapusPlaylist(pl.id) }),
      ]));
      const box = el("div", { class: "list" });
      root.appendChild(box);
      renderTracks(pl.lagu, box, { plId: pl.id, kosong: "Playlist kosong. Tambahkan lagu lewat tombol + LIST di hasil pencarian atau beranda." });
      return;
    }

    root.appendChild(el("h2", { text: "Playlist saya" }));
    root.appendChild(el("div", { class: "bar-aksi" }, [
      el("button", { class: "btn green", type: "button", text: "+ PLAYLIST BARU", onclick: playlistBaruLewatForm }),
    ]));
    if (!state.playlists.length) {
      root.appendChild(el("p", { class: "empty", text: "Belum ada playlist. Buat satu, lalu tambahkan lagu lewat tombol + LIST." }));
      return;
    }
    const box = el("div", { class: "list" });
    state.playlists.forEach((p) => {
      box.appendChild(el("div", { class: "item" }, [
        el("div", { class: "meta" }, [el("strong", { text: p.nama }), el("span", { text: p.lagu.length + " lagu" })]),
        el("div", { class: "acts" }, [
          el("button", { class: "btn small blue", type: "button", text: "BUKA", onclick: () => { state.bukaPl = p.id; renderPlaylists(); } }),
          el("button", { class: "btn small", type: "button", text: "UBAH NAMA", onclick: () => ubahNamaPl(p.id) }),
          el("button", { class: "btn small red", type: "button", text: "HAPUS", onclick: () => hapusPlaylist(p.id) }),
        ]),
      ]));
    });
    root.appendChild(box);
  }

  /* ================= mesin downloader (dicoba satu per satu, langsung dari browser) ================= */
  async function ambilLink(t, quality, onStatus, lewati) {
    const dilewati = lewati || [];
    let aktif = window.NYRNet.mesin.filter((e) => dilewati.indexOf(e.id) === -1);
    if (!aktif.length) { state.mesinGagal[t.id] = []; aktif = window.NYRNet.mesin.slice(); }
    const terakhir = lsGet("nyr_mesin_terakhir", "");
    aktif.sort((a, b) => (b.id === terakhir) - (a.id === terakhir));
    const gagal = [];
    for (let i = 0; i < aktif.length; i++) {
      const e = aktif[i];
      if (onStatus) onStatus("Mesin " + (i + 1) + "/" + aktif.length + ": " + e.name + "...");
      try {
        const r = await window.NYRNet.resolve(e.id, { id: t.id, quality });
        lsSet("nyr_mesin_terakhir", e.id);
        return Object.assign({ engine: e.id }, r);
      } catch (err) {
        gagal.push(e.name + ": " + (err.name === "AbortError" ? "waktu habis" : (err.message || "gagal")));
      }
    }
    const err = new Error("Semua mesin gagal. " + gagal.join(" | "));
    err.detail = gagal;
    throw err;
  }

  /* ================= pemutar ================= */
  function updatePlayerUI(t) {
    $("#player").hidden = false;
    $("#p-title").textContent = t.title || t.id;
    $("#p-sub").textContent = t.author || "";
    $("#p-cover").src = coverOf(t);
    setMedia(t);
    updatePipDoc();
  }
  const setSub = (m) => { $("#p-sub").textContent = m; };

  async function sumberAudio(t, onStatus) {
    const saved = await dbGet(t.id);
    if (saved && saved.blob) return { blobUrl: URL.createObjectURL(saved.blob) };
    const c = state.resolveCache.get(t.id);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return c.r;
    if (!navigator.onLine) throw new Error("sedang offline dan lagu belum tersimpan");
    const r = await ambilLink(t, "128", onStatus, state.mesinGagal[t.id]);
    state.resolveCache.set(t.id, { t: Date.now(), r });
    return r;
  }

  function pasangSumber(src) {
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
    audio.loop = getSet().mode === "ulang";
    if (src.blobUrl) { state.blobUrl = src.blobUrl; state.currentEngine = ""; audio.src = src.blobUrl; return; }
    state.currentEngine = src.engine || "";
    audio.src = src.url;
  }

  async function putar(i, mulai) {
    const t = state.queue[i];
    if (!t) return;
    state.index = i;
    const token = ++state.playToken;
    state.switching = true;
    state.userPaused = false;
    state.interrupted = false;
    if (!audio.paused) audio.pause();
    updatePlayerUI(t);
    setSub("Menyiapkan lagu...");
    try {
      const src = await sumberAudio(t, setSub);
      if (token !== state.playToken) return;
      pasangSumber(src);
      if (mulai > 0) audio.addEventListener("loadedmetadata", () => { try { audio.currentTime = mulai; } catch { /* abaikan */ } }, { once: true });
      setSub(t.author || "");
      await audio.play();
    } catch (e) {
      if (token !== state.playToken) return;
      state.switching = false;
      setSub("gagal memutar");
      toast("Gagal memutar: " + e.message, 6000);
    }
  }

  function muatUlang() {
    const t = state.queue[state.index];
    if (!t) return;
    const pos = audio.currentTime || 0;
    state.resolveCache.delete(t.id);
    putar(state.index, pos);
  }

  // Lanjutkan dari posisi sekarang; kalau sumbernya sudah mati (link kedaluwarsa), muat ulang.
  async function lanjutkan() {
    if (state.index < 0) { if (state.queue.length) putar(0); return; }
    const rusak = !audio.src || audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
    if (!rusak) {
      try { await audio.play(); return; } catch { /* lanjut ke muat ulang */ }
    }
    muatUlang();
  }
  function jeda() { state.userPaused = true; audio.pause(); }
  function toggle() {
    if (!state.queue.length) return;
    if (audio.paused) { state.userPaused = false; lanjutkan(); } else jeda();
  }
  function prev() { if (audio.currentTime > 5 || state.index <= 0) { audio.currentTime = 0; } else putar(state.index - 1); }
  function next() { if (state.index + 1 < state.queue.length) putar(state.index + 1); }

  function syncPlayIcon() {
    const playing = !audio.paused;
    $("#ic-play").toggleAttribute("hidden", playing);
    $("#ic-pause").toggleAttribute("hidden", !playing);
    $("#p-play").setAttribute("aria-label", playing ? "Jeda" : "Putar");
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    updatePipDoc();
  }

  let prefetchTimer = null;
  function jadwalPrefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      if (getSet().mode !== "auto") return;
      const n = state.queue[state.index + 1];
      if (!n || !navigator.onLine) return;
      try {
        const r = await sumberAudio(n);
        if (r && r.blobUrl) URL.revokeObjectURL(r.blobUrl);
      } catch { /* abaikan */ }
    }, 5000);
  }

  audio.addEventListener("play", () => { state.userPaused = false; state.interrupted = false; syncPlayIcon(); });
  audio.addEventListener("playing", () => {
    state.switching = false;
    const t = state.queue[state.index];
    if (t) delete state.errRetry[t.id];
    syncPlayIcon();
    jadwalPrefetch();
  });
  audio.addEventListener("pause", () => {
    // jeda yang bukan dari tombol kita dan bukan akhir lagu dianggap gangguan (aplikasi lain mengambil audio)
    if (!state.userPaused && !state.switching && !audio.ended && state.index >= 0) state.interrupted = true;
    syncPlayIcon();
  });
  audio.addEventListener("ended", () => {
    syncPlayIcon();
    if (getSet().mode === "auto" && state.index + 1 < state.queue.length) putar(state.index + 1);
  });
  audio.addEventListener("error", () => {
    if (!audio.src) return;
    const t = state.queue[state.index];
    if (!t) return;
    // sumber ini bermasalah: tandai supaya percobaan berikutnya memakai mesin lain
    if (state.currentEngine) state.mesinGagal[t.id] = (state.mesinGagal[t.id] || []).concat(state.currentEngine);
    const n = state.errRetry[t.id] || 0;
    if (n < 2) {
      state.errRetry[t.id] = n + 1;
      toast("Sumber lagu bermasalah, mencoba mesin lain...");
      muatUlang();
    } else {
      toast("Lagu tidak bisa diputar");
    }
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.duration && !$("#p-seek").matches(":active")) $("#p-seek").value = Math.round((audio.currentTime / audio.duration) * 1000);
    if ("mediaSession" in navigator && navigator.mediaSession.setPositionState && isFinite(audio.duration) && audio.duration > 0) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch { /* abaikan */ }
    }
  });

  // Kembali ke aplikasi setelah gangguan: lanjutkan otomatis kalau tadi bukan dijeda oleh pengguna.
  function cobaLanjut() {
    if (state.interrupted && !state.userPaused && audio.paused && state.index >= 0) {
      state.interrupted = false;
      lanjutkan();
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cobaLanjut(); });
  window.addEventListener("pageshow", cobaLanjut);
  window.addEventListener("focus", cobaLanjut);

  $("#p-play").addEventListener("click", toggle);
  $("#p-prev").addEventListener("click", prev);
  $("#p-next").addEventListener("click", next);
  $("#p-seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
  $("#p-mode").addEventListener("click", () => {
    const sekarang = getSet().mode;
    const idx = MODE.findIndex((m) => m[0] === sekarang);
    const baru = MODE[(idx + 1) % MODE.length];
    setSet({ mode: baru[0] });
    terapkanPengaturan();
    toast(baru[2], 3500);
  });

  function setMedia(t) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || "", artist: t.author || "", album: "NYR Musik",
      artwork: [{ src: coverOf(t), sizes: "480x360", type: "image/jpeg" }],
    });
  }
  if ("mediaSession" in navigator) {
    const h = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch { /* tidak didukung */ } };
    h("play", () => { state.userPaused = false; lanjutkan(); });
    h("pause", jeda);
    h("stop", jeda);
    h("previoustrack", prev);
    h("nexttrack", next);
    h("seekto", (d) => { if (d && d.seekTime != null && isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
  }

  /* ================= jendela mengambang ================= */
  function updatePipDoc() {
    const w = state.pipWin;
    if (!w || w.closed) return;
    const t = state.queue[state.index] || {};
    const d = w.document;
    const a = d.getElementById("pt"); if (a) a.textContent = t.title || "-";
    const b = d.getElementById("ps"); if (b) b.textContent = t.author || "";
    const c = d.getElementById("pp"); if (c) c.textContent = audio.paused ? "PUTAR" : "JEDA";
  }

  async function pipDokumen() {
    const win = await window.documentPictureInPicture.requestWindow({ width: 340, height: 170 });
    state.pipWin = win;
    const d = win.document;
    const css = d.createElement("style");
    css.textContent =
      "*{box-sizing:border-box}body{margin:0;padding:10px;background:#FFF8E7;font-family:system-ui,sans-serif;color:#000}" +
      ".box{border:3px solid #000;box-shadow:4px 4px 0 #000;background:#fff;padding:10px}" +
      "#pt{font-weight:900;font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
      "#ps{font-size:12px;font-weight:700;margin-bottom:10px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
      ".r{display:flex;gap:8px}button{flex:1;padding:10px 0;font:inherit;font-weight:800;background:#FFD93D;border:3px solid #000;box-shadow:3px 3px 0 #000;cursor:pointer}" +
      "button:active{transform:translate(3px,3px);box-shadow:none}";
    d.head.appendChild(css);
    const box = d.createElement("div"); box.className = "box";
    const t = d.createElement("div"); t.id = "pt";
    const s = d.createElement("div"); s.id = "ps";
    const row = d.createElement("div"); row.className = "r";
    [["SEBELUM", prev, "pb"], ["PUTAR", toggle, "pp"], ["BERIKUT", next, "pn"]].forEach(([txt, fn, id]) => {
      const b = d.createElement("button"); b.id = id; b.type = "button"; b.textContent = txt; b.addEventListener("click", fn); row.appendChild(b);
    });
    box.append(t, s, row);
    d.body.appendChild(box);
    win.addEventListener("pagehide", () => { state.pipWin = null; });
    updatePipDoc();
  }

  function gambarKanvas() {
    const cv = state.canvas;
    const g = cv.getContext("2d");
    const t = state.queue[state.index] || {};
    g.fillStyle = "#FFF8E7"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000"; g.fillRect(22, 22, cv.width - 30, cv.height - 30);
    g.fillStyle = "#FFD93D"; g.fillRect(14, 14, cv.width - 30, cv.height - 30);
    g.strokeStyle = "#000"; g.lineWidth = 6; g.strokeRect(14, 14, cv.width - 30, cv.height - 30);
    g.fillStyle = "#000"; g.font = "bold 14px system-ui, sans-serif";
    g.fillText(audio.paused ? "JEDA" : "SEDANG DIPUTAR", 30, 44);
    g.font = "900 26px system-ui, sans-serif";
    const words = String(t.title || "NYR MUSIK").split(" ");
    let line = "", y = 90, rows = 0;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > cv.width - 76 && line) {
        g.fillText(line, 30, y); y += 32; rows++; line = w;
        if (rows >= 2) break;
      } else line = test;
    }
    if (rows < 3) g.fillText(line, 30, y);
    g.font = "bold 16px system-ui, sans-serif";
    g.fillText(String(t.author || "").slice(0, 40), 30, cv.height - 62);
    const pct = audio.duration ? audio.currentTime / audio.duration : 0;
    g.fillStyle = "#fff"; g.fillRect(30, cv.height - 46, cv.width - 76, 16);
    g.fillStyle = "#4D96FF"; g.fillRect(30, cv.height - 46, (cv.width - 76) * pct, 16);
    g.strokeRect(30, cv.height - 46, cv.width - 76, 16);
  }

  async function pipKanvas() {
    if (!document.pictureInPictureEnabled) throw new Error("browser ini tidak mendukung jendela mengambang");
    if (!state.canvas) { state.canvas = document.createElement("canvas"); state.canvas.width = 480; state.canvas.height = 270; }
    gambarKanvas();
    const v = $("#pip-video");
    if (!v.srcObject) v.srcObject = state.canvas.captureStream(5);
    v.muted = true;
    await v.play();
    await v.requestPictureInPicture();
    clearInterval(state.pipTimer);
    state.pipTimer = setInterval(gambarKanvas, 1000);
    v.addEventListener("leavepictureinpicture", () => clearInterval(state.pipTimer), { once: true });
  }

  $("#p-float").addEventListener("click", async () => {
    if (!state.queue.length) { toast("Putar lagu dulu"); return; }
    if (state.pipWin && !state.pipWin.closed) { state.pipWin.close(); return; }
    try {
      if ("documentPictureInPicture" in window) { await pipDokumen(); return; }
    } catch { /* lanjut ke cara kanvas */ }
    try { await pipKanvas(); } catch (e) { toast("Jendela mengambang gagal: " + e.message, 5000); }
  });

  /* ================= unduh ================= */
  function setDl(text, pct) {
    $("#dl-status").hidden = false;
    $("#dl-text").textContent = text;
    $("#dl-bar").style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
  }

  async function unduhBlob(url, tipe, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const total = Number(resp.headers.get("content-length") || 0);
    const chunks = [];
    let got = 0;
    if (resp.body && resp.body.getReader) {
      const rd = resp.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(got, total);
      }
    } else { chunks.push(new Uint8Array(await resp.arrayBuffer())); }
    return new Blob(chunks, { type: tipe });
  }

  async function mulaiUnduh(t) {
    if (state.busy) { toast("Masih ada unduhan berjalan"); return; }
    if (!navigator.onLine) { toast(TEKS_OFFLINE); return; }
    state.busy = true;
    $("#btn-unduh").disabled = true;
    showTab("unduh");
    const quality = $("#sel-kualitas").value;
    const offline = $("#chk-offline").checked;
    try {
      setDl("Mencari mesin yang aktif...", 3);
      const r = await ambilLink(t, quality, (m) => setDl(m, 10));
      const ext = r.ext || "mp3";
      const judul = t.title || r.title || t.id;
      setDl("Mengunduh dari " + r.engine + "...", 25);
      let blob = null;
      try {
        blob = await unduhBlob(r.url, TIPE_AUDIO[ext] || "audio/mpeg", (got, total) =>
          setDl("Mengunduh " + (got / 1048576).toFixed(1) + " MB" + (total ? " dari " + (total / 1048576).toFixed(1) + " MB" : ""), total ? 25 + (got / total) * 70 : 60));
      } catch (e) {
        if (e.name !== "TypeError") throw e;
        // sumber tidak mengizinkan dibaca langsung oleh browser (CORS): serahkan link ke browser
        const a = document.createElement("a");
        a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.download = cleanName(judul) + "." + ext;
        document.body.appendChild(a); a.click(); a.remove();
        setDl("Sumber tidak mengizinkan penyimpanan langsung. Link dibuka lewat browser (tidak tersimpan di aplikasi): " + judul, 100);
        return;
      }
      if (blob.size < 20000) throw new Error("file terlalu kecil, kemungkinan bukan lagu");
      simpanFile(blob, judul, ext);
      await dbPut({
        id: t.id, title: judul, author: t.author || "", thumbnail: coverOf(t),
        quality: r.quality || "", engine: r.engine, ext, time: Date.now(), size: blob.size, blob: offline ? blob : null,
      }).catch(() => toast("Tersimpan ke folder unduhan, tapi gagal disimpan di aplikasi"));
      setDl("Selesai: " + judul + "." + ext + " (" + (blob.size / 1048576).toFixed(1) + " MB)", 100);
      renderSaved();
    } catch (e) {
      setDl("Gagal: " + e.message, 0);
    } finally {
      state.busy = false;
      $("#btn-unduh").disabled = false;
    }
  }

  $("#form-unduh").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#in-link").value.trim();
    if (!text) { toast("Isi link YouTube dulu"); return; }
    const id = extractId(text);
    if (!id) { toast("Bukan link YouTube, mencari sebagai kata kunci"); cari(text); return; }
    mulaiUnduh({ id, title: "", author: "", thumbnail: "" });
  });
  $("#sel-kualitas").addEventListener("change", (e) => setSet({ kualitas: e.target.value }));
  $("#chk-offline").addEventListener("change", (e) => setSet({ offline: e.target.checked }));

  async function renderSaved() {
    const box = $("#saved");
    const rows = (await dbAll()).sort((a, b) => b.time - a.time);
    box.replaceChildren();
    if (!rows.length) { box.appendChild(el("p", { class: "empty", text: "Belum ada unduhan." })); return; }
    rows.forEach((r, i) => {
      const info = [r.quality, r.engine, r.blob ? "tersimpan offline" : "hanya di folder unduhan"].filter(Boolean).join(" - ");
      const acts = [
        el("button", { class: "btn small blue", type: "button", text: "PUTAR", onclick: () => { state.queue = rows.map((x) => ({ id: x.id, title: x.title, author: x.author, thumbnail: x.thumbnail })); putar(i); } }),
      ];
      if (r.blob) acts.push(el("button", { class: "btn small green", type: "button", text: "SIMPAN LAGI", onclick: () => simpanFile(r.blob, r.title, r.ext) }));
      acts.push(el("button", { class: "btn small red", type: "button", text: "HAPUS", onclick: async () => { await dbDel(r.id); renderSaved(); } }));
      box.appendChild(el("div", { class: "item" }, [
        el("img", { src: r.thumbnail || coverOf(r), alt: "", width: "72", height: "54" }),
        el("div", { class: "meta" }, [el("strong", { text: r.title }), el("span", { text: info })]),
        el("div", { class: "acts" }, acts),
      ]));
    });
  }

  /* ================= data: nama guest + backup zip ================= */
  function setData(text, pct) {
    $("#data-status").hidden = false;
    $("#data-text").textContent = text;
    $("#data-bar").style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
  }

  async function renderData() {
    renderNama();
    const rows = await dbAll();
    const offline = rows.filter((r) => r.blob).length;
    $("#data-ringkas").textContent = "Saat ini: " + state.playlists.length + " playlist, " + rows.length + " riwayat unduhan, " + offline + " lagu tersimpan offline.";
  }

  $("#form-nama").addEventListener("submit", (e) => {
    e.preventDefault();
    const baru = window.NYRData.nama($("#in-nama").value);
    lsSet("nyr_nama", baru);
    renderNama();
    toast("Nama disimpan: " + baru);
  });
  $("#btn-nama").addEventListener("click", () => { showTab("data"); $("#in-nama").focus(); });

  async function ekspor() {
    if (state.dataBusy) { toast("Masih ada proses backup berjalan"); return; }
    state.dataBusy = true;
    $("#btn-ekspor").disabled = true; $("#btn-impor").disabled = true;
    try {
      setData("Menyiapkan data...", 2);
      const rows = await dbAll();
      const data = {
        app: "NYR Musik", versi: 1, dibuat: new Date().toISOString(),
        profil: { nama: getNama() },
        pengaturan: getSet(),
        playlists: state.playlists,
        riwayat: rows.map((r) => ({
          id: r.id, title: r.title, author: r.author, thumbnail: r.thumbnail, quality: r.quality, ext: r.ext || "mp3",
          engine: r.engine, time: r.time, size: r.size, offline: !!r.blob,
        })),
      };
      const files = [{ nama: "data.json", data: new TextEncoder().encode(JSON.stringify(data, null, 1)) }];
      rows.filter((r) => r.blob).forEach((r) => files.push({ nama: "audio/" + r.id + "." + (r.ext || "mp3"), data: r.blob }));
      const blob = await window.NYRZip.buat(files, (i, n) => setData("Mengemas " + i + " dari " + n + " file...", 5 + (i / n) * 90));
      const tgl = new Date().toISOString().slice(0, 10);
      simpanBlobSebagai(blob, "NYR-Musik-backup-" + cleanName(getNama()).replace(/\s+/g, "-") + "-" + tgl + ".zip");
      setData("Selesai: backup berisi " + data.playlists.length + " playlist dan " + (files.length - 1) + " lagu offline (" + (blob.size / 1048576).toFixed(1) + " MB).", 100);
    } catch (e) {
      setData("Backup gagal: " + e.message, 0);
    } finally {
      state.dataBusy = false;
      $("#btn-ekspor").disabled = false; $("#btn-impor").disabled = false;
    }
  }

  async function impor(file) {
    if (state.dataBusy) { toast("Masih ada proses berjalan"); return; }
    state.dataBusy = true;
    $("#btn-ekspor").disabled = true; $("#btn-impor").disabled = true;
    try {
      setData("Membaca arsip zip...", 3);
      const entri = await window.NYRZip.baca(file);
      const dj = entri.get("data.json");
      if (!dj) throw new Error("data.json tidak ditemukan, ini bukan backup NYR Musik");
      let mentah;
      try { mentah = JSON.parse(new TextDecoder().decode(await window.NYRZip.ambil(dj, 20 * 1048576))); }
      catch (e) { throw new Error(e.message && e.message.indexOf("CRC") >= 0 ? e.message : "data.json rusak atau bukan JSON"); }
      const data = window.NYRData.bersihkan(mentah);
      const namaAudio = (r) => "audio/" + r.id + "." + (r.ext || "mp3");
      const audioList = data.riwayat.filter((r) => r.offline && entri.has(namaAudio(r)));

      const ok = window.confirm(
        "Pulihkan data backup?\n\nNama: " + data.profil.nama + "\nPlaylist: " + data.playlists.length +
        "\nLagu offline: " + audioList.length + "\n\nData dengan ID yang sama akan ditimpa, data lain tetap aman."
      );
      if (!ok) { setData("Impor dibatalkan.", 0); return; }

      setData("Memulihkan nama, pengaturan, dan playlist...", 8);
      lsSet("nyr_nama", data.profil.nama);
      lsSet("nyr_pengaturan", data.pengaturan);
      data.playlists.forEach((pl) => {
        const idx = state.playlists.findIndex((p) => p.id === pl.id);
        if (idx >= 0) state.playlists[idx] = pl; else state.playlists.push(pl);
      });
      state.playlists = state.playlists.slice(0, 100);
      simpanPl();

      let berhasil = 0, gagal = 0;
      for (let i = 0; i < data.riwayat.length; i++) {
        const r = data.riwayat[i];
        setData("Memulihkan lagu " + (i + 1) + " dari " + data.riwayat.length + "...", 10 + (i / Math.max(1, data.riwayat.length)) * 88);
        try {
          let blob = null;
          if (r.offline && entri.has(namaAudio(r))) {
            const bytes = await window.NYRZip.ambil(entri.get(namaAudio(r)), 200 * 1048576);
            blob = new Blob([bytes], { type: TIPE_AUDIO[r.ext] || "audio/mpeg" });
          } else {
            const ada = await dbGet(r.id);
            if (ada) continue;
          }
          await dbPut({ id: r.id, title: r.title, author: r.author, thumbnail: r.thumbnail || coverOf(r), quality: r.quality, engine: r.engine, ext: r.ext || "mp3", time: r.time, size: blob ? blob.size : r.size, blob });
          berhasil++;
        } catch { gagal++; }
      }

      terapkanPengaturan();
      renderNama(); renderHome(); renderSaved(); renderPlaylists(); renderData();
      setData("Selesai: data berhasil dipulihkan" + (gagal ? " (" + gagal + " lagu gagal dipulihkan)" : "") + ".", 100);
      toast("Data berhasil dipulihkan");
    } catch (e) {
      setData("Impor gagal: " + e.message, 0);
    } finally {
      state.dataBusy = false;
      $("#btn-ekspor").disabled = false; $("#btn-impor").disabled = false;
      $("#file-impor").value = "";
    }
  }

  $("#btn-ekspor").addEventListener("click", ekspor);
  $("#btn-impor").addEventListener("click", () => $("#file-impor").click());
  $("#file-impor").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) impor(f); });

  /* ================= pencarian & navigasi ================= */
  $("#form-cari").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#in-cari").value.trim();
    if (q.length < 2) { toast("Kata kunci minimal 2 huruf"); return; }
    cari(q);
  });
  $$(".nav").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  window.addEventListener("online", applyNet);
  window.addEventListener("offline", applyNet);

  /* ================= mulai ================= */
  state.playlists = lsGet("nyr_playlists", []);
  if (!Array.isArray(state.playlists)) state.playlists = [];
  terapkanPengaturan();
  renderNama();
  renderHome();
  applyNet();
  showTab("home");
  muatLagu();
  muatPopuler();

  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => { /* PWA opsional */ });
    });
  }
})();
