/**
 * Навигация внутри VK Mini App (без ухода в системный браузер).
 * На телефоне обычный <a href> часто открывает Chrome/Safari снаружи WebView.
 */
(function () {
  function resolve(path) {
    try {
      return new URL(path, window.location.href).href;
    } catch (_) {
      return path;
    }
  }

  function go(path) {
    var url = resolve(path);
    // только тот же origin — иначе VK и так уведёт наружу
    try {
      if (new URL(url).origin !== window.location.origin) {
        window.location.assign(url);
        return;
      }
    } catch (_) {}
    window.location.assign(url);
  }

  window.vkGo = go;

  function onNavClick(e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-vk-nav]") : null;
    if (!el) return;
    var path = el.getAttribute("data-vk-nav");
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    go(path);
  }

  document.addEventListener("click", onNavClick, true);
})();
