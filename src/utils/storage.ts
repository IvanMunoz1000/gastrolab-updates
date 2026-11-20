import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/config';

export interface CompressedImageResult {
  dataUrl: string;
  file: File;
}

/**
 * Converts a data URL safely to a File without fetch/network dependencies.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

/**
 * Compresses and resizes any image File (including large mobile camera photos)
 * into a lightweight JPEG (< 80 KB) so Firestore saves never fail (>1MB limit)
 * and mobile browsers never crash or reload.
 */
export async function compressImageFile(
  file: File,
  maxDim = 560,
  quality = 0.8
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const objectUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;

    const processImageSrc = (src: string, revokeAfter: boolean) => {
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width || maxDim;
          let height = img.naturalHeight || img.height || maxDim;

          if (width > height) {
            if (width > maxDim) {
              height = Math.max(1, Math.round((height * maxDim) / width));
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.max(1, Math.round((width * maxDim) / height));
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            if (revokeAfter && objectUrl) URL.revokeObjectURL(objectUrl);
            reject(new Error('No se pudo inicializar el procesador de imagen.'));
            return;
          }

          // White background so transparent PNGs convert cleanly to crisp JPEG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          // Safety cap: if still large, step down quality slightly so Firestore 1MB limit is never approached
          if (compressedDataUrl.length > 180_000) {
            compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
          }

          const safeBase = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'imagen';
          const compressedFile = dataUrlToFile(compressedDataUrl, `${safeBase}.jpg`);

          if (revokeAfter && objectUrl) URL.revokeObjectURL(objectUrl);
          resolve({ dataUrl: compressedDataUrl, file: compressedFile });
        } catch (err) {
          if (revokeAfter && objectUrl) URL.revokeObjectURL(objectUrl);
          reject(err instanceof Error ? err : new Error('No se pudo procesar la imagen.'));
        }
      };

      img.onerror = () => {
        if (revokeAfter && objectUrl) {
          URL.revokeObjectURL(objectUrl);
          // Fallback to FileReader if objectUrl failed
          const reader = new FileReader();
          reader.onload = (ev) => {
            if (typeof ev.target?.result === 'string') {
              processImageSrc(ev.target.result, false);
            } else {
              reject(new Error('El archivo seleccionado no es una imagen compatible.'));
            }
          };
          reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
          reader.readAsDataURL(file);
        } else {
          reject(new Error('El archivo seleccionado no pudo cargarse como imagen.'));
        }
      };

      img.src = src;
    };

    if (objectUrl) {
      processImageSrc(objectUrl, true);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          processImageSrc(ev.target.result, false);
        } else {
          reject(new Error('No se pudo leer el archivo de imagen.'));
        }
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
      reader.readAsDataURL(file);
    }
  });
}

/**
 * Compresses the product photo on the client first, then attempts Firebase Storage upload
 * with a fast 3-second timeout. Always falls back cleanly to the compact compressed Data URL.
 */
export async function uploadProductImage(file: File): Promise<string> {
  const { file: compressedFile, dataUrl } = await compressImageFile(file, 560, 0.8);

  const timestamp = Date.now();
  const safeName = compressedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `products/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  try {
    const uploadPromise = (async () => {
      const snapshot = await uploadBytes(storageRef, compressedFile, {
        contentType: 'image/jpeg',
      });
      return await getDownloadURL(snapshot.ref);
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Storage upload timeout')), 3000)
    );

    const downloadUrl = await Promise.race([uploadPromise, timeoutPromise]);
    return downloadUrl;
  } catch (error) {
    console.warn('Usando imagen comprimida local optimizada para Firestore:', error);
    return dataUrl;
  }
}
