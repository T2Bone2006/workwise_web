import { Card, CardContent } from '@/components/ui/card';

export default function AccountantLinkNotFound() {
  return (
    <div className="mx-auto w-full max-w-md py-16">
      <Card>
        <CardContent className="text-center text-sm text-muted-foreground">
          This link no longer works. Ask the business that invited you to send a new one.
        </CardContent>
      </Card>
    </div>
  );
}
