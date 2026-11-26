import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { ThemeProvider, useTheme } from '@/features/theme/theme-context';
import { ApiError } from '@/lib/api-client';
import { useLiveJobUpdates } from '@/lib/live-updates';

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    // Reload when the person comes back to the tab or app, so a screen left open does not show old statuses.
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
  mutationCache: new MutationCache({
    // 409 = the job changed since this screen loaded it (someone else acted first). Show the current state at once.
    onError: (error) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.info('The screen has been updated with the latest status. Check it and try again if needed.', { id: 'stale-refresh' });
    },
  }),
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <LiveJobUpdates />
          {children}
        </AuthProvider>
        <ThemedToaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function LiveJobUpdates() {
  useLiveJobUpdates(!!useAuth().user);
  return null;
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-right" theme={theme.mode} richColors closeButton />;
}
