import { useQuery } from "@tanstack/react-query";
import { COLLECTIONS } from "@miniboss/shared";
import { pb } from "../lib/pb.ts";
import { queryKeys } from "../lib/queryClient.ts";

export interface TeamRec {
  id: string;
  name: string;
  slug: string;
}
export interface ProjectRec {
  id: string;
  name: string;
  slug: string;
  team: string;
  repo_remote: string;
  default_branch: string;
}
export interface MemberRec {
  id: string;
  username: string;
  display_name: string;
  email_normalized: string;
  emails: string[];
  active: boolean;
}
export interface UserRec {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function useTeams() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => pb.collection(COLLECTIONS.teams).getFullList<TeamRec>({ sort: "name" }),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => pb.collection(COLLECTIONS.projects).getFullList<ProjectRec>({ sort: "name" }),
  });
}

export function useMembers() {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: () =>
      pb.collection(COLLECTIONS.members).getFullList<MemberRec>({ sort: "display_name" }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => pb.collection(COLLECTIONS.appUsers).getFullList<UserRec>({ sort: "name" }),
  });
}
