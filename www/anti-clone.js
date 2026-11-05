(function () {
  const ALLOWED_HOSTS = [
    "localhost",                      // APK (WebView) yang memuat lewat localhost
    "127.0.0.1",
    "appassets.androidplatform.net",  // APK (WebViewAssetLoader)
    "nyr-msc-strm-demov1.vercel.app"  // link pin demo
  ];
  const DESTINATION = "./nyr-msc-strm/index.html";
  const DENIED_MESSAGE = "link tidak resmi! Tidak dapat dibuka!";

  // APK yang memuat file langsung dari penyimpanan memakai alamat file://
  const isVerified = window.location.protocol === "file:" || ALLOWED_HOSTS.includes(window.location.hostname);

  if (isVerified) {
    window.location.replace(DESTINATION);
    return;
  }

  document.body.innerHTML = "";
  const notice = document.createElement("p");
  notice.id = "guard-message";
  notice.textContent = DENIED_MESSAGE;
  document.body.appendChild(notice);
})();
