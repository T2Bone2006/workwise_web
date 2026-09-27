import { Card, CardContent } from '@/components/ui/card';
import { PayPageFrame } from '@/components/pay/pay-shell';

export default function InvoiceLinkNotFound() {
  return (
    <PayPageFrame>
      <Card className="glass-card border-white/10 backdrop-blur-xl dark:border-white/[0.06] dark:backdrop-blur-2xl">
        <CardContent className="text-center text-sm text-muted-foreground">
          This invoice link isn&apos;t valid. Ask whoever sent it for a new one.
        </CardContent>
      </Card>
    </PayPageFrame>
  );
}
