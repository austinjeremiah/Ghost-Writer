/**
 * Line / word / character splitter.
 *
 * The template shipped a compiled `splitTextAnimation` helper that wrapped
 * every line in `.e-line > .line-inner`, every word in `.word` and every
 * character in `.char`, then marked the host element `.splitted`. The CSS in
 * `src/styles/globals.css` targets exactly those classes, so this rebuild
 * produces the same DOM shape.
 */

export type SplitMode = 'chars' | 'lines';

const WRAPPER_SELECTOR = 'small, b, i, em, strong, span, abbr';

interface SplitResult {
  lines: HTMLElement[];
  words: HTMLElement[];
  chars: HTMLElement[];
}

function wrapWords(node: Node, chars: boolean): Node[] {
  const out: Node[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const parts = text.split(/(\s+)/);

    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        out.push(document.createTextNode(' '));
        continue;
      }

      const word = document.createElement('span');
      word.className = 'word';
      word.style.display = 'inline-block';

      if (chars) {
        for (const ch of Array.from(part)) {
          const charEl = document.createElement('span');
          charEl.className = 'char';
          charEl.style.display = 'inline-block';
          charEl.textContent = ch;
          word.appendChild(charEl);
        }
      } else {
        word.textContent = part;
      }

      out.push(word);
    }

    return out;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const clone = el.cloneNode(false) as HTMLElement;

    if (el.matches(WRAPPER_SELECTOR)) {
      clone.style.display = 'inline-block';
      clone.style.position = 'relative';
    }

    for (const child of Array.from(el.childNodes)) {
      for (const replacement of wrapWords(child, chars)) {
        clone.appendChild(replacement);
      }
    }

    out.push(clone);
    return out;
  }

  return out;
}

/**
 * Splits `el` in place. Idempotent: calling it twice is a no-op, so React's
 * strict-mode double effect cannot double-wrap the markup.
 */
export function splitText(el: HTMLElement | null, mode: SplitMode = 'chars'): SplitResult {
  const empty: SplitResult = { lines: [], words: [], chars: [] };
  if (!el) return empty;

  if (el.classList.contains('splitted')) {
    return {
      lines: Array.from(el.querySelectorAll<HTMLElement>('.e-line')),
      words: Array.from(el.querySelectorAll<HTMLElement>('.word')),
      chars: Array.from(el.querySelectorAll<HTMLElement>('.char')),
    };
  }

  if (!el.dataset.splitSource) {
    el.dataset.splitSource = el.innerHTML;
  }

  const wantChars = mode === 'chars';
  const fragment = document.createDocumentFragment();

  for (const child of Array.from(el.childNodes)) {
    for (const replacement of wrapWords(child, wantChars)) {
      fragment.appendChild(replacement);
    }
  }

  el.innerHTML = '';
  el.appendChild(fragment);

  // Measure which words sit on which visual line, then group them into
  // `.e-line > .line-inner` wrappers so each line can be masked separately.
  const words = Array.from(el.querySelectorAll<HTMLElement>('.word'));
  const topLevel = Array.from(el.childNodes);
  const rows = new Map<number, Node[]>();

  const offsetOf = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) return Number.NaN;
    const target =
      (node as HTMLElement).classList?.contains('word')
        ? (node as HTMLElement)
        : (node as HTMLElement).querySelector<HTMLElement>('.word');
    return target ? Math.round(target.getBoundingClientRect().top) : Number.NaN;
  };

  let currentTop: number | null = null;
  for (const node of topLevel) {
    const top = offsetOf(node);
    if (!Number.isNaN(top)) currentTop = top;
    const key = currentTop ?? 0;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(node);
  }

  const lines: HTMLElement[] = [];
  const lineFragment = document.createDocumentFragment();
  let idx = 0;

  for (const nodes of rows.values()) {
    const line = document.createElement('span');
    line.className = 'e-line';
    line.style.display = 'block';
    line.style.textAlign = 'start';
    line.style.width = '100%';
    line.dataset.lineIdx = String(idx++);

    const inner = document.createElement('span');
    inner.className = 'line-inner';
    for (const node of nodes) inner.appendChild(node);

    line.dataset.line = (inner.textContent ?? '').trim();
    line.appendChild(inner);
    lineFragment.appendChild(line);
    lines.push(line);
  }

  el.innerHTML = '';
  el.appendChild(lineFragment);
  el.classList.add('splitted');

  return {
    lines,
    words,
    chars: Array.from(el.querySelectorAll<HTMLElement>('.char')),
  };
}

/** Restores the original markup captured by the first `splitText` call. */
export function revertSplit(el: HTMLElement | null) {
  if (!el || !el.dataset.splitSource) return;
  el.innerHTML = el.dataset.splitSource;
  el.classList.remove('splitted');
  delete el.dataset.splitSource;
}
