(function () {
  "use strict";

  const baseRender = render;
  render = function () {
    if (view === "ai") {
      if (!isOffice()) {
        view = "worker";
      } else {
        applyCompanySettings();
        renderNav();
        document.getElementById("avatar").textContent = roleName().charAt(0);
        document.getElementById("pageTitle").textContent = "EdilKappa AI";
        document.getElementById("app").innerHTML = window.edilkappaAiView?.() || '<div class="empty">Caricamento EdilKappa AI…</div>';
        return;
      }
    }
    baseRender();
  };
})();
