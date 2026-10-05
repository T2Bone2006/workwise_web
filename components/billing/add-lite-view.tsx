"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/look/tag";
import { changePlanAction, hasLiteNowAction } from "@/lib/actions/billing";
import { formatPence, PLANS, type BillingInterval } from "@/lib/billing/plans";
import { PhoneScene, RoundScene, WebsiteScene } from "./add-lite-scenes";

export type AddLiteOffer = {
  todayPence: number;
  thenLabel: string;
  effectiveDate: string;
  interval: BillingInterval;
  foundingLine: string | null;
  nonce: string;
};

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STAGES = [
  {
    title: "It answers on your website",
    text: "Day and night, pricing jobs the way you do.",
    scene: WebsiteScene,
  },
  {
    title: "You accept in one tap",
    text: "Customers can book in. You say yes from your phone.",
    scene: PhoneScene,
  },
  {
    title: "It lands on your round",
    text: "Won jobs arrive as a customer or a one-off visit.",
    scene: RoundScene,
  },
] as const;

export function AddLiteView({
  offer,
  loadError,
}: {
  offer: AddLiteOffer | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "ready" | "paying" | "turning" | "slow" | "bank"
  >("ready");
  const [error, setError] = useState<string | null>(loadError);
  const [bankUrl, setBankUrl] = useState<string | null>(null);
  const busy = useRef(false);

  const add = async () => {
    if (!offer || busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("paying");
    const result = await changePlanAction(
      { plan: "both", interval: offer.interval },
      offer.todayPence,
      offer.nonce,
    );
    if (!result.ok) {
      busy.current = false;
      setError(result.error);
      setPhase("ready");
      return;
    }
    if ("needsAction" in result) {
      setBankUrl(result.needsAction.hostedInvoiceUrl);
      setPhase("bank");
      return;
    }
    setPhase("turning");
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await hasLiteNowAction()) {
        toast("Lite added. Let's teach it how you price.");
        router.push("/lite/setup");
        return;
      }
      await sleep(1500);
    }
    setPhase("slow");
  };

  const per = offer?.interval === "year" ? "year" : "month";
  const aloneNow = PLANS.lite.pence[per];
  const addOnNow = PLANS.both.pence[per] - PLANS.rounds.pence[per];
  const saving = aloneNow - addOnNow;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <section className="overflow-hidden rounded-3xl border border-(--tone-lite-line) bg-(--tone-lite-soft) p-5 sm:p-7">
        <Tag tone="lite">
          <MessageCircle className="size-3" aria-hidden />
          Lite
        </Tag>
        <h1 className="mt-3 max-w-[22ch] text-[1.9rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.25rem]">
          Win the work as well as run it
        </h1>
        <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-muted-foreground">
          Rounds runs the jobs you have. Lite brings in the next ones: it talks
          to customers on your website, quotes in your prices and puts what you
          win straight onto your round.
        </p>

        <ol className="mt-7 grid gap-3 lg:grid-cols-3 lg:gap-5">
          {STAGES.map((stage, i) => {
            const Scene = stage.scene;
            return (
              <li
                key={stage.title}
                className="relative flex flex-col rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-(--look-card-shadow)"
              >
                <div className="flex min-h-[200px] flex-1 items-center justify-center rounded-xl bg-muted/40 p-3">
                  <div className="w-full max-w-[300px]">
                    <Scene />
                  </div>
                </div>
                <div className="flex items-start gap-2 px-1 pt-3 pb-1">
                  <span
                    className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-(--look-lite-pill) text-[11px] font-semibold text-white"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="text-[14px] leading-snug font-semibold">
                      {stage.title}
                    </h2>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                      {stage.text}
                    </p>
                  </div>
                </div>
                {i < STAGES.length - 1 ? (
                  <span
                    className="absolute top-[88px] -right-[14px] z-10 hidden size-6 items-center justify-center rounded-full border border-(--tone-lite-line) bg-card text-(--tone-lite-text) lg:flex"
                    aria-hidden
                  >
                    <ChevronRight className="size-3.5" />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="grid gap-6 rounded-3xl border border-border bg-card p-5 text-card-foreground shadow-(--look-card-shadow) sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div>
          {offer ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">
                Pay today
              </p>
              <p className="mt-1 text-[2.75rem] leading-none font-semibold tracking-tight tabular-nums">
                {formatPence(offer.todayPence)}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                Just the difference for the rest of this {per}.
              </p>

              <dl className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-muted-foreground">Now</dt>
                  <dd className="text-right">
                    <span className="font-medium">Rounds</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {formatPence(PLANS.rounds.pence[per])} a {per}
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 bg-(--tone-lite-soft) px-3.5 py-2.5">
                  <dt className="text-(--tone-lite-text)">
                    From {formatDay(offer.effectiveDate)}
                  </dt>
                  <dd className="text-right">
                    <span className="font-semibold">Rounds + Lite</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {offer.thenLabel}
                    </span>
                  </dd>
                </div>
              </dl>
              {offer.foundingLine ? (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  {offer.foundingLine}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm font-medium">Add Lite</p>
          )}
        </div>

        <div className="flex flex-col">
          {offer ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Tag tone="emerald" className="px-3 py-1 text-sm">
                You save {formatPence(saving)} a {per}
              </Tag>
              <p className="text-[13px] text-muted-foreground">
                Lite alone is {formatPence(aloneNow)}. Added to Rounds it&apos;s{" "}
                {formatPence(addOnNow)}.
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {phase === "turning" ? (
            <p className="mt-5 flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Turning on Lite…
            </p>
          ) : null}

          {phase === "bank" && bankUrl ? (
            <div className="mt-5 space-y-2 text-sm">
              <p>Your bank wants to confirm this payment.</p>
              <a
                href={bankUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-(--tone-lite-text) underline underline-offset-4"
              >
                Confirm with your bank
              </a>
              <p className="text-muted-foreground">
                Lite turns on as soon as it&apos;s paid.
              </p>
            </div>
          ) : null}

          {phase === "slow" ? (
            <div className="mt-5 space-y-3 text-sm">
              <p>Lite is on its way; it can take a minute.</p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/lite/setup">Go to Lite</Link>
              </Button>
            </div>
          ) : null}

          {offer && (phase === "ready" || phase === "paying") ? (
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-(--look-lite-pill) text-[15px] font-semibold text-white hover:bg-(--look-lite-pill)/90"
              disabled={phase === "paying"}
              onClick={() => void add()}
            >
              {phase === "paying" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Add Lite for {formatPence(offer.todayPence)}
            </Button>
          ) : null}

          <ul className="mt-5 flex flex-col gap-2.5 text-[13px] leading-snug text-muted-foreground">
            <li className="flex gap-2">
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-(--tone-lite-text)"
                aria-hidden
              />
              Next you chat with it for a few minutes so it learns how you
              price.
            </li>
            <li className="flex gap-2">
              <Check
                className="mt-0.5 size-3.5 shrink-0 text-(--tone-lite-text)"
                aria-hidden
              />
              Change your mind? Drop Lite any time from Plan &amp; billing. It
              switches off at your next renewal.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
