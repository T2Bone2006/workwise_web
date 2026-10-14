import { Tag } from '@/components/look';

/** "Added by Dave": a customer a member of staff added that the owner hasn't looked at yet. */
export function AddedByTag({ name, className }: { name: string; className?: string }) {
  const first = name.trim().split(/\s+/)[0] || name;
  return (
    <Tag tone="amber" className={className}>
      Added by {first}
    </Tag>
  );
}
