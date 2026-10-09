import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Map as MapIcon } from 'lucide-react';
import { EmptyState } from '@/components/look';
import { RoundsMapView } from '@/components/rounds/rounds-map-view';
import { Button } from '@/components/ui/button';
import { getRoundsMapData } from '@/lib/data/rounds/map';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';

function NoTenantMessage() {
  return (
    <div className="m-4 flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center sm:m-8">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

/** The map fills the whole page (no header, no side padding): see DashboardScroll. */
export default async function MapPage() {
  const [tenantId, products] = await Promise.all([getTenantIdForCurrentUser(), getTenantProducts()]);
  if (!products.hasRounds) redirect('/dashboard');
  if (!tenantId) return <NoTenantMessage />;

  const data = await getRoundsMapData(tenantId);

  if (data.error) {
    return (
      <p className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:m-8">
        {data.error} Refresh to try again.
      </p>
    );
  }

  if (data.places.length === 0) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Map</h1>
        <EmptyState
          icon={MapIcon}
          title="Your map fills in as you add customers"
          body="Each customer with a regular schedule and an address shows up here, with a heatmap of where your work is."
          action={
            <Button asChild>
              <Link href="/customers/new">Add customer</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <RoundsMapView places={data.places} rounds={data.rounds} unmappedCustomers={data.unmappedCustomers} notes={data.notes} />;
}
