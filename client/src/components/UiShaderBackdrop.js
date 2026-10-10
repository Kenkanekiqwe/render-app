import React, { useEffect, useRef } from 'react';
import './UiShaderBackdrop.css';

const SHADERS = new Set(['aurora', 'mesh', 'noise', 'grid']);

function paintAurora(ctx, width, height, time, intensity) {
  const alpha = 0.08 + intensity * 0.22;
  const g = ctx.createLinearGradient(0, 0, width, height);
  const hue = (time * 18) % 360;
  g.addColorStop(0, `hsla(${hue}, 72%, 58%, ${alpha})`);
  g.addColorStop(0.45, `hsla(${(hue + 80) % 360}, 68%, 52%, ${alpha * 0.85})`);
  g.addColorStop(1, `hsla(${(hue + 160) % 360}, 70%, 46%, ${alpha * 0.7})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 3; i += 1) {
    const x = width * (0.2 + i * 0.28) + Math.sin(time * 0.4 + i) * width * 0.08;
    const y = height * (0.3 + i * 0.15) + Math.cos(time * 0.35 + i * 1.4) * height * 0.1;
    const radius = Math.min(width, height) * (0.22 + i * 0.06);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `hsla(${(hue + i * 50) % 360}, 80%, 62%, ${alpha * 1.2})`);
    blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, width, height);
  }
}

function paintMesh(ctx, width, height, time, intensity) {
  const cols = 10;
  const rows = 7;
  const alpha = 0.05 + intensity * 0.18;
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      const px = (x / cols) * width;
      const py = (y / rows) * height;
      const wave = Math.sin(time * 0.8 + x * 0.55 + y * 0.4);
      const size = 2 + (wave + 1) * 2.5 * intensity;
      ctx.fillStyle = `hsla(${(200 + x * 14 + y * 10 + time * 20) % 360}, 70%, 62%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py + wave * 12, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintNoise(ctx, width, height, time, intensity) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const count = Math.floor(width * height * (0.002 + intensity * 0.006));
  for (let i = 0; i < count; i += 1) {
    const idx = (Math.floor(Math.random() * height) * width + Math.floor(Math.random() * width)) * 4;
    const tone = 120 + Math.sin(time + idx) * 80;
    data[idx] = tone;
    data[idx + 1] = tone * 0.8;
    data[idx + 2] = 255;
    data[idx + 3] = 18 + intensity * 40;
  }
  ctx.putImageData(image, 0, 0);
}

function paintGrid(ctx, width, height, time, intensity) {
  const alpha = 0.04 + intensity * 0.14;
  const spacing = 42;
  const offset = (time * 24) % spacing;
  ctx.strokeStyle = `rgba(124, 92, 255, ${alpha})`;
  ctx.lineWidth = 1;
  for (let x = -spacing; x < width + spacing; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + offset, 0);
    ctx.lineTo(x + offset, height);
    ctx.stroke();
  }
  for (let y = -spacing; y < height + spacing; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y + offset * 0.6);
    ctx.lineTo(width, y + offset * 0.6);
    ctx.stroke();
  }
}

function UiShaderBackdrop({ shader = 'none', intensity = 0.5, enabled = true }) {
  const canvasRef = useRef(null);
  const active = enabled && SHADERS.has(shader);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    let rafId = 0;
    let running = true;
    let start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (now) => {
      if (!running || document.hidden || document.documentElement.classList.contains('animations-off')) {
        return;
      }
      const time = (now - start) / 1000;
      const width = window.innerWidth;
      const height = window.innerHeight;
      ctx.clearRect(0, 0, width, height);
      const power = Math.min(1, Math.max(0, Number(intensity) || 0));

      if (shader === 'aurora') paintAurora(ctx, width, height, time, power);
      if (shader === 'mesh') paintMesh(ctx, width, height, time, power);
      if (shader === 'noise') paintNoise(ctx, width, height, time, power);
      if (shader === 'grid') paintGrid(ctx, width, height, time, power);

      rafId = window.requestAnimationFrame(paint);
    };

    resize();
    rafId = window.requestAnimationFrame(paint);
    window.addEventListener('resize', resize);

    return () => {
      running = false;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [active, shader, intensity]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`ui-shader-backdrop ui-shader-backdrop--${shader}`}
      aria-hidden="true"
    />
  );
}

export default UiShaderBackdrop;
