// Выполнять в контексте открытой карточки объекта: главный снимок галереи (первый слайд) — скачать тем же
// браузером (тот же сайт, те же cookie), уменьшить до maxWidth и отдать JPEG в base64. Только этот снимок:
// ни соседних слайдов, ни фотоотчётов, ни чужих объектов.
async (src, maxWidth) => {
  const response = await fetch(src, { credentials: 'include' });
  if (!response.ok) throw new Error(`фото ответило HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binary), width: canvas.width, height: canvas.height };
}
