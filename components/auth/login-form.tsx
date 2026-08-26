'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { login } from '@/lib/actions/auth';
import {
  WORKER_WEB_LOGIN_ERROR,
  WORKER_WEB_LOGIN_ERROR_PARAM,
} from '@/lib/auth/worker-web-access';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

const initialState = {
  success: true as boolean,
  error: undefined as string | undefined,
  attemptedAt: undefined as number | undefined,
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, isPending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (searchParams.get('error') === WORKER_WEB_LOGIN_ERROR_PARAM) {
      toast.error(WORKER_WEB_LOGIN_ERROR);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!state.success && state.error) {
      toast.error(state.error);
    }
  }, [state.success, state.error, state.attemptedAt]);

  return (
    <Form {...form}>
      <form action={formAction} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={isPending}
                  {...field}
                />
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
                    placeholder="••••••••"
                    autoComplete="current-password"
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
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </FormItem>
          )}
        />
        <Button
          type="submit"
          variant="gradient"
          className="w-full"
          disabled={isPending}
        >
          {isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Form>
  );
}
