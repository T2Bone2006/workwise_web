import Link from 'next/link';
import { Briefcase, TriangleAlert } from 'lucide-react';
import { LookCard, Notice } from '@/components/look';
import { LiteOfferSlot } from '@/components/worker/lite-offer-slot';
import { ProfileActions } from '@/components/worker/profile-actions';
import { ProfileDetails, ProfileHeader, ProfileStats } from '@/components/worker/profile-card';
import { RoundsPhoneNote } from '@/components/worker/rounds-phone-note';
import { getMyProfile } from '@/lib/data/worker/profile';
import { getWorkerRoundsExtras } from '@/lib/data/worker/rounds-extras';

export default async function WorkerProfilePage() {
  const [profile, extras] = await Promise.all([getMyProfile(), getWorkerRoundsExtras()]);
  if (!profile) {
    return (
      <Notice tone="amber" icon={TriangleAlert} title="Couldn't load your profile">
        Refresh the page to try again.
      </Notice>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      <ProfileHeader profile={profile} />
      <ProfileStats profile={profile} />
      <ProfileDetails profile={profile} />
      {extras.employerIsRounds ? <RoundsPhoneNote /> : null}
      {profile.hasOwnBusiness ? (
        <LookCard title="Your own business" icon={Briefcase} tone="lite">
          <p className="text-sm text-muted-foreground">
            You also have your own WorkWise account, separate from {profile.employerName}.{' '}
            <Link href="/settings" className="font-medium text-(--tone-rounds-text) underline-offset-4 hover:underline">
              Open settings
            </Link>
          </p>
        </LookCard>
      ) : null}
      <ProfileActions email={profile.email} />
      <LiteOfferSlot />
    </div>
  );
}
