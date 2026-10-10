import React, { useEffect, useRef } from 'react';
import { isLowPowerMode } from '../utils/tauri';

const LINE_CONFIGS = [
  { baseY: 48, amp: 7, waveLen: 340, phase: 0, vSpeed: 0.72, hSpeed: 0.95 },
  { baseY: 26, amp: 8, waveLen: 300, phase: 1.4, vSpeed: 0.58, hSpeed: 1.08 },
  { baseY: 62, amp: 6.5, waveLen: 360, phase: 2.1, vSpeed: 0.66, hSpeed: 0.88 },
  { baseY: 36, amp: 7.5, waveLen: 320, phase: 0.8, vSpeed: 0.61, hSpeed: 1.02 },
  { baseY: 52, amp: 6, waveLen: 380, phase: 3.2, vSpeed: 0.69, hSpeed: 0.92 },
];

function buildThreadPath(config, time) {
  const { baseY, amp, waveLen, phase, vSpeed, hSpeed } = config;
  const bob = Math.sin(time * vSpeed + phase) * amp * 0.72;
  const travel = time * hSpeed + phase;
  const xStart = -120;
  const xEnd = 1760;
  const steps = 40;
  const stepX = (xEnd - xStart) / steps;

  const yAt = (x) => baseY
    + bob
    + Math.sin((x / waveLen) * Math.PI * 2 + travel) * amp
    + Math.sin(travel * 0.55 + phase * 1.7) * (amp * 0.22);

  let d = '';
  for (let i = 0; i <= steps; i += 1) {
    const x = xStart + stepX * i;
    const y = yAt(x);
    if (i === 0) {
      d = `M${x.toFixed(1)},${y.toFixed(1)}`;
      continue;
    }

    const prevX = xStart + stepX * (i - 1);
    const prevY = yAt(prevX);
    const cx = (prevX + x) / 2;
    d += ` Q${cx.toFixed(1)},${prevY.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  }

  return d;
}

function paintStatic(glowRefs, lineRefs) {
  LINE_CONFIGS.forEach((config, index) => {
    const path = buildThreadPath(config, 0);
    glowRefs.current[index]?.setAttribute('d', path);
    lineRefs.current[index]?.setAttribute('d', path);
  });
}

function WaveThreads({ opacity = 1, isLive = false, isActive = false }) {
  const glowRefs = useRef([]);
  const lineRefs = useRef([]);
  const timeRef = useRef(0);
  const lowPower = isLowPowerMode();
  const shouldAnimate = !lowPower || isActive || isLive;

  useEffect(() => {
    glowRefs.current = glowRefs.current.slice(0, LINE_CONFIGS.length);
    lineRefs.current = lineRefs.current.slice(0, LINE_CONFIGS.length);

    if (!shouldAnimate || document.documentElement.classList.contains('animations-off')) {
      paintStatic(glowRefs, lineRefs);
      return undefined;
    }

    let rafId = 0;
    let last = performance.now();
    let running = true;

    const paint = (now) => {
      if (!running || document.hidden) {
        return;
      }

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      timeRef.current += dt;

      const time = timeRef.current;
      LINE_CONFIGS.forEach((config, index) => {
        const path = buildThreadPath(config, time);
        glowRefs.current[index]?.setAttribute('d', path);
        lineRefs.current[index]?.setAttribute('d', path);
      });

      rafId = requestAnimationFrame(paint);
    };

    const resume = () => {
      if (!running || document.hidden) return;
      last = performance.now();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(paint);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else {
        resume();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    rafId = requestAnimationFrame(paint);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [shouldAnimate]);

  const bannerClass = [
    'wave-lines-svg',
    isActive ? 'wave-lines-svg--active' : '',
    isLive ? 'wave-lines-svg--live' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={bannerClass}
      viewBox="-120 0 1840 80"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ opacity }}
    >
      <defs>
        <filter id="wave-thread-blur" x="-40%" y="-120%" width="180%" height="340%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className="wave-lines-track">
        {LINE_CONFIGS.map((config, index) => {
          const initialPath = buildThreadPath(config, 0);
          return (
            <g
              key={config.baseY}
              className={`wave-line-group${index % 2 ? ' wave-line-group--alt' : ''}`}
              style={{ '--wave-line-index': index }}
            >
              <path
                ref={(element) => {
                  glowRefs.current[index] = element;
                }}
                className="wave-line-glow"
                d={initialPath}
                fill="none"
              />
              <path
                ref={(element) => {
                  lineRefs.current[index] = element;
                }}
                className="wave-line"
                d={initialPath}
                fill="none"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default WaveThreads;
