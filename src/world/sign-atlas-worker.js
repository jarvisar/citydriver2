import { SIGN_ATLAS, paintAtlas } from './city-signs.js';
import { SIGN_SHEET_URL } from './city-sign-sheet.js';

// Draws the sign atlas off the main thread and posts it back as a bitmap, or
// null where it cannot (workers without a 2D canvas, or no sheet): the page
// then draws it itself (see signSheet in city-signs.js).
async function picture() {
  try {
    const response = await fetch(SIGN_SHEET_URL);
    if (!response.ok) return null;
    const sheet = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(SIGN_ATLAS.width, SIGN_ATLAS.height);
    paintAtlas(canvas.getContext('2d'), sheet);
    sheet.close();
    return canvas.transferToImageBitmap();
  } catch { return null; }
}
picture().then(bitmap => postMessage(bitmap, bitmap ? [bitmap] : []));
