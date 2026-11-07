'use client';

import { useEffect, useRef } from 'react';

import { gsap, ScrollTrigger } from '@/lib/gsap';
import { readThemeColors, toRgbChannels } from '@/lib/theme';

import './revealer.css';

/**
 * Scroll-driven reveal for the integration screencast.
 *
 * The template drew this with a Three.js scene mounted on `#gl-2`
 * (`ButterflyScetch` / `Scetch`), and those modules are NOT part of the
 * scraped dump — only the `#gl-2` container, its CSS and the `.home__revealer`
 * marker survived. This is a canvas reimplementation with the same job: an
 * accent wipe that grows across the viewport as the section is scrolled, which
 * also fades in `.home-5__video-wrapper` (the stylesheet ships it at
 * `opacity: 0` on desktop, expecting the scene to raise it).
 */
export default function Revealer({ target }: { target: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const section = canvas.closest('section');
    const video = section?.querySelector<HTMLElement>(target);
    if (!context || !section) return;

    const tint = toRgbChannels(readThemeColors().fg);
    const state = { progress: 0 };
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = 1; // the original mounted this scene at dpr: 1
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (state.progress <= 0) return;

      const radius = Math.hypot(width, height) * 0.62 * state.progress;
      const cx = width / 2;
      const cy = height / 2;

      const gradient = context.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${tint}, 0)`);
      gradient.addColorStop(0.7, `rgba(${tint}, 0.1)`);
      gradient.addColorStop(1, `rgba(${tint}, 0)`);

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
    };

    resize();

    const tween = gsap.to(state, {
      progress: 1,
      ease: 'none',
      onUpdate: () => {
        draw();
        if (video) video.style.opacity = String(Math.min(1, state.progress * 1.6));
      },
      scrollTrigger: {
        trigger: section,
        start: 'top center',
        end: 'center center',
        scrub: true,
      },
    });

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      tween.scrollTrigger?.kill();
      tween.kill();
      ScrollTrigger.refresh();
      if (video) video.style.opacity = '';
    };
  }, [target]);

  return (
    <>
      <div id="gl-2">
        <canvas ref={canvasRef} />
      </div>
      <div className="home__revealer js-hidden" />
    </>
  );
}
