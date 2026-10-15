import Link from 'next/link';
import { Fragment } from 'react';

/*
 * Just enough Markdown for the assistant's replies: paragraphs, bullet and
 * numbered lists, **bold**, and links to pages inside WorkWise. Anything else
 * shows as plain text (React escapes it), so a reply can never inject markup.
 */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[^\s)]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${keyBase}-b${i}`} className="font-semibold">{m[1]}</strong>);
    else if (m[2] && m[3])
      out.push(
        <Link key={`${keyBase}-l${i}`} href={m[3]} className="font-medium text-(--tone-rounds-text) underline decoration-current/30 underline-offset-2 hover:decoration-current">
          {m[2]}
        </Link>,
      );
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Group =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; lines: string[] }
  | { kind: 'table'; lines: string[] }
  | { kind: 'h'; lines: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const TABLE = /^\s*\|/;

/** Splits an answer into paragraphs, lists, tables and headings, line by line, so any mix renders properly. */
export function groupLines(text: string): Group[] {
  const groups: Group[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      groups.push({ kind: 'p', lines: [] });
      continue;
    }
    const kind: Group['kind'] = TABLE.test(line) ? 'table' : BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : /^#{1,4}\s/.test(line) ? 'h' : 'p';
    const last = groups[groups.length - 1];
    if (last && last.kind === kind && kind !== 'h' && (kind !== 'p' || last.lines.length > 0)) last.lines.push(line);
    else groups.push({ kind, lines: [line] });
  }
  return groups.filter((g) => g.lines.length > 0);
}

export function MessageText({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed">
      {groupLines(text).map((g, gi) => {
        if (g.kind === 'table') {
          const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
          const rows = g.lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(cells);
          const [head, ...body] = rows;
          return (
            <div key={gi} className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>{head?.map((c, ci) => <th key={ci} className="px-3 py-2 font-medium">{inline(c, `${gi}-h${ci}`)}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {body.map((r, ri) => (
                    <tr key={ri}>{r.map((c, ci) => <td key={ci} className="px-3 py-2 tabular-nums">{inline(c, `${gi}-${ri}-${ci}`)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (g.kind === 'ul' || g.kind === 'ol') {
          const Tag = g.kind;
          return (
            <Tag key={gi} className={g.kind === 'ol' ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5 marker:text-muted-foreground'}>
              {g.lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${gi}-${li}`)}</li>
              ))}
            </Tag>
          );
        }
        if (g.kind === 'h') {
          return (
            <p key={gi} className="font-semibold">
              {inline(g.lines[0]!.replace(/^#{1,4}\s+/, ''), `${gi}`)}
            </p>
          );
        }
        return (
          <p key={gi}>
            {g.lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `${gi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
