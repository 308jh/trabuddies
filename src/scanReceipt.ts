import { parseReceipt, type ParsedReceipt } from './parseReceipt'

// Read a photo of a receipt. The OCR engine runs inside the browser, so the
// photo never leaves the phone. It is downloaded only the first time it is used.
//
// To switch to a smarter AI reader later, only this function has to change.

const TARGET_WIDTH = 1600

async function loadBitmap(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

// make the photo easier to read: enlarge, grey, stretch the contrast
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const src = await loadBitmap(file)
  const scale = TARGET_WIDTH / src.width
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_WIDTH
  canvas.height = Math.max(1, Math.round(src.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot read images.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = d[i + 1] = d[i + 2] = g
    hist[g]++
  }
  const px = d.length / 4
  let lo = 0,
    hi = 255,
    acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc > px * 0.02) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc > px * 0.02) {
      hi = v
      break
    }
  }
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export async function scanReceipt(
  file: File,
  onProgress?: (text: string, fraction: number) => void,
): Promise<ParsedReceipt> {
  onProgress?.('Preparing the photo…', 0.02)
  const canvas = await prepare(file)

  onProgress?.('Loading the reader (first time only)…', 0.05)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text')
        onProgress?.('Reading the receipt…', 0.2 + m.progress * 0.8)
      else if (m.progress < 1)
        onProgress?.('Loading the reader (first time only)…', 0.05 + m.progress * 0.15)
    },
  })
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6' as never,
      preserve_interword_spaces: '1',
    })
    const { data } = await worker.recognize(canvas)
    return parseReceipt(data.text)
  } finally {
    await worker.terminate()
  }
}
