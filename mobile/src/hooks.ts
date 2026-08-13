import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchOrders,
  fetchPerformance,
  fetchPositions,
  fetchStatus,
} from "./api";
import { useSession } from "./session";

export function useDeskQueries() {
  const { mode, ready, needsLogin } = useSession();
  const enabled = ready && !needsLogin;

  const statusQ = useQuery({
    queryKey: ["status", mode],
    queryFn: fetchStatus,
    enabled,
    refetchInterval: (q) =>
      q.state.data?.job?.status === "running" ? 1500 : 15_000,
  });

  const ordersQ = useQuery({
    queryKey: ["orders", mode],
    queryFn: fetchOrders,
    enabled,
    refetchInterval: 30_000,
  });

  const positionsQ = useQuery({
    queryKey: ["positions", mode],
    queryFn: fetchPositions,
    enabled,
    refetchInterval: 30_000,
  });

  const perfQ = useQuery({
    queryKey: ["performance", mode],
    queryFn: fetchPerformance,
    enabled,
    refetchInterval: 60_000,
  });

  return { statusQ, ordersQ, positionsQ, perfQ };
}

export function useInvalidateDesk() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["status"] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["positions"] });
    void qc.invalidateQueries({ queryKey: ["performance"] });
  };
}
