/**
 * Canvas text that survives a headset.
 *
 * Two things kill in-world text in VR. The first is resolution: a 256 px
 * texture stretched across a half-metre panel is a blurry mess through a
 * headset lens, so everything here is authored at a high pixel-per-metre
 * density and downsampled by the GPU rather than the other way round. The
 * second is colour management — a canvas is sRGB, and forgetting to say so
 * washes every panel out.
 */

import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

export interface CrispCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  /** Call after drawing. */
  commit(): void;
}

export function crispCanvas(width: number, height: number): CrispCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return {
    canvas,
    ctx,
    texture,
    commit() {
      texture.needsUpdate = true;
    },
  };
}

/** Text with a soft glow behind it — legible against stars or regolith alike. */
export function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  glow: string,
  align: CanvasTextAlign = 'center',
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = glow;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  // A second pass with no shadow keeps the glyph edges hard instead of letting
  // the bloom eat them.
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
}
