(() => {
  const dialog = document.getElementById('scanner');
  const video = document.getElementById('scan-video');
  const status = document.getElementById('scan-status');
  const file = document.getElementById('scan-file');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently:true});
  let decoder;
  let stream;
  let timer;
  let revision = 0;

  function loadDecoder() {
    if (!decoder) {
      decoder = new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = './jsqr-1.4.0.js';
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          decoder = undefined;
          reject(Error('decoder_unavailable'));
        };
        document.head.append(script);
      });
    }
    return decoder;
  }

  function stopCamera() {
    clearTimeout(timer);
    stream?.getTracks().forEach(track=>track.stop());
    stream = undefined;
    video.srcObject = null;
  }

  function decode(source, width, height) {
    const scale = Math.min(1, 1280 / Math.max(width,height));
    canvas.width = Math.max(1, Math.floor(width*scale));
    canvas.height = Math.max(1, Math.floor(height*scale));
    context.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels = context.getImageData(0,0,canvas.width,canvas.height);
    return window.jsQR(pixels.data,pixels.width,pixels.height)?.data;
  }

  function accept(value) {
    let url;
    try { url = new URL(value); } catch { return false; }
    const code = new URLSearchParams(url.hash.slice(1)).get('pair');
    if (url.origin !== location.origin || url.username || url.password || url.search ||
        !/^\/remote\/p\/[a-f0-9]{64}\/$/.test(url.pathname) ||
        !/^[a-f0-9]{64}$/.test(code || '')) {
      status.textContent = 'Это не QR-код подключения YCore. Покажите код из настроек пульта на ПК.';
      return false;
    }
    dialog.close();
    window.dispatchEvent(new CustomEvent('remote-qr-scanned',{detail:{path:url.pathname,code}}));
    return true;
  }

  function scan(captured) {
    if (!dialog.open || captured !== revision) return;
    if (video.readyState >= 2) {
      try {
        const value = decode(video,video.videoWidth,video.videoHeight);
        if (value && accept(value)) return;
      } catch {
        status.textContent = 'Не удалось прочитать кадр. Можно выбрать фото QR-кода.';
      }
    }
    timer = setTimeout(()=>scan(captured),240);
  }

  async function openScanner() {
    if (dialog.open) return;
    dialog.showModal();
    file.value = '';
    status.textContent = 'Открываем камеру…';
    const captured = ++revision;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false,
      });
      if (!dialog.open || captured !== revision) {
        camera.getTracks().forEach(track=>track.stop());
        return;
      }
      stream = camera;
      video.srcObject = stream;
      await video.play();
      await loadDecoder();
      if (!dialog.open || captured !== revision) return;
      status.textContent = 'Наведите камеру на QR-код.';
      scan(captured);
    } catch {
      if (captured !== revision) return;
      stopCamera();
      status.textContent = 'Камера недоступна. Разрешите доступ в браузере или выберите фото QR-кода.';
    }
  }

  file.onchange = async () => {
    const imageFile = file.files[0];
    if (!imageFile) return;
    if (imageFile.size > 20*1024*1024) {
      status.textContent = 'Выберите изображение размером до 20 МБ.';
      return;
    }
    stopCamera();
    const captured = ++revision;
    status.textContent = 'Читаем QR-код…';
    const url = URL.createObjectURL(imageFile);
    try {
      const image = new Image();
      image.src = url;
      await Promise.all([image.decode(),loadDecoder()]);
      if (!dialog.open || captured !== revision) return;
      const value = decode(image,image.naturalWidth,image.naturalHeight);
      if (!value) status.textContent = 'QR-код не найден. Выберите более чёткое фото.';
      else accept(value);
    } catch {
      if (captured === revision) status.textContent = 'Не удалось прочитать изображение. Выберите другое фото.';
    } finally {
      URL.revokeObjectURL(url);
      file.value = '';
    }
  };
  for (const id of ['scan','pair-scan','reconnect-scan']) {
    document.getElementById(id).onclick = () => void openScanner();
  }
  document.getElementById('scan-close').onclick = () => dialog.close();
  dialog.addEventListener('close',()=>{++revision;stopCamera();});
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden && dialog.open) dialog.close();
  });
  window.addEventListener('pagehide',stopCamera);
})();
