import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { logSystem } from "@/lib/system-log";

type StableQueryOptions<T> = {
  data: T | undefined;
  isSuccess: boolean;
  isFetching: boolean;
  isError: boolean;
  module: string;
  countRows: (data: T) => number;
  zeroConfirmMs?: number;
};

type StableQueryResult<T> = {
  data: T | undefined;
  authReady: boolean;
  isHoldingPrevious: boolean;
  showEmpty: boolean;
};

export function useStableQueryData<T>({
  data,
  isSuccess,
  isFetching,
  isError,
  module,
  countRows,
  zeroConfirmMs = 4000,
}: StableQueryOptions<T>): StableQueryResult<T> {
  const { user, loading, dataLoaded, primaryRole } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const authReady = !loading && !!user && dataLoaded;
  const [stableData, setStableData] = useState<T | undefined>(data);
  const lastAcceptedRef = useRef<T | undefined>(data);
  const zeroSinceRef = useRef<number | null>(null);
  const zeroLoggedRef = useRef(false);

  useEffect(() => {
    if (!authReady || isError || !isSuccess || data === undefined) return;

    const nextCount = countRows(data);
    const prevCount = lastAcceptedRef.current ? countRows(lastAcceptedRef.current) : 0;

    if (nextCount > 0) {
      lastAcceptedRef.current = data;
      setStableData(data);
      zeroSinceRef.current = null;
      zeroLoggedRef.current = false;
      return;
    }

    if (prevCount > 0) {
      if (!zeroSinceRef.current) {
        zeroSinceRef.current = Date.now();
      }

      if (!zeroLoggedRef.current) {
        zeroLoggedRef.current = true;
        void logSystem({
          level: "warning",
          message: "Suppressed transient zero-row overwrite and kept previous data",
          module,
          action: "query_zero_guard",
          context: {
            page: pathname,
            user_id: user?.id ?? null,
            role: primaryRole,
            previous_row_count: prevCount,
            new_row_count: 0,
            query_status: isError ? "error" : isFetching ? "loading" : "success",
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (isFetching || Date.now() - zeroSinceRef.current < zeroConfirmMs) {
        return;
      }
    }

    lastAcceptedRef.current = data;
    setStableData(data);
  }, [authReady, countRows, data, isError, isFetching, isSuccess, module, pathname, primaryRole, user?.id, zeroConfirmMs]);

  const resolvedData = useMemo(() => stableData ?? data, [data, stableData]);
  const resolvedCount = resolvedData === undefined ? 0 : countRows(resolvedData);
  const currentCount = data === undefined ? 0 : countRows(data);

  return {
    data: resolvedData,
    authReady,
    isHoldingPrevious: !!stableData && currentCount === 0 && resolvedCount > 0,
    showEmpty: authReady && !isError && isSuccess && !isFetching && resolvedData !== undefined && resolvedCount === 0,
  };
}

export function unwrapSupabaseResult<T>(
  result: { data: T | null; error: { message: string } | null },
  label?: string,
): T | null {
  if (result.error) {
    throw new Error(label ? `${label}: ${result.error.message}` : result.error.message);
  }

  return result.data ?? null;
}