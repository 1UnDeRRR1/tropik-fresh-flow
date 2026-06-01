// Targeted realtime → query invalidation. Mount once per screen with the
// list of Postgres tables to listen on and the QueryKey prefixes to
// invalidate. No business logic, no schema/RLS changes — pure UI freshness.

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeInvalidate(
  channelName: string,
  tables: string[],
  queryKeys: QueryKey[],
  enabled: boolean = true,
) {
  const qc = useQueryClient();
  // Serialize keys for stable dep tracking without referential issues.
  const keysSig = JSON.stringify(queryKeys);
  const tablesSig = tables.join(",");
  useEffect(() => {
    if (!enabled || tables.length === 0) return;
    let channel = supabase.channel(channelName);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          for (const key of queryKeys) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, channelName, tablesSig, keysSig, enabled]);
}
