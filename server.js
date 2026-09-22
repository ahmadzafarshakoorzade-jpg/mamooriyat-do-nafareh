
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const rooms = new Map();

function roomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload) {
  for (const p of room.players) send(p.ws, payload);
}

function state(room) {
  return {
    type: "state",
    players: room.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      hp: p.hp,
      score: p.score,
      slot: i + 1
    })),
    robotHp: room.robotHp,
    mission: room.mission,
    started: room.players.length === 2
  };
}

const server = http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  file = file.split("?")[0];
  const safe = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(publicDir, safe);

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
      return res.end("Not found");
    }
    const ext = path.extname(full);
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : "application/javascript; charset=utf-8";
    res.writeHead(200, {"Content-Type": type});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  const player = {
    ws,
    id: crypto.randomUUID(),
    name: "بازیکن",
    room: null,
    x: 18,
    y: 50,
    hp: 100,
    score: 0
  };

  send(ws, {type: "connected", id: player.id});

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "create") {
      const code = roomCode();
      const room = {code, players: [], robotHp: 100, mission: "به ربات نگهبان برسید!"};
      rooms.set(code, room);
      player.name = String(msg.name || "بازیکن ۱").slice(0, 20);
      player.room = code;
      room.players.push(player);
      send(ws, {type: "roomCreated", code});
      broadcast(room, state(room));
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, {type: "error", message: "اتاق پیدا نشد."});
      if (room.players.length >= 2) return send(ws, {type: "error", message: "این اتاق پر است."});
      player.name = String(msg.name || "بازیکن ۲").slice(0, 20);
      player.room = code;
      player.x = 82;
      room.players.push(player);
      send(ws, {type: "joined", code});
      broadcast(room, state(room));
      return;
    }

    const room = player.room ? rooms.get(player.room) : null;
    if (!room) return;

    if (msg.type === "move") {
      const dx = Math.max(-1, Math.min(1, Number(msg.dx) || 0));
      const dy = Math.max(-1, Math.min(1, Number(msg.dy) || 0));
      player.x = Math.max(8, Math.min(92, player.x + dx * 4));
      player.y = Math.max(12, Math.min(88, player.y + dy * 4));
      broadcast(room, state(room));
    }

    if (msg.type === "attack") {
      if (room.players.length < 2) return;
      room.robotHp = Math.max(0, room.robotHp - 10);
      player.score += 10;
      room.mission = room.robotHp === 0 ? "ماموریت کامل شد! 🎉" : "ربات را شکست بدهید!";
      broadcast(room, state(room));
    }

    if (msg.type === "dash") {
      player.x = Math.max(8, Math.min(92, player.x + (player.x < 50 ? 10 : -10)));
      player.score += 2;
      broadcast(room, state(room));
    }

    if (msg.type === "team") {
      room.players.forEach(p => p.score += 5);
      room.robotHp = Math.max(0, room.robotHp - 20);
      room.mission = room.robotHp === 0 ? "حرکت تیمی موفق شد! 🎉" : "حرکت تیمی! دوباره حمله کنید!";
      broadcast(room, state(room));
    }

    if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 180);
      if (text) broadcast(room, {type: "chat", name: player.name, text});
    }

    if (msg.type === "reset") {
      room.robotHp = 100;
      room.mission = "به ربات نگهبان برسید!";
      room.players.forEach((p, i) => {
        p.hp = 100; p.score = 0; p.x = i === 0 ? 18 : 82; p.y = 50;
      });
      broadcast(room, state(room));
    }
  });

  ws.on("close", () => {
    const room = player.room ? rooms.get(player.room) : null;
    if (!room) return;
    room.players = room.players.filter(p => p !== player);
    if (room.players.length === 0) rooms.delete(room.code);
    else broadcast(room, {type: "left", name: player.name, ...state(room)});
  });
});

server.listen(PORT, () => console.log(`Game server running on ${PORT}`));
