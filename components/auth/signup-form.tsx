'use client';

import { useActionState, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { startSignup } from '@/lib/actions/signup';
import { signupSchema, type SignupInput } from '@/lib/validations/signup';

const initialState = {
  success: true as boolean,
  error: undefined as string | undefined,
  attemptedAt: undefined as number | undefined,
};

export function SignupForm({ product }: { product: 'rounds' | 'lite' }) {
  const [state, formAction, isPending] = useActionState(startSignup, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      product,
      businessName: '',
      fullName: '',
      email: '',
      password: '',
      phone: '',
      postcode: '',
      trade: '',
    },
  });

  useEffect(() => {
    if (!state.success && state.error) {
      toast.error(state.error);
    }
  }, [state.success, state.error, state.attemptedAt]);

  return (
    <Form {...form}>
      <form
        action={formAction}
        className="space-y-4"
        onSubmit={(e) => {
          // Validate against current values (sync). formState.isValid stays
          // false until the first validation, which would block a valid first click.
          const parsed = signupSchema.safeParse({ ...form.getValues(), product });
          if (!parsed.success) {
            e.preventDefault();
            void form.trigger();
          }
        }}
      >
        <input type="hidden" name="product" value={product} />

        <FormField
          control={form.control}
          name="businessName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business name</FormLabel>
              <FormControl>
                <Input placeholder="Dave's Window Cleaning" autoComplete="organization" disabled={isPending} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Your name</FormLabel>
              <FormControl>
                <Input placeholder="Dave Smith" autoComplete="name" disabled={isPending} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" autoComplete="email" disabled={isPending} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    disabled={isPending}
                    className="pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="07700 900000" autoComplete="tel" disabled={isPending} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="postcode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Home postcode</FormLabel>
                <FormControl>
                  <Input placeholder="SW1A 1AA" autoComplete="postal-code" disabled={isPending} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {product === 'lite' && (
          <FormField
            control={form.control}
            name="trade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>What do you do?</FormLabel>
                <FormControl>
                  <Input placeholder="Plumber, electrician, locksmith…" disabled={isPending} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Button type="submit" variant="gradient" className="w-full" disabled={isPending}>
          {isPending ? 'Taking you to checkout…' : 'Continue to payment'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          You&apos;ll add a card on the next screen. Nothing is charged until your trial ends.
        </p>
      </form>
    </Form>
  );
}
