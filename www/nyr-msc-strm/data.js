// Membersihkan dan memvalidasi data backup sebelum dipulihkan. Isi zip dianggap tidak tepercaya.
(function () {
  "use strict";
  const MODE = ["auto", "satu", "ulang"];
  const KUALITAS = ["128", "192", "256", "320"];
  const EKSTENSI = ["mp3", "m4a", "webm"];

  const teks = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);
  const idLagu = (s) => /^[\w-]{11}$/.test(String(s));
  const gambar = (u) => (/^https:\/\/i\.ytimg\.com\/[\w\-./?=&%]*$/.test(String(u)) ? String(u).slice(0, 200) : "");

  function nama(n) {
    const v = teks(n, 30).replace(/\s+/g, " ");
    return v || "Guest";
  }

  function lagu(o) {
    if (!o || typeof o !== "object" || !idLagu(o.id)) return null;
    return {
      id: o.id,
      title: teks(o.title, 200) || o.id,
      author: teks(o.author, 100),
      thumbnail: gambar(o.thumbnail),
      durasi: teks(o.durasi, 12),
    };
  }

  function bersihkan(d) {
    if (!d || typeof d !== "object" || d.app !== "NYR Musik") throw new Error("ini bukan file backup NYR Musik");
    const p = d.pengaturan && typeof d.pengaturan === "object" ? d.pengaturan : {};
    const out = {
      profil: { nama: nama(d.profil && d.profil.nama) },
      pengaturan: {
        mode: MODE.includes(p.mode) ? p.mode : "auto",
        kualitas: KUALITAS.includes(String(p.kualitas)) ? String(p.kualitas) : "320",
        offline: p.offline !== false,
      },
      playlists: [],
      riwayat: [],
    };

    const dipakai = new Set();
    (Array.isArray(d.playlists) ? d.playlists : []).slice(0, 100).forEach((pl) => {
      if (!pl || typeof pl !== "object") return;
      const id = /^pl_[a-z0-9]{4,30}$/.test(String(pl.id)) ? pl.id : "pl_" + Math.random().toString(36).slice(2, 10);
      if (dipakai.has(id)) return;
      dipakai.add(id);
      const daftar = [];
      const lihat = new Set();
      (Array.isArray(pl.lagu) ? pl.lagu : []).slice(0, 500).forEach((x) => {
        const l = lagu(x);
        if (l && !lihat.has(l.id)) { lihat.add(l.id); daftar.push(l); }
      });
      out.playlists.push({
        id,
        nama: teks(pl.nama, 40) || "Playlist",
        dibuat: Number.isFinite(pl.dibuat) ? pl.dibuat : Date.now(),
        lagu: daftar,
      });
    });

    const lihatR = new Set();
    (Array.isArray(d.riwayat) ? d.riwayat : []).slice(0, 2000).forEach((r) => {
      const l = lagu(r);
      if (!l || lihatR.has(l.id)) return;
      lihatR.add(l.id);
      out.riwayat.push(Object.assign({}, l, {
        quality: teks(r.quality, 20),
        engine: teks(r.engine, 20),
        time: Number.isFinite(r.time) ? r.time : Date.now(),
        size: Number.isFinite(r.size) ? r.size : 0,
        offline: r.offline === true,
        ext: EKSTENSI.includes(r.ext) ? r.ext : "mp3",
      }));
    });
    return out;
  }

  window.NYRData = { bersihkan, nama, MODE, KUALITAS };
})();
