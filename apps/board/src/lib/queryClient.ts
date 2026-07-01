import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Realtime patches the cache; this is just a safety net for missed events.
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

export const queryKeys = {
  tickets: (filter: string) => ["tickets", filter] as const,
  ticket: (id: string) => ["ticket", id] as const,
  worklog: (ticketId: string) => ["worklog", ticketId] as const,
  teams: ["teams"] as const,
  projects: ["projects"] as const,
  members: ["members"] as const,
  users: ["app_users"] as const,
};
