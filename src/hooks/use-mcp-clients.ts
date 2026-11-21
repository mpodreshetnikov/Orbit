"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpConnectedClient, McpConnectedClientsResponse } from "@/types/mcp-clients";

export const MCP_CLIENTS_QUERY_KEY = ["mcp-clients"] as const;

async function fetchMcpClients(): Promise<McpConnectedClient[]> {
  const res = await fetch("/api/settings/mcp-clients");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to list MCP clients: ${res.status}`);
  }
  const body = (await res.json()) as McpConnectedClientsResponse;
  return body.clients ?? [];
}

async function revokeMcpClient(grantId: string): Promise<void> {
  const res = await fetch(`/api/settings/mcp-clients/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to revoke MCP client: ${res.status}`);
  }
}

export function useMcpClients() {
  return useQuery({
    queryKey: MCP_CLIENTS_QUERY_KEY,
    queryFn: fetchMcpClients,
  });
}

export function useRevokeMcpClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeMcpClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MCP_CLIENTS_QUERY_KEY });
    },
  });
}
