import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PayPageFrame } from '@/components/pay/pay-shell';

export function ConnectCard(props: { title: string; children: ReactNode }) {
  return (
    <PayPageFrame>
      <Card className="glass-card border-white/10 backdrop-blur-xl dark:border-white/[0.06] dark:backdrop-blur-2xl">
        <CardHeader>
          <p className="text-center text-xl font-semibold tracking-tight">{props.title}</p>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
          {props.children}
        </CardContent>
      </Card>
    </PayPageFrame>
  );
}
