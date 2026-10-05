/**
 * Colour by meaning for the new look (Phase 7b, T4). A colour never means
 * two things. Each tone's values are CSS variables set in app/globals.css
 * under [data-look="new"], so light and dark come from one place.
 *
 * Ported from the phone's tones (workwise-mobile/src/components/kit) and the
 * site's AppTone (workwise_site/components/renderings/app-kit.tsx).
 */
export type Tone =
  | 'sky'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'indigo'
  | 'teal'
  | 'violet'
  | 'rounds'
  | 'lite'
  | 'slate';

export const TONE_MEANING: Record<Tone, string> = {
  sky: 'today',
  emerald: 'money in / free / done',
  rose: 'owed / out / failed',
  amber: 'needs attention',
  indigo: 'the week',
  teal: 'capacity / room',
  violet: 'receipts and books',
  rounds: 'Rounds actions',
  lite: 'Lite actions',
  slate: 'neutral',
};

export type ToneClasses = {
  /** Soft tile with the tone's ink: tags and icon chips. */
  chip: string;
  /** Ink only, for small text and links. */
  text: string;
  /** Big figures: the vivid solid colour the site's drawings use (green #059669, red #E11D48, blue #0C66E4). */
  figure: string;
  /** Soft background only. */
  soft: string;
  /** Solid fill: bars, dots, the active nav pill. */
  solid: string;
  /** Tone border (the pale line). */
  border: string;
  /** Strong tone border, for the selected one of a row. */
  edge: string;
};

/** Full class strings so Tailwind keeps them. */
const CLASSES: Record<Tone, ToneClasses> = {
  sky: {
    chip: 'bg-(--tone-sky-soft) text-(--tone-sky-text)',
    text: 'text-(--tone-sky-text)',
    figure: 'text-(--tone-sky-solid)',
    soft: 'bg-(--tone-sky-soft)',
    solid: 'bg-(--tone-sky-solid)',
    border: 'border-(--tone-sky-line)',
    edge: 'border-(--tone-sky-solid)',
  },
  emerald: {
    chip: 'bg-(--tone-emerald-soft) text-(--tone-emerald-text)',
    text: 'text-(--tone-emerald-text)',
    figure: 'text-(--tone-emerald-solid)',
    soft: 'bg-(--tone-emerald-soft)',
    solid: 'bg-(--tone-emerald-solid)',
    border: 'border-(--tone-emerald-line)',
    edge: 'border-(--tone-emerald-solid)',
  },
  rose: {
    chip: 'bg-(--tone-rose-soft) text-(--tone-rose-text)',
    text: 'text-(--tone-rose-text)',
    figure: 'text-(--tone-rose-solid)',
    soft: 'bg-(--tone-rose-soft)',
    solid: 'bg-(--tone-rose-solid)',
    border: 'border-(--tone-rose-line)',
    edge: 'border-(--tone-rose-solid)',
  },
  amber: {
    chip: 'bg-(--tone-amber-soft) text-(--tone-amber-text)',
    text: 'text-(--tone-amber-text)',
    figure: 'text-(--tone-amber-text)',
    soft: 'bg-(--tone-amber-soft)',
    solid: 'bg-(--tone-amber-solid)',
    border: 'border-(--tone-amber-line)',
    edge: 'border-(--tone-amber-solid)',
  },
  indigo: {
    chip: 'bg-(--tone-indigo-soft) text-(--tone-indigo-text)',
    text: 'text-(--tone-indigo-text)',
    figure: 'text-(--tone-indigo-text)',
    soft: 'bg-(--tone-indigo-soft)',
    solid: 'bg-(--tone-indigo-solid)',
    border: 'border-(--tone-indigo-line)',
    edge: 'border-(--tone-indigo-solid)',
  },
  teal: {
    chip: 'bg-(--tone-teal-soft) text-(--tone-teal-text)',
    text: 'text-(--tone-teal-text)',
    figure: 'text-(--tone-teal-text)',
    soft: 'bg-(--tone-teal-soft)',
    solid: 'bg-(--tone-teal-solid)',
    border: 'border-(--tone-teal-line)',
    edge: 'border-(--tone-teal-solid)',
  },
  violet: {
    chip: 'bg-(--tone-violet-soft) text-(--tone-violet-text)',
    text: 'text-(--tone-violet-text)',
    figure: 'text-(--tone-violet-text)',
    soft: 'bg-(--tone-violet-soft)',
    solid: 'bg-(--tone-violet-solid)',
    border: 'border-(--tone-violet-line)',
    edge: 'border-(--tone-violet-solid)',
  },
  rounds: {
    chip: 'bg-(--tone-rounds-soft) text-(--tone-rounds-text)',
    text: 'text-(--tone-rounds-text)',
    figure: 'text-(--tone-rounds-solid)',
    soft: 'bg-(--tone-rounds-soft)',
    solid: 'bg-(--tone-rounds-solid)',
    border: 'border-(--tone-rounds-line)',
    edge: 'border-(--tone-rounds-solid)',
  },
  lite: {
    chip: 'bg-(--tone-lite-soft) text-(--tone-lite-text)',
    text: 'text-(--tone-lite-text)',
    figure: 'text-(--tone-lite-text)',
    soft: 'bg-(--tone-lite-soft)',
    solid: 'bg-(--tone-lite-solid)',
    border: 'border-(--tone-lite-line)',
    edge: 'border-(--tone-lite-solid)',
  },
  slate: {
    chip: 'bg-(--tone-slate-soft) text-(--tone-slate-text)',
    text: 'text-(--tone-slate-text)',
    figure: 'text-(--tone-slate-text)',
    soft: 'bg-(--tone-slate-soft)',
    solid: 'bg-(--tone-slate-solid)',
    border: 'border-(--tone-slate-line)',
    edge: 'border-(--tone-slate-solid)',
  },
};

export function toneClasses(tone: Tone): ToneClasses {
  return CLASSES[tone];
}
