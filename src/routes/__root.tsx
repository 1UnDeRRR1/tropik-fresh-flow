import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
  Navigate,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
// PreviewRoleSwitcher removed — no Pilot/mock users in user-facing UI.
import { useEffect } from "react";
import { installGlobalErrorLogger, logSystem } from "@/lib/system-log";

function NotFoundComponent() {
  if (typeof window !== "undefined" && /^\/index\/?$/.test(window.location.pathname)) {
    return <Navigate to="/" />;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-black text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Сторінку не знайдено</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Сторінка, яку ви шукаєте, не існує або була переміщена.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            На головну
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  useEffect(() => {
    void logSystem({
      level: "critical",
      message: error.message,
      module: typeof window !== "undefined" ? window.location.pathname : "ssr",
      action: "route_error",
      context: { stack: error.stack?.slice(0, 2000) },
    });
  }, [error]);
  const router = useRouter();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Сторінка не завантажилась
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Спробувати ще
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            На головну
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { name: "theme-color", content: "#E89A5C" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: "TROPIK Import & Distribution" },
      {
        name: "description",
        content:
          "Внутрішня система TROPIK для управління імпортом і розподілом фруктів та овочів",
      },
      { property: "og:title", content: "TROPIK Import & Distribution" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "TROPIK Import & Distribution" },
      { name: "description", content: "Internal web/PWA for fruit and vegetable import distribution management." },
      { property: "og:description", content: "Internal web/PWA for fruit and vegetable import distribution management." },
      { name: "twitter:description", content: "Internal web/PWA for fruit and vegetable import distribution management." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/805976f7-23db-4ab0-a216-6b4a0201ea18/id-preview-0f5b11be--1e88bdf2-4c3c-407d-937e-c134ac58990b.lovable.app-1778646625470.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/805976f7-23db-4ab0-a216-6b4a0201ea18/id-preview-0f5b11be--1e88bdf2-4c3c-407d-937e-c134ac58990b.lovable.app-1778646625470.png" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "x-tropik-build-version",
        content: import.meta.env.VITE_APP_VERSION ?? "unknown",
      },
      {
        name: "x-tropik-build-time",
        content: import.meta.env.VITE_BUILD_TIME ?? "",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // No-flash inline script: applies the persisted/system theme before paint.
  const noFlash = `(function(){try{var k='tropik.theme';var s=localStorage.getItem(k);var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;if(t==='dark')r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=t;}catch(e){}})();`;
  return (
    <html lang="uk">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installGlobalErrorLogger();
    console.info(
      "[tropik] build",
      import.meta.env.VITE_APP_VERSION ?? "unknown",
      import.meta.env.VITE_BUILD_TIME ?? "",
    );
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Outlet />
          {/* PreviewRoleSwitcher removed */}
          <Toaster position="top-center" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
