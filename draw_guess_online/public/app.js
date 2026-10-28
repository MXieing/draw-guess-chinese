const socket = io();
const $ = id => document.getElementById(id);
const lobby = $("lobby"), game = $("game"), canvas = $("canvas"), ctx = canvas.getContext("2d");
let myId = null, roomCode = null, isDrawer = false, currentWord = "", drawing = false, last = null;
let color = "#24253a", size = 6, erasing = false, toastTimer;
const avatars = ["🦊","🐼","🐸","🐱","🐻","🐰","🐯","🐧","🐙","🦄","🐨","🐵"];
socket.on("connect", () => myId = socket.id);
function toast(s){const t=$("toast");t.textContent=s;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2300)}
function showGame(code){roomCode=code;lobby.classList.add("hidden");game.classList.remove("hidden");$("codeDisplay").textContent=code;$("messages").innerHTML="";$("canvasEmpty").style.display="block";$("wordHint").textContent="等待房主开始游戏";$("roundInfo").textContent="等待开始"}
function getName(){return $("playerName").value.trim().slice(0,16)||"玩家"}
$("createBtn").onclick=()=>{socket.emit("room:create",{name:getName()},res=>{if(res?.ok)showGame(res.code);else $("lobbyError").textContent=res?.error||"创建房间失败"})};
$("joinBtn").onclick=()=>{const code=$("roomCode").value.trim().toUpperCase();if(code.length!==5){$("lobbyError").textContent="请输入 5 位邀请码";return}socket.emit("room:join",{name:getName(),code},res=>{if(res?.ok){showGame(res.code);$("lobbyError").textContent=""}else $("lobbyError").textContent=res?.error||"加入房间失败"})};
$("copyBtn").onclick=async()=>{const url=`${location.origin}${location.pathname}?room=${roomCode}`;try{await navigator.clipboard.writeText(url);toast("邀请链接已复制，快发给朋友吧！")}catch{prompt("复制下面的邀请链接：",url)}};
$("startBtn").onclick=()=>socket.emit("game:start",{},res=>{if(res&&!res.ok)toast(res.error)});
function addMessage(m){const box=$("messages");const empty=box.querySelector(".welcome");if(empty)empty.remove();const el=document.createElement("div");el.className="msg"+(m.system?" system":"");if(m.system)el.textContent=m.text;else{const who=document.createElement("span");who.className="who";who.textContent=(m.name||"玩家")+"：";const txt=document.createElement("span");txt.textContent=m.text;el.append(who,txt)}box.appendChild(el);box.scrollTop=box.scrollHeight}
socket.on("room:update",r=>{
 roomCode=r.code;$("codeDisplay").textContent=r.code;$("playerCount").textContent=`${r.players.length}/12`;
 $("players").innerHTML="";
 r.players.slice().sort((a,b)=>b.score-a.score).forEach((p,i)=>{const row=document.createElement("div");row.className="player";const av=document.createElement("div");av.className="avatar";av.textContent=avatars[i%avatars.length];const name=document.createElement("div");name.className="player-name";name.textContent=p.name+(p.id===r.drawerId?" ✎":"");row.append(av,name);if(p.host){const tag=document.createElement("span");tag.className="host-tag";tag.textContent="房主";row.append(tag)}const score=document.createElement("span");score.className="score";score.textContent=p.score+" 分";row.append(score);$("players").append(row)});
 const me=r.players.find(p=>p.id===myId);const host=me?.host;
 $("startBtn").classList.toggle("hidden",!host||r.state==="playing");$("hostHint").textContent=host?"房主可以开始游戏 · 至少需要 2 位玩家":"等待房主开始游戏";
 $("roundInfo").textContent=r.state==="playing"?`第 ${r.round}/${r.maxRounds} 轮`:r.state==="finished"?"本局游戏结束":"等待开始";
 isDrawer=r.drawerId===myId;
 $("drawNote").textContent=isDrawer?"你是本轮画手！画出词语让大家猜。":"只有本轮画手可以作画";
 canvas.style.cursor=isDrawer?"crosshair":"default";
});
socket.on("chat:message",addMessage);
socket.on("game:your-word",d=>{currentWord=d.word;$("wordHint").textContent="你的词语："+d.word;$("wordLength").textContent="";$("canvasEmpty").style.display="none";toast("轮到你画画啦！")});
socket.on("game:round-start",d=>{$("wordHint").textContent=d.drawerId===myId?"你的词语即将显示":"猜猜画的是什么！";$("wordLength").textContent=d.drawerId===myId?"":""; $("timer").textContent="01:00";$("canvasEmpty").style.display="none";isDrawer=d.drawerId===myId});
socket.on("game:tick",d=>{$("timer").textContent=`00:${String(d.timeLeft).padStart(2,"0")}`;$("timer").style.background=d.timeLeft<=10?"#ffe2e8":"#fff0f3"});
socket.on("game:correct",d=>{$("wordHint").textContent="答对啦！答案是："+d.word;toast("太棒了，你猜对啦！")});
socket.on("game:over",d=>{const winner=d.players.slice().sort((a,b)=>b.score-a.score)[0];$("wordHint").textContent="本局游戏结束！";$("wordLength").textContent=winner?`🏆 ${winner.name} 获胜`:"";$("roundInfo").textContent="本局游戏结束";toast(winner?`🏆 ${winner.name} 获得最高分！`:"本局游戏结束")});
socket.on("canvas:clear",()=>{ctx.clearRect(0,0,canvas.width,canvas.height);$("canvasEmpty").style.display="none"});
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
function drawSegment(a,b,c,s,erase){ctx.save();ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=erase?"#ffffff":c;ctx.lineWidth=s;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore()}
canvas.addEventListener("pointerdown",e=>{if(!isDrawer)return;drawing=true;last=point(e);canvas.setPointerCapture(e.pointerId);ctx.fillStyle=erasing?"#ffffff":color;ctx.beginPath();ctx.arc(last.x,last.y,size/2,0,Math.PI*2);ctx.fill();socket.emit("draw:stroke",{a:last,b:last,color,size,erase:erasing})});
canvas.addEventListener("pointermove",e=>{if(!drawing||!isDrawer)return;const p=point(e);drawSegment(last,p,color,size,erasing);socket.emit("draw:stroke",{a:last,b:p,color,size,erase:erasing});last=p});
function endDraw(){drawing=false;last=null}canvas.addEventListener("pointerup",endDraw);canvas.addEventListener("pointercancel",endDraw);
socket.on("draw:stroke",d=>{drawSegment(d.a,d.b,d.color,d.size,d.erase);$("canvasEmpty").style.display="none"});
document.querySelectorAll(".swatch").forEach(b=>b.onclick=()=>{color=b.dataset.color;erasing=false;document.querySelectorAll(".swatch").forEach(x=>x.classList.toggle("selected",x===b))});
$("brushSize").oninput=e=>size=Number(e.target.value);
$("eraserBtn").onclick=()=>{erasing=!erasing;$("eraserBtn").textContent=erasing?"恢复画笔":"橡皮擦";toast(erasing?"已启用橡皮擦":"已切换回画笔")};
$("clearBtn").onclick=()=>{if(isDrawer)socket.emit("draw:clear");else toast("只有画手可以清空画板")};
$("chatForm").onsubmit=e=>{e.preventDefault();const input=$("chatInput");if(input.value.trim())socket.emit("chat:send",{text:input.value});input.value=""};
const params=new URLSearchParams(location.search);if(params.get("room"))$("roomCode").value=params.get("room").toUpperCase();