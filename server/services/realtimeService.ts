import { Response } from 'express';

export interface SSEClient {
  id: string;
  userId?: string;
  role?: string;
  res: Response;
}

const clients = new Set<SSEClient>();

// Send SSE heartbeat every 20 seconds to keep connection alive through proxies
setInterval(() => {
  for (const client of clients) {
    try {
      client.res.write(': heartbeat\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 20000);

export const realtimeService = {
  addClient(client: SSEClient) {
    clients.add(client);
    client.res.write(`data: ${JSON.stringify({ type: 'connected', event: 'connected', clientId: client.id, timestamp: new Date().toISOString() })}\n\n`);

    client.res.on('close', () => {
      clients.delete(client);
    });
  },

  removeClient(clientId: string) {
    for (const c of clients) {
      if (c.id === clientId) {
        clients.delete(c);
        break;
      }
    }
  },

  broadcastToAll(event: string, payload: any) {
    const data = JSON.stringify({ type: event, event, payload, timestamp: new Date().toISOString() });
    for (const client of clients) {
      try {
        client.res.write(`event: ${event}\ndata: ${data}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  },

  broadcastToStaff(event: string, payload: any) {
    const data = JSON.stringify({ type: event, event, payload, timestamp: new Date().toISOString() });
    for (const client of clients) {
      if (client.role === 'admin' || client.role === 'pharmacist' || client.role === 'staff' || client.role === 'super_admin') {
        try {
          client.res.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
          clients.delete(client);
        }
      }
    }
  },

  broadcastToUser(userId: string, event: string, payload: any) {
    const data = JSON.stringify({ type: event, event, payload, timestamp: new Date().toISOString() });
    for (const client of clients) {
      if (client.userId === userId) {
        try {
          client.res.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
          clients.delete(client);
        }
      }
    }
  },

  getActiveClientCount(): number {
    return clients.size;
  }
};
