// Ubah isi file ini untuk mengganti lagu, artis, dan sumber data versi demo.
window.NYR_CONFIG = {
  lagu: [
    { judul: "Sesi Potret", cari: "sesi potret" },
    { judul: "Monokrom", cari: "monokrom" },
    { judul: "Teh Hijau", cari: "teh hijau" },
    { judul: "Pesan Terakhir", cari: "pesan terakhir" }
  ],
  artis: [
    "Katy Perry", "Justin Bieber", "Taylor Swift", "Bruno Mars", "Billie Eilish", "Alan Walker", "Ava Max", "Luis Fonsi",
    "Tulus", "Wali Band", "Kangen Band", "Andmesh", "Anneth", "Ghea Indrawari", "Armada", "Virgoun", "Geisha", "Dia",
    "Tenxi", "Naykilla", "Budi Doremi", "Virzha", "Mahen", "Rizky Febian", "Afgan"
  ],
  akhiranPopuler: " official music video",

  // ---- Sumber data tanpa server Node.js ----
  // 1) Instance Piped (API publik yang boleh dipanggil dari browser). Dicoba berurutan.
  piped: [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.private.coffee",
    "https://pipedapi.adminforge.de",
    "https://api.piped.yt",
    "https://pipedapi.drgns.space",
    "https://pipedapi.owo.si",
    "https://pipedapi.ducks.party",
    "https://pipedapi.reallyaweso.me"
  ],
  // Daftar instance Piped terbaru (diambil otomatis, dicadangkan 6 jam). Kosongkan "" untuk mematikan.
  sumberDaftarPiped: "https://piped-instances.kavin.rocks/",
  // 2) Cadangan: halaman hasil YouTube lewat gerbang CORS pihak ketiga. {url} diganti alamat tujuan.
  //    Pihak ketiga ini bisa melihat kata kunci pencarian. Kosongkan [] untuk mematikan.
  gerbangCors: [
    "https://api.allorigins.win/raw?url={url}",
    "https://corsproxy.io/?url={url}"
  ]
};
