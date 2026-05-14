import { cn } from '@/lib/utils';

interface PageGradientHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export function PageGradientHeader({
  title,
  subtitle,
  className,
}: PageGradientHeaderProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 px-5 py-4 text-white shadow-md',
        className
      )}
    >
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-blue-50">{subtitle}</p> : null}
    </div>
  );
}
