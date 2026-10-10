import React, { useEffect, useRef } from 'react';
import { isLowPowerMode } from '../utils/tauri';
import './UiWeatherEffects.css';

const EFFECTS = new Set(['snow', 'leaves', 'rain', 'grass', 'all']);

function particleCount(intensity, base, lowPower) {
  const scale = lowPower ? 0.45 : 1;
  return Math.max(8, Math.floor(base * (0.35 + intensity * 0.85) * scale));
}

function initSnow(count, width, height) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: 1 + Math.random() * 2.2,
    speed: 0.4 + Math.random() * 1.1,
    drift: (Math.random() - 0.5) * 0.35,
    alpha: 0.35 + Math.random() * 0.55,
  }));
}

function initLeaves(count, width, height) {
  const colors = ['#c97b2e', '#d4a03a', '#8f5e2b', '#6f9c4a', '#b85c38'];
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: 5 + Math.random() * 7,
    speed: 0.5 + Math.random() * 1.2,
    drift: (Math.random() - 0.5) * 0.8,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.04,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 0.45 + Math.random() * 0.45,
  }));
}

function initRain(count, width, height) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    len: 8 + Math.random() * 14,
    speed: 6 + Math.random() * 10,
    alpha: 0.2 + Math.random() * 0.35,
  }));
}

function initGrass(count, width, height) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: height * (0.72 + Math.random() * 0.28),
    h: 6 + Math.random() * 14,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: 0.4 + Math.random() * 0.8,
    alpha: 0.25 + Math.random() * 0.45,
    rise: Math.random() < 0.25,
    riseSpeed: 0.15 + Math.random() * 0.35,
  }));
}

function paintSnow(ctx, particles, width, height, intensity) {
  ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + intensity * 0.35})`;
  particles.forEach((p) => {
    p.y += p.speed;
    p.x += p.drift + Math.sin(p.y * 0.02) * 0.15;
    if (p.y > height + 4) {
      p.y = -4;
      p.x = Math.random() * width;
    }
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function paintLeaves(ctx, particles, width, height) {
  particles.forEach((p) => {
    p.y += p.speed;
    p.x += p.drift + Math.sin(p.y * 0.015) * 0.4;
    p.rot += p.rotSpeed;
    if (p.y > height + 10) {
      p.y = -10;
      p.x = Math.random() * width;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size * 0.45, p.size * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

function paintRain(ctx, particles, width, height, intensity) {
  ctx.strokeStyle = `rgba(140, 190, 255, ${0.35 + intensity * 0.4})`;
  ctx.lineWidth = 1;
  particles.forEach((p) => {
    p.y += p.speed;
    if (p.y > height + p.len) {
      p.y = -p.len;
      p.x = Math.random() * width;
    }
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 1.5, p.y + p.len);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function paintGrass(ctx, particles, width, height, time) {
  particles.forEach((p) => {
    if (p.rise) {
      p.y -= p.riseSpeed;
      if (p.y < height * 0.55) {
        p.y = height * (0.72 + Math.random() * 0.28);
        p.x = Math.random() * width;
      }
    }
    const sway = Math.sin(time * p.swaySpeed + p.sway) * 4;
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = '#5fbf6a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + sway, p.y - p.h * 0.45, p.x + sway * 0.4, p.y - p.h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(90, 200, 100, 0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x + sway * 0.2, p.y - p.h, 2.2, 3.2, sway * 0.08, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function UiWeatherEffects({ effect = 'none', intensity = 0.45, enabled = true }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ snow: [], leaves: [], rain: [], grass: [] });
  const active = enabled && effect !== 'none' && EFFECTS.has(effect);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    let rafId = 0;
    let running = true;
    let start = performance.now();
    const lowPower = isLowPowerMode();
    const power = Math.min(1, Math.max(0, Number(intensity) || 0));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 2);
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = effect === 'all' ? 0.55 : 1;
      stateRef.current = {
        snow: initSnow(particleCount(power, 90, lowPower) * density, width, height),
        leaves: initLeaves(particleCount(power, 36, lowPower) * density, width, height),
        rain: initRain(particleCount(power, 120, lowPower) * density, width, height),
        grass: initGrass(particleCount(power, 48, lowPower) * density, width, height),
      };
    };

    const paint = (now) => {
      if (!running) return;
      if (document.hidden || document.documentElement.classList.contains('animations-off')) {
        return;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;
      const time = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      const layers = effect === 'all' ? ['snow', 'leaves', 'rain', 'grass'] : [effect];
      const particles = stateRef.current;

      if (layers.includes('snow')) paintSnow(ctx, particles.snow, width, height, power);
      if (layers.includes('leaves')) paintLeaves(ctx, particles.leaves, width, height);
      if (layers.includes('rain')) paintRain(ctx, particles.rain, width, height, power);
      if (layers.includes('grass')) paintGrass(ctx, particles.grass, width, height, time);

      rafId = window.requestAnimationFrame(paint);
    };

    const onVisibility = () => {
      if (!running) return;
      if (document.hidden) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      if (!rafId) {
        rafId = window.requestAnimationFrame(paint);
      }
    };

    resize();
    rafId = window.requestAnimationFrame(paint);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, effect, intensity]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`ui-weather-effects ui-weather-effects--${effect}`}
      aria-hidden="true"
    />
  );
}

export default UiWeatherEffects;
