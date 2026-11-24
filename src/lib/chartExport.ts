import { downloadBlob } from './mapExport';

// Ekspor PNG ringkasan data dibuat dengan palet terang khusus cetak agar hasil
// tetap terbaca meskipun dashboard sedang memakai tema gelap.
const WIDTH = 1240;
const PAD = 52;
const SCALE = 2;
export const CHART_CONTENT_WIDTH = WIDTH - PAD * 2;
const FONT = '"DM Sans", "Segoe UI", Arial, sans-serif';

export type ChartPalette = {
  sample: string;
  positive: string;
  sero: string;
  ink: string;
  muted: string;
  line: string;
};

export const PRINT_CHART_PALETTE: ChartPalette = {
  sample: '#98998f',
  positive: '#b44530',
  sero: '#3f7c49',
  ink: '#1c241d',
  muted: '#5f6a60',
  line: '#d5d8d1'
};

const PALETTE = {
  card: '#ffffff',
  ink: '#1c241d',
  muted: '#5f6a60',
  line: '#d5d8d1',
  soft: '#f0f2ed',
  accent: '#2f4a36',
  positive: '#b44530',
  sero: '#3f7c49'
};

export type ChartExportStat = {
  label: string;
  value: string;
  tone?: 'ink' | 'positive' | 'sero';
};

export type ChartExportPart = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  caption?: string;
};

