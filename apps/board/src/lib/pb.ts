import PocketBase from "pocketbase";
import { MANAGER_ROLES, type UserRole } from "@miniboss/shared";

/**
 * Single PocketBase client for the SPA. Same-origin base URL works in dev
 * (Vite proxy → 127.0.0.1:8090) and prod (PocketBase serves the SPA).
 * authStore persists to localStorage by default.
 */
export const pb = new PocketBase(import.meta.env.VITE_PB_URL ?? "/");
pb.autoCancellation(false);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export function currentUser(): AuthUser | null {
  const record = pb.authStore.record;
  if (!record) return null;
  return {
    id: record.id,
    name: (record.name as string) ?? record.email ?? "",
    email: (record.email as string) ?? "",
    role: (record.role as UserRole) ?? "viewer",
  };
}

export function isManager(): boolean {
  const user = currentUser();
  return user !== null && MANAGER_ROLES.includes(user.role);
}

export function isAuthenticated(): boolean {
  return pb.authStore.isValid;
}

export async function login(email: string, password: string): Promise<void> {
  await pb.collection("app_users").authWithPassword(email, password);
}

export function logout(): void {
  pb.authStore.clear();
}
