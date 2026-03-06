import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DomainWarmingStatus {
  domain: string;
  domain_age_days: number;
  today_sent: number;
  recommended_limit: number;
  is_over_limit: boolean;
}

export function useDomainWarming() {
  const { organizationId } = useAuth();

  return useQuery<DomainWarmingStatus[]>({
    queryKey: ["domain-warming", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "check_domain_warming_status",
        { org_id: organizationId }
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 60000,
  });
}