export type ChartExportOptions = {
  title: string;
  subtitle: string;
  note?: string;
  stats?: ChartExportStat[];
  parts: ChartExportPart[];
  baseName: string;
};

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || context.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  top: number,
  lineHeight: number,
  size: number
): number {
  lines.forEach((line, index) => {
    context.fillText(line, x, top + lineHeight * 0.5 + size * 0.34 + index * lineHeight);
  });
  return top + lines.length * lineHeight;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const image = new Image();
    image.src = '/logo-bv-lampung.png';
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

function formatStamp(date: Date): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Gambar PNG tidak dapat dibuat.'));
    }, 'image/png');
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function composeChartSheet(
  options: ChartExportOptions,
  partIndex: number,
  logo: HTMLImageElement | null = null,
  stamp: string = formatStamp(new Date())
): HTMLCanvasElement {
  const part = options.parts[partIndex];
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('Canvas tidak tersedia di peramban ini.');

  const contentWidth = CHART_CONTENT_WIDTH;
  const titleFont = `700 30px ${FONT}`;
  const subtitleFont = `400 14.5px ${FONT}`;
  const captionFont = `500 13px ${FONT}`;
  const noteFont = `400 12.5px ${FONT}`;

  measure.font = titleFont;
  const titleLines = wrapText(measure, options.title, contentWidth);
  measure.font = subtitleFont;
  const subtitleLines = wrapText(measure, options.subtitle, contentWidth);
  measure.font = captionFont;
  const captionLines = part.caption ? wrapText(measure, part.caption, contentWidth) : [];
  measure.font = noteFont;
  const noteLines = options.note ? wrapText(measure, options.note, contentWidth) : [];

  const brandTop = 44;
  const titleTop = brandTop + 54;
  let cursor = drawLines(measure, titleLines, PAD, titleTop, 38, 30);
  const subtitleTop = cursor + 8;
  cursor = drawLines(measure, subtitleLines, PAD, subtitleTop, 21, 14.5);
  let captionTop = 0;
  if (captionLines.length) {
    captionTop = cursor + 7;
    cursor = drawLines(measure, captionLines, PAD, captionTop, 19, 13);
  }
  const dividerY = cursor + 22;
  const chartTop = dividerY + 26;
  const chartBottom = chartTop + part.height;

  let afterChart = chartBottom;
  let noteTop = 0;
  if (noteLines.length) {
    noteTop = afterChart + 24;
    afterChart = noteTop + noteLines.length * 19;
  }
  let statsTop = 0;
  if (options.stats?.length) {
    statsTop = afterChart + 18;
    afterChart = statsTop + 40;
  }
  const footerDividerY = afterChart + 24;
  const totalHeight = footerDividerY + 54;

  const canvas = document.createElement('canvas');
  // Turunkan kerapatan piksel untuk gambar yang sangat panjang agar tidak
  // melewati batas ukuran kanvas peramban.
  const scale = WIDTH * totalHeight * SCALE * SCALE > 16_000_000 ? 1 : SCALE;
  canvas.width = WIDTH * scale;
  canvas.height = Math.ceil(totalHeight) * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas tidak tersedia di peramban ini.');
  context.scale(scale, scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.textBaseline = 'alphabetic';

  context.fillStyle = PALETTE.card;
  context.fillRect(0, 0, WIDTH, totalHeight);

  // Aksen tipis di tepi atas, mengikuti gaya ekspor peta.
  context.fillStyle = PALETTE.accent;
  context.fillRect(0, 0, WIDTH, 6);

  if (logo) {
    const logoHeight = 40;
    const logoWidth = (logo.naturalWidth / logo.naturalHeight) * logoHeight || logoHeight;
    context.drawImage(logo, WIDTH - PAD - logoWidth, 32, logoWidth, logoHeight);
  }

  context.textAlign = 'left';
  context.fillStyle = PALETTE.accent;
  context.font = `600 12px ${FONT}`;
  context.fillText('RINGKASAN DATA PENGUJIAN · IV LAB', PAD, brandTop + 12);
  context.fillStyle = PALETTE.muted;
  context.font = `500 11.5px ${FONT}`;
  context.fillText('BALAI VETERINER LAMPUNG', PAD, brandTop + 30);

  context.fillStyle = PALETTE.ink;
  context.font = titleFont;
  drawLines(context, titleLines, PAD, titleTop, 38, 30);

  context.fillStyle = PALETTE.muted;
  context.font = subtitleFont;
  drawLines(context, subtitleLines, PAD, subtitleTop, 21, 14.5);

  if (captionLines.length) {
    context.fillStyle = PALETTE.accent;
    context.font = captionFont;
    drawLines(context, captionLines, PAD, captionTop, 19, 13);
  }

  context.fillStyle = PALETTE.line;
  context.fillRect(PAD, dividerY, contentWidth, 1);

  context.drawImage(part.canvas, PAD, chartTop, contentWidth, part.height);

  if (noteLines.length) {
    context.fillStyle = PALETTE.muted;
    context.font = noteFont;
    drawLines(context, noteLines, PAD, noteTop, 19, 12.5);
  }

  if (options.stats?.length && statsTop) {
    let chipX = PAD;
    const chipHeight = 40;
    const toneColor = (tone: ChartExportStat['tone']) =>
      tone === 'positive' ? PALETTE.positive : tone === 'sero' ? PALETTE.sero : PALETTE.ink;

    options.stats.forEach((stat) => {
      context.font = `400 13px ${FONT}`;
      const labelWidth = context.measureText(stat.label).width;
      context.font = `600 15px ${FONT}`;
      const valueWidth = context.measureText(stat.value).width;
      const chipWidth = 16 + 7 + 8 + labelWidth + 14 + valueWidth + 16;

      context.fillStyle = PALETTE.soft;
      roundRect(context, chipX, statsTop, chipWidth, chipHeight, 9);
      context.fill();
      context.strokeStyle = PALETTE.line;
      context.lineWidth = 1;
      context.stroke();

      context.fillStyle = toneColor(stat.tone);
      context.beginPath();
      context.arc(chipX + 19, statsTop + chipHeight / 2, 4, 0, Math.PI * 2);
      context.fill();

      context.textAlign = 'left';
      context.fillStyle = PALETTE.muted;
      context.font = `400 13px ${FONT}`;
      context.fillText(stat.label, chipX + 31, statsTop + chipHeight / 2 + 4.5);

      context.fillStyle = toneColor(stat.tone);
      context.font = `600 15px ${FONT}`;
      context.fillText(stat.value, chipX + 31 + labelWidth + 14, statsTop + chipHeight / 2 + 5);

      chipX += chipWidth + 10;
    });
  }

  context.fillStyle = PALETTE.line;
  context.fillRect(PAD, footerDividerY, contentWidth, 1);

  context.textAlign = 'left';
  context.fillStyle = PALETTE.muted;
  context.font = `400 12px ${FONT}`;
  context.fillText('Sumber: Panel Admin IV Lab · Balai Veteriner Lampung · Data agregat pengujian', PAD, footerDividerY + 24);

  const partLabel = options.parts.length > 1 ? ` · Bagian ${partIndex + 1} dari ${options.parts.length}` : '';
  context.textAlign = 'right';
  context.fillText(`Diekspor ${stamp}${partLabel}`, WIDTH - PAD, footerDividerY + 24);
  context.textAlign = 'left';

  return canvas;
}

export async function downloadChartImages(options: ChartExportOptions): Promise<void> {
  if (!options.parts.length) return;
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Abaikan: teks akan memakai font cadangan bila DM Sans gagal dimuat.
    }
  }

  const logo = await loadLogo();
  const stamp = formatStamp(new Date());

  for (let index = 0; index < options.parts.length; index += 1) {
    const canvas = composeChartSheet(options, index, logo, stamp);
    const blob = await canvasToBlob(canvas);
    const suffix = options.parts.length > 1 ? `_bagian-${index + 1}` : '';
    downloadBlob(blob, `${options.baseName}${suffix}.png`);
    if (index < options.parts.length - 1) await delay(550);
  }
}
