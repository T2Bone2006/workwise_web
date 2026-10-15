import { notFound } from 'next/navigation';
import Script from 'next/script';

type WidgetTestPageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function WidgetTestPage({ searchParams }: WidgetTestPageProps) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { id } = await searchParams;
  const widgetId = typeof id === 'string' ? id.trim() : '';
  const localhostOn = process.env.WIDGET_ALLOW_LOCALHOST === '1';

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 p-6">
      <h1 className="text-xl font-semibold text-foreground">Widget test (laptop only)</h1>
      <p className="text-sm text-muted-foreground">
        {localhostOn
          ? 'The chat bubble is in the bottom corner. This page does not put it on a customer website.'
          : 'The bubble stays hidden until WIDGET_ALLOW_LOCALHOST=1 is in .env.local and the app is restarted.'}
      </p>
      {widgetId ? (
        <Script src={`/widget.js?id=${encodeURIComponent(widgetId)}`} strategy="afterInteractive" />
      ) : (
        <form method="get" className="mt-2 flex max-w-sm flex-col gap-2">
          <label htmlFor="widget-id" className="text-sm font-medium text-foreground">
            Widget id
          </label>
          <input
            id="widget-id"
            name="id"
            required
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="w-fit rounded-md bg-foreground px-3 py-2 text-sm text-background"
          >
            Load
          </button>
        </form>
      )}
    </div>
  );
}
