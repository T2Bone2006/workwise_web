/** MET Norway's terms (CC BY 4.0) ask for a credit wherever their forecast is shown. Once per page. */
export function WeatherCredit({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-xs text-muted-foreground'}>
      Weather data from{' '}
      <a
        href="https://www.met.no/en"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        MET Norway
      </a>
    </p>
  );
}
