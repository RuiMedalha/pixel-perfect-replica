import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  approved: boolean;
  created_at: string;
  roles: string[];
}

export function useUserProfiles() {
  return useQuery({
    queryKey: ["admin-user-profiles"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*");
      if (rolesError) throw rolesError;

      return (profiles || []).map((p) => ({
        ...p,
        roles: (roles || [])
          .filter((r) => r.user_id === p.user_id)
          .map((r) => r.role),
      })) as UserProfile[];
    },
  });
}

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ approved: approve })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      qc.invalidateQueries({ queryKey: ["admin-user-profiles"] });
      toast.success(approve ? "Utilizador aprovado!" : "Acesso revogado.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "user" }) => {
      // Remove existing roles first
      await supabase.from("user_roles").delete().eq("user_id", userId);
      // Insert new role
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-profiles"] });
      toast.success("Role atualizada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCurrentUserProfile() {
  return useQuery({
    queryKey: ["current-user-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      return {
        ...profile,
        roles: (roles || []).map((r) => r.role),
        isAdmin: (roles || []).some((r) => r.role === "admin"),
        isApproved: profile?.approved ?? false,
      };
    },
  });
}
