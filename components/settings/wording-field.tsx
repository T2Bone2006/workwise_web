'use client';

import {
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  insertWordingToken,
  matchingWordingTokens,
  wordingTokenLabel,
  wordingTokenQuery,
} from '@/lib/messaging/wording';
import { cn } from '@/lib/utils';

const TOKEN_MIME = 'application/x-workwise-token';

type Piece = { token: string; required: boolean };

function splitPieces(
  value: string,
  known: Set<string>,
): { text: string; kind: 'text' | 'token' | 'bad' }[] {
  const out: { text: string; kind: 'text' | 'token' | 'bad' }[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  for (const match of value.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: value.slice(last, index), kind: 'text' });
    const name = match[1] ?? '';
    out.push({ text: match[0], kind: known.has(name) ? 'token' : 'bad' });
    last = index + match[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last), kind: 'text' });
  return out;
}

function TokenMark(props: { text: string; bad?: boolean; padded?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-sm bg-emerald-500/20',
        props.padded && 'px-0.5 font-medium text-emerald-950 dark:text-emerald-100',
        props.bad && 'bg-destructive/15 text-destructive',
      )}
    >
      {props.text}
    </span>
  );
}

export function WordingCopy(props: { text: string; tokens: readonly string[] }): JSX.Element {
  const known = new Set(props.tokens);
  const parts = splitPieces(props.text, known);
  return (
    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <TokenMark key={index} text={part.text} bad={part.kind === 'bad'} padded />
        ),
      )}
    </p>
  );
}

function caretOffset(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (!node || (node !== root && !root.contains(node))) return null;
  if (node === root) {
    let count = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      count += root.childNodes[i]?.textContent?.length ?? 0;
    }
    return count;
  }
  if (node.nodeType !== Node.TEXT_NODE) return null;
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current === node) return count + Math.min(offset, current.textContent?.length ?? 0);
    count += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return null;
}

