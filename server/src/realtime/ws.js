const { WebSocketServer } = require('ws');
const url = require('url');

// Clients subscribe to a specific event's seat map by connecting to /ws?eventId=123
// Rooms are kept in-memory (single-process). Good enough for one Render/Railway instance;
// for horizontal scaling this would move to a pub/sub layer (e.g. Redis).
const rooms = new Map(); // eventId -> Set<ws>

function attachWebsocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const { query } = url.parse(req.url, true);
    const eventId = String(query.eventId || '');
    if (!eventId) {
      ws.close(1008, 'eventId query param required');
      return;
    }
    if (!rooms.has(eventId)) rooms.set(eventId, new Set());
    rooms.get(eventId).add(ws);

    ws.on('close', () => {
      rooms.get(eventId)?.delete(ws);
    });
  });

  return wss;
}

// Broadcast a seat-status change to everyone watching this event's seat map.
function broadcastSeatUpdate(eventId, seats) {
  const room = rooms.get(String(eventId));
  if (!room) return;
  const message = JSON.stringify({ type: 'seat_update', seats });
  for (const client of room) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

module.exports = { attachWebsocketServer, broadcastSeatUpdate };
