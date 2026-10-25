/**
 * 图片读取、压缩与旋转。
 * 图片只在内存中处理，不上传原图、不写入 localStorage。
 */

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2200;
const JPEG_QUALITY = 0.86;

export function validateImageFile(file) {
  if (!file) return '请选择课表截图';
  const type = (file.type || '').toLowerCase();
  if (!ACCEPTED_TYPES.includes(type)) {
    return '仅支持 PNG、JPG、JPEG、WebP 格式，请重新选择或先截图保存';
  }
  if (file.size > MAX_FILE_BYTES) {
    return '图片超过 20MB，请先裁剪或压缩后再上传';
  }
  return '';
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码，请换一张截图'));
    image.src = src;
  });
}

/**
 * 压缩到最长边约 2200px，保证课表小字仍可辨认。
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number }>}
 */
export async function prepareImage(file) {
  const raw = await readFileAsDataUrl(file);
  const image = await loadImage(raw);

  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length * 3) / 4) };
}

/** 顺时针旋转 90°，用于把横拍/倒置的截图摆正。 */
export async function rotateImage(dataUrl, degrees = 90) {
  const image = await loadImage(dataUrl);
  const turn = ((degrees % 360) + 360) % 360;
  const swap = turn === 90 || turn === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? image.naturalHeight : image.naturalWidth;
  canvas.height = swap ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turn * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
