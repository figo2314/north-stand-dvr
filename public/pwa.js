(() => {
  "use strict";

  const installButton = document.querySelector("[data-pwa-install]");

  function showInstallButton() {
    installButton?.removeAttribute("hidden");
  }

  function hideInstallButton() {
    installButton?.setAttribute("hidden", "");
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.__northStandInstallPrompt = event;
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    window.__northStandInstallPrompt = null;
    hideInstallButton();
  });

  installButton?.addEventListener("click", async () => {
    const prompt = window.__northStandInstallPrompt;
    if (!prompt) {
      return;
    }
    prompt.prompt();
    await prompt.userChoice;
    window.__northStandInstallPrompt = null;
    hideInstallButton();
  });
})();
