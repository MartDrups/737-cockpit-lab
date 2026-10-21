'use strict';
(() => {
  const appRoot = new URL('.', document.currentScript.src);
  const button = document.querySelector('#repair-update');
  const status = document.querySelector('#repair-status');
  let applying = false;
  const openCBT = () => location.replace(new URL('#cbt', appRoot).href);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (applying) openCBT();
  });
  const settle = worker => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Подготовка заняла слишком много времени. Повторите проверку.')), 90000);
    function finish(error) {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', change);
      error ? reject(error) : resolve();
    }
    function change() {
      if (worker.state === 'redundant') finish(new Error('Не удалось скачать обновление. Проверьте интернет и повторите.'));
      else if (worker.state === 'installed' || worker.state === 'activated') finish();
    }
    worker.addEventListener('statechange', change);
    change();
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Проверяем обновление…';
    try {
      if (!navigator.serviceWorker || !isSecureContext) throw new Error('Откройте эту страницу в Safari по защищённой ссылке.');
      if (!navigator.onLine) throw new Error('Для обновления подключитесь к интернету.');
      const registration = await navigator.serviceWorker.register(new URL('sw.js', appRoot), {scope: appRoot.href, updateViaCache: 'none'});
      await registration.update();
      if (registration.installing) {
        status.textContent = 'Подготавливаем новую версию… Сохранённые материалы остаются на устройстве.';
        await settle(registration.installing);
        // Let the registration expose its waiting worker after the state event.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (registration.waiting) {
        status.textContent = 'Применяем обновление…';
        applying = true;
        registration.waiting.postMessage({type: 'SKIP_WAITING'});
      } else {
        await navigator.serviceWorker.ready;
        openCBT();
      }
    } catch (error) {
      applying = false;
      status.textContent = error.message || 'Не удалось проверить обновление. Повторите.';
      button.disabled = false;
    }
  });
})();
