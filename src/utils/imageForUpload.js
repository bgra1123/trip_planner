// Browser-only: turn a picked image file into the { mediaType, data } shape
// extractNotesFromImages() takes.
//
// Every image is redrawn onto a canvas and re-encoded as JPEG. That shrinks
// the upload to what the model can actually use, turns HEIC or anything
// else the browser can display into a type the API accepts, and drops
// photo metadata (EXIF location included) before anything leaves the device.

import { MAX_IMAGE_EDGE } from './screenshotExtract.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as an image.'));
    img.src = url;
  });
}

export async function imageFileToUpload(file, maxEdge = MAX_IMAGE_EDGE) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longEdge) throw new Error('This image has no size.');
    const scale = Math.min(1, maxEdge / longEdge);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency; a transparent PNG would otherwise go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
