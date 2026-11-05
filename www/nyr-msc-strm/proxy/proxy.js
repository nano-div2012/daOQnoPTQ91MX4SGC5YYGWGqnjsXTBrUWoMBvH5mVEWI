// Pengecek link versi demo. Demo tidak punya server, jadi pengecekan ini berjalan di browser
// dan hanya sebagai pagar tipis (bisa dilewati orang yang paham kode).
(function () {
  "use strict";
  const ALLOWED_HOSTS = [
    "localhost",                      // APK (WebView) yang memuat lewat localhost
    "127.0.0.1",
    "appassets.androidplatform.net",  // APK (WebViewAssetLoader)
    "nyr-msc-strm-demov1.vercel.app"  // link pin demo
  ];

  // APK yang memuat file langsung dari penyimpanan memakai alamat file://
  function hostDiizinkan() {
    return window.location.protocol === "file:" || ALLOWED_HOSTS.indexOf(window.location.hostname) !== -1;
  }

  window.NYRProxy = { hostDiizinkan: hostDiizinkan, ALLOWED_HOSTS: ALLOWED_HOSTS };
})();
