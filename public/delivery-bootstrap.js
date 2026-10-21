/* The active worker answers this URL with an empty script. The physical file
   runs only on a first visit or with an older worker. */
(() => {
  'use strict';
  const root = new URL('.', new URL(document.currentScript?.src || '/delivery-bootstrap.js', location.origin));
  window.stop();
  document.open();
  document.write('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>737 · Cockpit Lab</title><body style="margin:0;background:#101719;color:#e5ece9;font:16px system-ui;display:grid;place-content:center;min-height:100vh;padding:24px;box-sizing:border-box"><main><h1 style="font-size:24px">737 Cockpit Lab</h1><p id="delivery-status" role="status">Загрузка приложения…</p><button id="delivery-retry" hidden>Повторить</button></main></body></html>');
  document.close();
  setTimeout(()=>document.getElementById('delivery-retry')?.addEventListener('click',()=>location.reload()),0);
  (async () => {
    if (!('serviceWorker' in navigator) || !('DecompressionStream' in window)) throw new Error('browser');
    const registration = await navigator.serviceWorker.register(new URL('sw.js', root), {scope:root.href,updateViaCache:'none'});
    function activate() { registration.waiting?.postMessage({type:'DELIVERY_ACTIVATE'}); }
    activate();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', activate));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      activate();
      if (navigator.serviceWorker.controller) {
        const response = await fetch(new URL('delivery-bootstrap.js', root), {cache:'no-store'});
        if (response.headers.get('X-CBT-Delivery') === 'gzip-v1') { location.reload(); return; }
      }
      await new Promise(resolve => setTimeout(resolve,150));
    }
    throw new Error('network');
  })().catch(error => {
    setTimeout(()=>{
      const status=document.getElementById('delivery-status'),retry=document.getElementById('delivery-retry');
      if(status)status.textContent = error.message === 'browser' ? 'Для открытия приложения обновите браузер.' : 'Не удалось загрузить приложение. Проверьте подключение и повторите.';
      if(retry)retry.hidden = false;
    },0);
  });
})();
