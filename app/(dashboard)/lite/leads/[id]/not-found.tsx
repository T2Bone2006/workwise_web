import Link from 'next/link';
import { litePaths } from '@/lib/navigation/lite-paths';

export default function LeadNotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">That lead could not be found.</h1>
      <Link href={litePaths.leads} className="text-sm font-medium">
        Leads
      </Link>
    </div>
  );
}
