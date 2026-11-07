'use client';

import { useEffect, useRef } from 'react';

import { ScrollTrigger } from '@/lib/gsap';
import { readThemeColors } from '@/lib/theme';

import './letter-canvas.css';

/**
 * The footer's falling letters.
 *
 * The template's `FallingLetters` module ran Matter.js physics on a canvas
 * inside `#letter-parent`; the compiled module itself is missing from the
 * scrape, but `matter-js` is still the right tool, so this is a rebuild of the
 * same idea: the letters of GHOST WRITER drop in, collide, and settle into a pile
 * along the bottom of the footer. They are thrown once the footer scrolls into
 * view and can be nudged with the pointer.
 */

const WORD = 'GHOST WRITER';

/*
 * Only the letters get a physics body. A space would spawn a rectangle with
 * no glyph to draw — an invisible block knocking the real letters around.
 */
const LETTERS = Array.from(WORD).filter((char) => char.trim() !== '');

export default function LetterCanvas() {
  const parentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const parent = parentRef.current;
    const canvas = canvasRef.current;
    if (!parent || !canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let destroyed = false;
    let cleanup: (() => void) | undefined;

    // matter-js is only needed in the browser, and only for this one widget.
    void import('matter-js').then((Matter) => {
      if (destroyed) return;

      const { Engine, Composite, Bodies, Body, Runner, Mouse, MouseConstraint } = Matter;

      const engine = Engine.create();
      engine.gravity.y = 1;

      const runner = Runner.create();
      Runner.run(runner, engine);

      let width = 0;
      let height = 0;
      let dpr = 1;
      let fontSize = 0;
      let walls: Matter.Body[] = [];
      let letters: { body: Matter.Body; char: string; width: number; height: number }[] = [];
      let thrown = false;

      const buildWalls = () => {
        Composite.remove(engine.world, walls);
        const thickness = 200;
        walls = [
          // floor
          Bodies.rectangle(width / 2, height + thickness / 2, width * 2, thickness, { isStatic: true }),
          // left
          Bodies.rectangle(-thickness / 2, height / 2, thickness, height * 3, { isStatic: true }),
          // right
          Bodies.rectangle(width + thickness / 2, height / 2, thickness, height * 3, { isStatic: true }),
        ];
        Composite.add(engine.world, walls);
      };

      const buildLetters = () => {
        Composite.remove(
          engine.world,
          letters.map((letter) => letter.body),
        );

        fontSize = Math.max(28, Math.min(width / (LETTERS.length * 0.78), height / 3.4));
        context.font = `400 ${fontSize}px Aeonik, "Helvetica Neue", Arial, sans-serif`;

        letters = LETTERS.map((char, i) => {
          const metrics = context.measureText(char);
          const w = Math.max(metrics.width, fontSize * 0.35);
          const h = fontSize * 0.78;

          const body = Bodies.rectangle(
            width * 0.12 + ((width * 0.76) / (LETTERS.length - 1)) * i,
            // Stacked well above the canvas so they rain in one after another.
            -h * 2 - i * h * 1.6,
            w,
            h,
            {
              restitution: 0.35,
              friction: 0.35,
              frictionAir: 0.005,
              density: 0.0014,
              angle: (Math.random() - 0.5) * 0.6,
            },
          );

          return { body, char, width: w, height: h };
        });

        Composite.add(
          engine.world,
          letters.map((letter) => letter.body),
        );
      };

      const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = parent.clientWidth;
        height = parent.clientHeight;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildWalls();
        buildLetters();
      };

      resize();

      // Pointer interaction, exactly what Matter's MouseConstraint is for.
      const mouse = Mouse.create(canvas);
      const mouseConstraint = MouseConstraint.create(engine, {
        mouse,
        constraint: { stiffness: 0.12, render: { visible: false } },
      });
      Composite.add(engine.world, mouseConstraint);
      // Let the page keep scrolling over the canvas.
      canvas.removeEventListener('wheel', (mouse as unknown as { mousewheel: EventListener }).mousewheel);

      const throwIn = () => {
        if (thrown) return;
        thrown = true;
        letters.forEach((letter, i) => {
          setTimeout(() => {
            if (destroyed) return;
            Body.setVelocity(letter.body, { x: (Math.random() - 0.5) * 4, y: 6 });
            Body.setAngularVelocity(letter.body, (Math.random() - 0.5) * 0.25);
          }, i * 120);
        });
      };

      const trigger = ScrollTrigger.create({
        trigger: parent,
        start: 'top 85%',
        once: true,
        onEnter: throwIn,
      });

      // Canvas cannot read CSS variables, so resolve them once here.
      const theme = readThemeColors();

      let frame = 0;
      const render = () => {
        frame = requestAnimationFrame(render);

        context.fillStyle = theme.bg;
        context.fillRect(0, 0, width, height);

        context.font = `400 ${fontSize}px Aeonik, "Helvetica Neue", Arial, sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = theme.fg;

        for (const letter of letters) {
          const { position, angle } = letter.body;
          context.save();
          context.translate(position.x, position.y);
          context.rotate(angle);
          context.fillText(letter.char, 0, 0);
          context.restore();
        }
      };

      frame = requestAnimationFrame(render);

      const observer = new ResizeObserver(() => resize());
      observer.observe(parent);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        trigger.kill();
        Runner.stop(runner);
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      };
    });

    return () => {
      destroyed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div id="letter-parent" ref={parentRef}>
      <div className="letter-over" />
      <canvas ref={canvasRef} />
    </div>
  );
}
