/**
 * Обязательная инициализация для VK Mini Apps.
 * Без VKWebAppInit VK часто показывает «Сервис задумался…».
 */
(function initVkBridge() {
  function sendInit() {
    try {
      if (window.vkBridge && typeof window.vkBridge.send === "function") {
        window.vkBridge.send("VKWebAppInit");
        return true;
      }
    } catch (_) {
      // вне VK или bridge ещё не готов
    }
    return false;
  }

  if (sendInit()) return;

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (sendInit() || tries > 40) clearInterval(timer);
  }, 50);
})();
