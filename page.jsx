
'use client';

import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

export default function Home() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    socket.emit('join-table', {
      tableId: 'main-room',
      username: 'Player'
    });

    socket.on('players-update', (data) => {
      setPlayers(data);
    });
  }, []);

  return (
    <main style={{padding:40}}>
      <h1>Poker Royale</h1>
      <h2>Players Online</h2>

      {players.map((p) => (
        <div key={p.id}>{p.username}</div>
      ))}
    </main>
  );
}
