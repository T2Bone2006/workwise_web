import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { LookCard } from '@/components/look';
import { Button } from '@/components/ui/button';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-stores';

/** For a lead: Done, Skip and cash are on the phone, with the two store links. */
export function RoundsPhoneNote() {
  return (
    <LookCard title="Install the app" icon={Smartphone} tone="sky">
      <p className="text-sm text-muted-foreground">Done, Skip and cash are on the phone. This page shows where you are up to.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
            App Store
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
            Google Play
          </Link>
        </Button>
      </div>
    </LookCard>
  );
}
