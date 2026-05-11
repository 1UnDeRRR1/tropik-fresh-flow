import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { createRouter, Link, useRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { translateError } from "@/lib/mutation-helpers";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const message = translateError(error);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">Щось пішло не так</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Спробувати ще
        </button>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          На головну
        </Link>
      </div>
    </div>
  );
}

function DefaultNotFoundComponent() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">Сторінку не знайдено</h2>
      <p className="mt-2 text-sm text-muted-foreground">Перевірте адресу або поверніться на головну.</p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        На головну
      </Link>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Keep last valid data visible during refetch / queryKey transitions
        // (e.g. when auth token refreshes and user.id briefly flips).
        placeholderData: keepPreviousData,
        // Treat data as fresh for 30s — avoids aggressive background refetches
        // that briefly render empty states on focus / network reconnect.
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        // Don't wipe-and-refetch on every tab focus; rely on realtime + manual invalidation.
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: DefaultNotFoundComponent,
  });

  return router;
};
