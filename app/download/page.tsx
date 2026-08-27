import Image from 'next/image';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
} from '@/lib/app-stores';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Download WorkWise | WorkWise',
  description: 'Download the WorkWise app for iPhone or Android.',
};

function storeUrlFromUserAgent(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return APP_STORE_URL;
  }
  if (/Android/i.test(userAgent)) {
    return PLAY_STORE_URL;
  }
  return null;
}

export default async function DownloadPage() {
  const userAgent = (await headers()).get('user-agent') ?? '';
  const mobileStoreUrl = storeUrlFromUserAgent(userAgent);
  if (mobileStoreUrl) {
    redirect(mobileStoreUrl);
  }

  return (
    <Card className="glass-card backdrop-blur-xl border-white/10 transition-all duration-300 dark:backdrop-blur-2xl dark:border-white/[0.06]">
      <CardHeader className="space-y-1 text-center">
        <div className="mb-6 flex justify-center">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={120}
            height={120}
            className="h-auto w-[120px] object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Get the WorkWise app
        </CardTitle>
        <CardDescription>
          Download WorkWise for Trades on your phone, then sign in with the email
          and password from your invite.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button variant="gradient" className="w-full" asChild>
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
            Download on the App Store
          </a>
        </Button>
        <Button variant="outline" className="w-full" asChild>
          <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
            Get it on Google Play
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
