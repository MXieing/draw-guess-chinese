const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const WORDS = ["西瓜","太阳","猫咪","火箭","蛋糕","自行车","大象","彩虹","汉堡","飞机","蘑菇","鲸鱼","冰淇淋","雨伞","机器人","月亮","长颈鹿","钢琴","灯泡","城堡","向日葵","章鱼","热气球","雪人","咖啡杯","恐龙","书包","潜水艇","蝴蝶","中国龙"];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({length: 5}, () => chars[Math.floor(Math.random()*chars.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({id:p.id, name:p.name, score:p.score, host:p.id===room.hostId}));
}
function emitRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("room:update", {code, players:publicPlayers(room), hostId:room.hostId, state:room.state, drawerId:room.drawerId, round:room.round, maxRounds:room.maxRounds, timeLeft:room.timeLeft, wordLength: room.word ? [...room.word].length : 0});
}
function systemMessage(code, text) { io.to(code).emit("chat:message", {system:true, text, time:Date.now()}); }
function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function nextRound(code) {
  const room = rooms.get(code);
  if (!room) return;
  stopTimer(room);
  if (room.players.size < 2) {
    room.state = "waiting"; room.word = null; room.drawerId = null;
    emitRoom(code); systemMessage(code, "至少需要 2 位玩家才能开始游戏。"); return;
  }
  if (room.round >= room.maxRounds) {
    room.state = "finished"; room.word = null; room.drawerId = null;
    emitRoom(code); io.to(code).emit("game:over", {players:publicPlayers(room)}); return;
  }
  room.round++;
  const players = [...room.players.keys()];
  room.drawerId = players[(room.round - 1) % players.length];
  room.word = WORDS[Math.floor(Math.random()*WORDS.length)];
  room.state = "playing"; room.timeLeft = 60; room.guessed = new Set();
  io.to(code).emit("canvas:clear");
  emitRoom(code);
  const drawer = room.players.get(room.drawerId);
  if (drawer) io.to(drawer.id).emit("game:your-word", {word:room.word});
  io.to(code).emit("game:round-start", {drawerId:room.drawerId, drawerName:drawer?.name || "画手", timeLeft:room.timeLeft});
  systemMessage(code, `第 ${room.round} 轮开始！${drawer?.name || "画手"} 正在画画。`);
  room.timer = setInterval(() => {
    if (!rooms.has(code) || room.state !== "playing") return;
    room.timeLeft--;
    io.to(code).emit("game:tick", {timeLeft:room.timeLeft});
    if (room.timeLeft <= 0) {
      stopTimer(room);
      systemMessage(code, `时间到！答案是「${room.word}」。`);
      setTimeout(() => nextRound(code), 2500);
    }
  }, 1000);
}

io.on("connection", socket => {
  socket.on("room:create", ({name}, cb) => {
    const code = makeCode();
    const room = {code, players:new Map(), hostId:socket.id, state:"waiting", round:0, maxRounds:5, drawerId:null, word:null, guessed:new Set(), timer:null, timeLeft:60};
    rooms.set(code, room);
    joinRoom(socket, room, name, cb);
  });
  socket.on("room:join", ({code, name}, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb?.({ok:false, error:"房间不存在，请检查邀请码。"});
    if (room.players.size >= 12) return cb?.({ok:false, error:"房间已满（最多 12 人）。"});
    if (room.state === "playing") return cb?.({ok:false, error:"游戏进行中，暂时不能加入。"});
    joinRoom(socket, room, name, cb);
  });
  socket.on("game:start", (_, cb) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room) return;
    if (room.hostId !== socket.id) return cb?.({ok:false, error:"只有房主可以开始游戏。"});
    if (room.players.size < 2) return cb?.({ok:false, error:"至少需要 2 位玩家。"});
    room.round = 0;
    for (const p of room.players.values()) p.score = 0;
    nextRound(room.code); cb?.({ok:true});
  });
  socket.on("draw:stroke", data => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.state !== "playing" || room.drawerId !== socket.id) return;
    socket.to(room.code).emit("draw:stroke", data);
  });
  socket.on("draw:clear", () => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (room?.state === "playing" && room.drawerId === socket.id) io.to(room.code).emit("canvas:clear");
  });
  socket.on("chat:send", ({text}) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || typeof text !== "string") return;
    text = text.trim().slice(0,120);
    if (!text) return;
    const player = room.players.get(socket.id);
    if (room.state === "playing" && socket.id !== room.drawerId && text.toLowerCase() === String(room.word).toLowerCase() && !room.guessed.has(socket.id)) {
      room.guessed.add(socket.id); player.score += Math.max(10, room.timeLeft);
      io.to(room.code).emit("chat:message", {system:true, text:`🎉 ${player.name} 猜对了！+${Math.max(10, room.timeLeft)} 分`, time:Date.now()});
      socket.emit("game:correct", {word:room.word});
      if (room.guessed.size >= room.players.size - 1) {
        stopTimer(room); setTimeout(() => nextRound(room.code), 1800);
      }
      emitRoom(room.code);
      return;
    }
    if (room.state === "playing" && socket.id === room.drawerId) {
      socket.emit("chat:message", {system:true, text:"画手不能猜答案，继续画吧！", time:Date.now()}); return;
    }
    io.to(room.code).emit("chat:message", {name:player.name, text, time:Date.now()});
  });
  socket.on("disconnect", () => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room) return;
    const player = room.players.get(socket.id);
    room.players.delete(socket.id);
    systemMessage(room.code, `${player?.name || "一位玩家"} 离开了房间。`);
    if (!room.players.size) { stopTimer(room); rooms.delete(room.code); return; }
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
    if (room.drawerId === socket.id && room.state === "playing") {
      systemMessage(room.code, "画手离开了，正在进入下一轮。");
      setTimeout(() => nextRound(room.code), 1200);
    } else emitRoom(room.code);
  });
});
function joinRoom(socket, room, name, cb) {
  name = String(name || "玩家").trim().slice(0,16) || "玩家";
  room.players.set(socket.id, {id:socket.id, name, score:0});
  socket.join(room.code);
  cb?.({ok:true, code:room.code});
  emitRoom(room.code);
  systemMessage(room.code, `${name} 加入了房间。`);
}
server.listen(PORT, () => console.log(`Draw & Guess is running on http://localhost:${PORT}`));