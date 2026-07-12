import React, { useEffect, useState } from 'react';

export default function Countdown({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt) - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt) - Date.now());
      setRemaining(ms);
      if (ms === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const totalSeconds = Math.floor(remaining / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');

  return <span className="countdown">{mm}:{ss}</span>;
}
