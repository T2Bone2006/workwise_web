import { cn } from '@/lib/utils';

const BLUE = "#0C66E4";
const BLUE_LIGHT = "#2B7FF0";
const BLUE_DARK = "#0A4FB5";
const GOLD = "#F0A500";
const GOLD_LIGHT = "#F8C247";
const GOLD_DARK = "#C98A00";

/**
 * A gift box in the brand colours: blue box, yellow ribbon and bow. With `site`, a small one-page website
 * rises out of the top, so it's clear what the gift is. Same drawing as workwise_site `components/marketing/gift-box.tsx`.
 * `site={false}` is the simple box for small spots (the dashboard panel, the sidebar).
 */
export function GiftBox({ site = true, className }: { site?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 320 300"
      role="img"
      aria-label={site ? "A gift box with a website coming out of it" : "A gift box"}
      className={cn("h-auto w-full", className)}
    >
      <ellipse cx="160" cy="282" rx="104" ry="11" fill="#000" opacity="0.18" />

      {site ? (
        <g transform="rotate(-7 130 120)">
          {/* the website, rising out of the box */}
          <rect x="62" y="14" width="146" height="116" rx="10" fill="#FFFFFF" />
          <path d="M62 24a10 10 0 0 1 10-10h126a10 10 0 0 1 10 10v12H62z" fill="#E8EEF8" />
          <circle cx="76" cy="25" r="3.2" fill="#F26D6D" />
          <circle cx="87" cy="25" r="3.2" fill={GOLD} />
          <circle cx="98" cy="25" r="3.2" fill="#43C28B" />
          <rect x="112" y="20" width="80" height="10" rx="5" fill="#FFFFFF" />
          <rect x="76" y="48" width="74" height="9" rx="4.5" fill={BLUE} />
          <rect x="76" y="63" width="108" height="6" rx="3" fill="#C9D4E6" />
          <rect x="76" y="75" width="92" height="6" rx="3" fill="#C9D4E6" />
          <rect x="76" y="90" width="46" height="16" rx="8" fill={GOLD} />
          <rect x="150" y="84" width="44" height="30" rx="6" fill="#DCE8FB" />
        </g>
      ) : null}

      {/* box body */}
      <rect x="62" y="132" width="196" height="146" rx="14" fill={BLUE} />
      <rect x="62" y="248" width="196" height="30" rx="14" fill={BLUE_DARK} opacity="0.45" />
      {/* ribbon, wrapping the body */}
      <rect x="62" y="186" width="196" height="26" fill={GOLD} />
      <rect x="62" y="206" width="196" height="6" fill={GOLD_DARK} opacity="0.35" />
      <rect x="146" y="132" width="28" height="146" fill={GOLD} />
      <rect x="168" y="132" width="6" height="146" fill={GOLD_DARK} opacity="0.35" />

      {/* lid */}
      <rect x="50" y="104" width="220" height="42" rx="12" fill={BLUE_LIGHT} />
      <rect x="50" y="136" width="220" height="10" rx="5" fill={BLUE_DARK} opacity="0.35" />
      <rect x="146" y="104" width="28" height="42" fill={GOLD_LIGHT} />
      <rect x="168" y="104" width="6" height="42" fill={GOLD_DARK} opacity="0.3" />

      {/* bow */}
      <path d="M160 104C130 62 84 70 94 100c7 20 42 14 66 4z" fill={GOLD} />
      <path d="M160 104C190 62 236 70 226 100c-7 20-42 14-66 4z" fill={GOLD} />
      <path d="M160 104C140 84 114 86 118 98c4 10 26 8 42 6z" fill={GOLD_LIGHT} />
      <path d="M160 104C180 84 206 86 202 98c-4 10-26 8-42 6z" fill={GOLD_LIGHT} />
      <rect x="147" y="94" width="26" height="22" rx="8" fill={GOLD_DARK} />
      <rect x="150" y="96" width="20" height="14" rx="6" fill={GOLD_LIGHT} />

      {site ? (
        <g fill={GOLD}>
          <path d="M252 40l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" />
          <path d="M40 78l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" opacity="0.85" />
          <path d="M268 112l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="#FFFFFF" opacity="0.8" />
        </g>
      ) : null}
    </svg>
  );
}