export function WordingComposer(props: {
  value: string;
  onChange: (value: string) => void;
  pieces: readonly Piece[];
  ariaLabel: string;
  invalid?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef(props.value.length);
  const dragToken = useRef<string | null>(null);
  const [caret, setCaret] = useState(props.value.length);
  const [dropping, setDropping] = useState(false);
  const [active, setActive] = useState(0);

  const names = props.pieces.map((piece) => piece.token);
  const known = new Set(names);
  const query = wordingTokenQuery(props.value.slice(0, caret));
  const matches = query == null ? [] : matchingWordingTokens(query, names);
  const menuOpen = query != null && matches.length > 0;
  const safeActive = matches.length === 0 ? 0 : active % matches.length;

  function rememberCaret(index?: number) {
    const next = index ?? areaRef.current?.selectionStart ?? caretRef.current;
    caretRef.current = next;
    setCaret(next);
  }

  function write(next: { value: string; caret: number }) {
    props.onChange(next.value.slice(0, 500));
    caretRef.current = next.caret;
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(next.caret, next.caret);
    });
  }

  function insert(token: string, index = caretRef.current) {
    write(insertWordingToken(props.value, index, token));
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!menuOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const area = areaRef.current;
      if (!area) return;
      const at = area.selectionStart ?? props.value.length;
      const before = props.value.slice(0, at);
      const open = /\{[a-z0-9_]*$/.exec(before);
      if (!open) return;
      const start = at - open[0].length;
      write({ value: `${props.value.slice(0, start)}${props.value.slice(at)}`, caret: start });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const token = matches[safeActive];
      if (token) insert(token, areaRef.current?.selectionStart ?? caretRef.current);
    }
  }

  function onDragStart(event: DragEvent<HTMLButtonElement>, token: string) {
    dragToken.current = token;
    event.dataTransfer.setData(TOKEN_MIME, token);
    event.dataTransfer.setData('text/plain', `{${token}}`);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const token =
      event.dataTransfer.getData(TOKEN_MIME) ||
      dragToken.current ||
      '';
    setDropping(false);
    dragToken.current = null;
    if (!known.has(token)) return;
    const backdrop = backdropRef.current;
    const at = backdrop ? caretOffset(backdrop, event.clientX, event.clientY) : null;
    insert(token, at == null ? caretRef.current : Math.min(at, props.value.length));
  }

  const fieldClass =
    'm-0 box-border min-h-36 w-full overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-sm leading-6 [scrollbar-gutter:stable]';

  return (
    <div className="grid gap-6">
      <div
        className={cn(
          'relative rounded-md border border-input bg-transparent shadow-xs',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          props.invalid && 'border-destructive ring-[3px] ring-destructive/20',
          dropping && 'border-emerald-400 ring-[3px] ring-emerald-400/40',
        )}
        onDragEnter={(event) => {
          if (![...event.dataTransfer.types].includes(TOKEN_MIME) && !dragToken.current) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragOver={(event) => {
          if (!dropping && !dragToken.current) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropping(false);
        }}
        onDrop={onDrop}
      >
        <div
          ref={backdropRef}
          aria-hidden
          className={cn(
            fieldClass,
            'pointer-events-none text-foreground',
            dropping && 'pointer-events-auto',
          )}
        >
          {splitPieces(props.value, known).map((part, index) =>
            part.kind === 'text' ? (
              <span key={index}>{part.text}</span>
            ) : (
              <TokenMark key={index} text={part.text} bad={part.kind === 'bad'} />
            ),
          )}
          {props.value.endsWith('\n') ? '\n' : null}
        </div>
        <textarea
          ref={areaRef}
          value={props.value}
          aria-label={props.ariaLabel}
          aria-invalid={props.invalid || undefined}
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          maxLength={500}
          onChange={(event) => {
            rememberCaret(event.target.selectionStart ?? event.target.value.length);
            props.onChange(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={() => rememberCaret()}
          onClick={() => rememberCaret()}
          onSelect={() => rememberCaret()}
          onBlur={() => rememberCaret()}
          onScroll={(event) => {
            if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          className={cn(
            fieldClass,
            'absolute inset-0 resize-none border-0 bg-transparent text-transparent caret-foreground outline-none',
            'selection:bg-emerald-500/30',
            dropping && 'pointer-events-none',
          )}
        />
      </div>

      {query != null ? (
        <div className="grid gap-2" role="listbox" aria-label="Pieces">
          <p className="text-xs text-muted-foreground">
            {matches.length === 0
              ? `No piece called ${query}.`
              : query === ''
                ? 'Add a piece. Enter puts the highlighted one in.'
                : 'Matching pieces. Enter puts the highlighted one in.'}
          </p>
          {matches.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {matches.map((token, index) => (
                <button
                  key={token}
                  type="button"
                  role="option"
                  aria-selected={index === safeActive}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-sm',
                    index === safeActive
                      ? 'border-emerald-400/60 bg-emerald-500/15'
                      : 'border-border/80 hover:bg-muted/40',
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(token)}
                >
                  <TokenMark text={`{${token}}`} padded />
                  <span className="ml-1.5 text-muted-foreground">{wordingTokenLabel(token)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {props.children}

      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Add a piece. Click one, or drag it into the message.
        </p>
        <div className="flex flex-wrap gap-2">
          {props.pieces.map((piece) => {
            const present = props.value.includes(`{${piece.token}}`);
            return (
              <button
                key={piece.token}
                type="button"
                draggable
                onDragStart={(event) => onDragStart(event, piece.token)}
                onDragEnd={() => {
                  dragToken.current = null;
                  setDropping(false);
                }}
                onClick={() => insert(piece.token)}
                className={cn(
                  'cursor-grab rounded-full border px-2.5 py-1 text-sm active:cursor-grabbing',
                  present
                    ? 'border-border/80 bg-card/80'
                    : piece.required
                      ? 'border-emerald-400/70 bg-emerald-500/10 ring-2 ring-emerald-400/40'
                      : 'border-dashed border-border',
                )}
              >
                <TokenMark text={`{${piece.token}}`} padded />
                <span className="ml-1.5 text-muted-foreground">
                  {wordingTokenLabel(piece.token)}
                  {piece.required ? '' : ' · optional'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
