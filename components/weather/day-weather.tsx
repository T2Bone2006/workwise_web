import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Snowflake,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayWeather as DayWeatherData, WeatherSymbol } from '@/lib/weather/met-norway';

const ICONS: Record<WeatherSymbol, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  heavy_rain: CloudRainWind,
  sleet: CloudSnow,
  snow: Snowflake,
  thunder: CloudLightning,
};

/** Symbols whose plain-words label already says it's wet, so "Rain likely" would repeat it. */
const WET_SYMBOLS: WeatherSymbol[] = ['drizzle', 'rain', 'heavy_rain', 'thunder', 'sleet', 'snow'];

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** "Thursday: light rain, high 14 degrees, 2.4 mm of rain" */
export function weatherAriaLabel(w: DayWeatherData): string {
  const day = weekday.format(new Date(`${w.date}T12:00:00Z`));
  const rain = w.wet ? `, ${w.rainMm} mm of rain` : '';
  return `${day}: ${w.label.toLowerCase()}, high ${w.highC} degrees${rain}`;
}

/**
 * One day's weather: an icon and the high. On a wet working day it also says
 * "Rain likely" in words, so the warning never rests on colour alone.
 */
export function DayWeather({
  weather,
  showLabel = false,
  className,
}: {
  weather: DayWeatherData;
  /** Also show the plain-words summary ("Light rain") after the high. */
  showLabel?: boolean;
  className?: string;
}) {
  const Icon = ICONS[weather.symbol];
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      role="img"
      aria-label={weatherAriaLabel(weather)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">
        {weather.highC}°{showLabel ? ` ${weather.label}` : ''}
      </span>
      {weather.wet && !(showLabel && WET_SYMBOLS.includes(weather.symbol)) ? (
        <span aria-hidden="true" className="font-medium text-sky-700 dark:text-sky-300 [[data-look=new]_&]:text-(--tone-amber-text)">
          · Rain likely
        </span>
      ) : null}
    </span>
  );
}

/** Today's weather for a page header: a large icon, the plain-words summary and the rain flag. */
export function WeatherNow({ weather }: { weather: DayWeatherData }) {
  const Icon = ICONS[weather.symbol];
  return (
    <div className="flex items-center gap-2" role="img" aria-label={weatherAriaLabel(weather)}>
      <Icon className="size-7 text-sky-600 dark:text-sky-300" aria-hidden="true" />
      <div aria-hidden="true">
        <p className="text-sm font-medium leading-tight">{weather.label}</p>
        <p className={cn('text-xs', weather.wet ? 'font-medium text-sky-700 dark:text-sky-300 [[data-look=new]_&]:text-(--tone-amber-text)' : 'text-muted-foreground')}>
          {weather.wet ? `Rain likely · ${weather.rainMm} mm` : 'Dry for the working day'}
        </p>
      </div>
    </div>
  );
}
