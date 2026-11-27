/** One live MCP connector grant, as settings shows it (no token material). */
export interface McpConnectedClient {
  grantId: string;
  clientId: string;
  clientName: string | null;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface McpConnectedClientsResponse {
  clients: McpConnectedClient[];
}
