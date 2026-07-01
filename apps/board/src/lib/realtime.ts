import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { COLLECTIONS } from "@miniboss/shared";
import { pb } from "./pb.ts";

/**
 * Subscribe to ticket and worklog changes and refresh the relevant queries.
 * PocketBase realtime (SSE) is governed by the collections' listRule, so only
 * authenticated clients receive events. We invalidate rather than hand-patch to
 * keep relation expansions consistent; queries are cheap and indexed.
 */
export function useBoardRealtime(queryClient: QueryClient): void {
  useEffect(() => {
    if (!pb.authStore.isValid) return;
    let active = true;

    const unsubscribers: Array<() => void> = [];

    void pb
      .collection(COLLECTIONS.tickets)
      .subscribe("*", () => {
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
        queryClient.invalidateQueries({ queryKey: ["ticket"] });
      })
      .then((unsub) => {
        if (active) unsubscribers.push(unsub);
        else void unsub();
      });

    void pb
      .collection(COLLECTIONS.worklog)
      .subscribe("*", (e) => {
        const ticketId = (e.record as { ticket?: string }).ticket;
        if (ticketId) queryClient.invalidateQueries({ queryKey: ["worklog", ticketId] });
      })
      .then((unsub) => {
        if (active) unsubscribers.push(unsub);
        else void unsub();
      });

    return () => {
      active = false;
      for (const unsub of unsubscribers) unsub();
    };
  }, [queryClient]);
}
