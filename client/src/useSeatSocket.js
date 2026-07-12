import { useEffect, useRef } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

// Subscribes to live seat-status updates for one event and calls onUpdate(seats) whenever
// the server pushes a change (someone else's hold, release, booking, or waitlist offer).
export function useSeatSocket(eventId, onUpdate) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!eventId) return undefined;
    const ws = new WebSocket(`${WS_URL}/ws?eventId=${eventId}`);
    socketRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'seat_update') onUpdate(data.seats);
      } catch {
        // ignore malformed frames
      }
    };

    return () => ws.close();
  }, [eventId, onUpdate]);
}
