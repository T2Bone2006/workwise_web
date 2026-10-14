'use client';

import { useRouter } from 'next/navigation';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PortalTenantOption {
  customerId: string;
  tenantName: string;
}

interface TenantSelectorProps {
  options: PortalTenantOption[];
  selectedCustomerId: string;
}

export function TenantSelector({ options, selectedCustomerId }: TenantSelectorProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="portal-tenant-select" className="text-xs font-medium text-muted-foreground">
        Provider
      </Label>
      <Select
        value={selectedCustomerId}
        onValueChange={(customerId) => {
          router.push(`/portal?tenant=${customerId}`);
        }}
      >
        <SelectTrigger id="portal-tenant-select" className="w-full sm:w-[240px]">
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.customerId} value={option.customerId}>
              {option.tenantName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
