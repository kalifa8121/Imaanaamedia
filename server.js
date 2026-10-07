require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 25e6 });
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "dev-only-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

function cleanUsername(v) {
  return String(v || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
}
function userSafe(u) {
  if (!u) return null;
  return { id:u.id, username:u.username, full_name:u.full_name, bio:u.bio, avatar_url:u.avatar_url, phone:u.phone, role:u.role, status:u.status };
}
async function q(text, params=[]) { return pool.query(text, params); }

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await q(schema);
  const adminUsername = cleanUsername(process.env.ADMIN_USERNAME || "admin");
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword";
  const exists = await q("SELECT id FROM users WHERE username=$1", [adminUsername]);
  if (!exists.rows.length) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await q("INSERT INTO users(username,password_hash,full_name,role) VALUES($1,$2,$3,'admin')",
      [adminUsername, hash, "System Admin"]);
  }
}

function requireLogin(req,res,next) {
  if (!req.session.userId) return res.status(401).json({error:"Login required"});
  next();
}
async function currentUser(req) {
  if (!req.session.userId) return null;
  const r = await q("SELECT * FROM users WHERE id=$1", [req.session.userId]);
  return r.rows[0] || null;
}
async function requireAdmin(req,res,next) {
  const u = await currentUser(req);
  if (!u || u.role !== "admin") return res.status(403).json({error:"Admin only"});
  req.user = u; next();
}

app.get("/api/health", (req,res)=>res.json({ok:true, service:"afaan-social"}));

app.post("/api/auth/signup", async (req,res)=>{
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const fullName = String(req.body.full_name || "").trim().slice(0,120);
    if (!username || username.length < 3) return res.status(400).json({error:"Username must be at least 3 characters"});
    if (password.length < 8) return res.status(400).json({error:"Password must be at least 8 characters"});
    if (!fullName) return res.status(400).json({error:"Full name is required"});
    const hash = await bcrypt.hash(password, 12);
    const r = await q("INSERT INTO users(username,password_hash,full_name,phone,bio) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [username,hash,fullName,String(req.body.phone||"").slice(0,30),String(req.body.bio||"").slice(0,500)]);
    req.session.userId = r.rows[0].id;
    res.json({user:userSafe(r.rows[0])});
  } catch(e) {
    if (e.code === "23505") return res.status(409).json({error:"Username already exists"});
    console.error(e); res.status(500).json({error:"Signup failed"});
  }
});

app.post("/api/auth/login", async (req,res)=>{
  try {
    const username = cleanUsername(req.body.username);
    const r = await q("SELECT * FROM users WHERE username=$1", [username]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(String(req.body.password||""), u.password_hash)))
      return res.status(401).json({error:"Username or password is incorrect"});
    if (u.status === "banned") return res.status(403).json({error:"Account is banned"});
    if (u.suspended_until && new Date(u.suspended_until) > new Date())
      return res.status(403).json({error:"Account is temporarily suspended"});
    await q("UPDATE users SET last_seen=NOW() WHERE id=$1", [u.id]);
    req.session.userId = u.id;
    res.json({user:userSafe(u)});
  } catch(e) { console.error(e); res.status(500).json({error:"Login failed"}); }
});

app.post("/api/auth/logout", (req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me", requireLogin, async (req,res)=>{
  const u = await currentUser(req);
  res.json({user:userSafe(u)});
});

app.put("/api/profile", requireLogin, async (req,res)=>{
  const fullName = String(req.body.full_name||"").trim().slice(0,120);
  const bio = String(req.body.bio||"").slice(0,500);
  const phone = String(req.body.phone||"").slice(0,30);
  const avatar = String(req.body.avatar_url||"").slice(0,500);
  const r = await q("UPDATE users SET full_name=$1,bio=$2,phone=$3,avatar_url=$4 WHERE id=$5 RETURNING *",
    [fullName,bio,phone,avatar,req.session.userId]);
  res.json({user:userSafe(r.rows[0])});
});

app.get("/api/users", requireLogin, async (req,res)=>{
  const term = String(req.query.q||"").trim().toLowerCase();
  const r = await q("SELECT id,username,full_name,bio,avatar_url,status,last_seen FROM users WHERE username LIKE $1 OR LOWER(full_name) LIKE $1 ORDER BY username LIMIT 50", [`%${term}%`]);
  res.json({users:r.rows});
});

app.post("/api/posts", requireLogin, async (req,res)=>{
  const body = String(req.body.body||"").trim().slice(0,5000);
  const mediaUrl = String(req.body.media_url||"").slice(0,1000);
  const mediaType = String(req.body.media_type||"").slice(0,20);
  if (!body && !mediaUrl) return res.status(400).json({error:"Post is empty"});
  const r = await q("INSERT INTO posts(user_id,body,media_url,media_type,status) VALUES($1,$2,$3,$4,'pending') RETURNING *",
    [req.session.userId,body,mediaUrl,mediaType]);
  res.json({post:r.rows[0], message:"Post received"});
});

app.get("/api/feed", requireLogin, async (req,res)=>{
  const r = await q(`SELECT p.*, u.username, u.full_name, u.avatar_url,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comment_count
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.status='approved' ORDER BY p.created_at DESC LIMIT 100`);
  res.json({posts:r.rows});
});

app.get("/api/my-posts", requireLogin, async (req,res)=>{
  const r = await q("SELECT * FROM posts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.session.userId]);
  res.json({posts:r.rows});
});

app.post("/api/posts/:id/comments", requireLogin, async (req,res)=>{
  const body=String(req.body.body||"").trim().slice(0,1000);
  if(!body) return res.status(400).json({error:"Comment is empty"});
  const r=await q("INSERT INTO comments(post_id,user_id,body) VALUES($1,$2,$3) RETURNING *",
    [req.params.id,req.session.userId,body]);
  res.json({comment:r.rows[0]});
});

app.get("/api/posts/:id/comments", requireLogin, async (req,res)=>{
  const r=await q(`SELECT c.*,u.username,u.full_name FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.post_id=$1 ORDER BY c.created_at ASC`,[req.params.id]);
  res.json({comments:r.rows});
});

app.post("/api/follow/:id", requireLogin, async(req,res)=>{
  const target=Number(req.params.id);
  if(target===req.session.userId) return res.status(400).json({error:"Cannot follow yourself"});
  await q("INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.session.userId,target]);
  res.json({ok:true});
});
app.delete("/api/follow/:id", requireLogin, async(req,res)=>{
  await q("DELETE FROM follows WHERE follower_id=$1 AND following_id=$2",[req.session.userId,Number(req.params.id)]);
  res.json({ok:true});
});

app.post("/api/friends/request/:id", requireLogin, async(req,res)=>{
  const target=Number(req.params.id);
  if(target===req.session.userId) return res.status(400).json({error:"Cannot add yourself"});
  await q(`INSERT INTO friendships(requester_id,receiver_id,status) VALUES($1,$2,'pending')
           ON CONFLICT(requester_id,receiver_id) DO NOTHING`,[req.session.userId,target]);
  res.json({ok:true});
});
app.post("/api/friends/:id/confirm", requireLogin, async(req,res)=>{
  const id=Number(req.params.id);
  const r=await q(`UPDATE friendships SET status='accepted'
    WHERE requester_id=$1 AND receiver_id=$2 RETURNING *`,[id,req.session.userId]);
  if(!r.rows.length) return res.status(404).json({error:"Request not found"});
  res.json({ok:true});
});
app.post("/api/friends/:id/reject", requireLogin, async(req,res)=>{
  await q(`UPDATE friendships SET status='rejected' WHERE requester_id=$1 AND receiver_id=$2`,
    [Number(req.params.id),req.session.userId]);
  res.json({ok:true});
});
app.get("/api/friends/requests", requireLogin, async(req,res)=>{
  const r=await q(`SELECT f.*,u.username,u.full_name,u.avatar_url FROM friendships f
    JOIN users u ON u.id=f.requester_id WHERE f.receiver_id=$1 AND f.status='pending'
    ORDER BY f.created_at DESC`,[req.session.userId]);
  res.json({requests:r.rows});
});

app.get("/api/messages/:userId", requireLogin, async(req,res)=>{
  const other=Number(req.params.userId);
  const r=await q(`SELECT m.*,su.username sender_username,ru.username receiver_username
    FROM messages m JOIN users su ON su.id=m.sender_id JOIN users ru ON ru.id=m.receiver_id
    WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
    ORDER BY created_at ASC LIMIT 500`,[req.session.userId,other]);
  res.json({messages:r.rows});
});

app.post("/api/messages/:userId", requireLogin, async(req,res)=>{
  const other=Number(req.params.userId);
  const body=String(req.body.body||"").trim().slice(0,5000);
  if(!body) return res.status(400).json({error:"Message is empty"});
  const r=await q("INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING *",
    [req.session.userId,other,body]);
  io.to(`user:${other}`).emit("message:new",r.rows[0]);
  res.json({message:r.rows[0]});
});

app.post("/api/calls", requireLogin, async(req,res)=>{
  const receiver=Number(req.body.receiver_id);
  const type=req.body.call_type==="audio"?"audio":"video";
  const r=await q("INSERT INTO calls(caller_id,receiver_id,call_type) VALUES($1,$2,$3) RETURNING *",
    [req.session.userId,receiver,type]);
  io.to(`user:${receiver}`).emit("call:incoming",{...r.rows[0],caller_id:req.session.userId});
  res.json({call:r.rows[0]});
});

app.post("/api/vip/request", requireLogin, async(req,res)=>{
  const r=await q("INSERT INTO vip_memberships(user_id,status) VALUES($1,'pending') RETURNING *",[req.session.userId]);
  res.json({membership:r.rows[0], admin_phone:process.env.ADMIN_PHONE||"0920689815", admin_username:process.env.ADMIN_VIP_USERNAME||"@kalifa"});
});

app.get("/api/vip/info", requireLogin, async(req,res)=>{
  res.json({admin_phone:process.env.ADMIN_PHONE||"0920689815",admin_username:process.env.ADMIN_VIP_USERNAME||"@kalifa"});
});

/* Admin moderation */
app.get("/api/admin/pending-posts", requireAdmin, async(req,res)=>{
  const r=await q(`SELECT p.*,u.username,u.full_name FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.status='pending' ORDER BY p.created_at ASC`);
  res.json({posts:r.rows});
});
app.post("/api/admin/posts/:id/approve", requireAdmin, async(req,res)=>{
  const r=await q("UPDATE posts SET status='approved',approved_at=NOW() WHERE id=$1 AND status='pending' RETURNING *",[req.params.id]);
  res.json({post:r.rows[0]||null});
});
app.post("/api/admin/posts/:id/reject", requireAdmin, async(req,res)=>{
  const r=await q("UPDATE posts SET status='rejected' WHERE id=$1 AND status='pending' RETURNING *",[req.params.id]);
  res.json({post:r.rows[0]||null});
});
app.get("/api/admin/users", requireAdmin, async(req,res)=>{
  const r=await q("SELECT id,username,full_name,role,status,suspended_until,created_at,last_seen FROM users ORDER BY created_at DESC LIMIT 500");
  res.json({users:r.rows});
});
app.post("/api/admin/users/:id/action", requireAdmin, async(req,res)=>{
  const id=Number(req.params.id), action=String(req.body.action||"");
  if(id===req.user.id) return res.status(400).json({error:"Cannot moderate yourself"});
  if(action==="warn") {
    await q("INSERT INTO moderation_actions(admin_id,user_id,action,reason) VALUES($1,$2,'warning',$3)",
      [req.user.id,id,String(req.body.reason||"").slice(0,1000)]);
  } else if(action==="suspend") {
    const days=Math.max(1,Math.min(365,Number(req.body.days)||7));
    await q("UPDATE users SET status='active',suspended_until=NOW()+($1 || ' days')::interval WHERE id=$2",[days,id]);
    await q("INSERT INTO moderation_actions(admin_id,user_id,action,reason,until_at) VALUES($1,$2,'suspend',$3,NOW()+($4 || ' days')::interval)",
      [req.user.id,id,String(req.body.reason||"").slice(0,1000),days]);
  } else if(action==="ban") {
    await q("UPDATE users SET status='banned' WHERE id=$1",[id]);
    await q("INSERT INTO moderation_actions(admin_id,user_id,action,reason) VALUES($1,$2,'ban',$3)",
      [req.user.id,id,String(req.body.reason||"").slice(0,1000)]);
  } else if(action==="unban") {
    await q("UPDATE users SET status='active',suspended_until=NULL WHERE id=$1",[id]);
  } else return res.status(400).json({error:"Unknown action"});
  res.json({ok:true});
});

io.use((socket,next)=>sessionMiddleware(socket.request,{},next));
const online = new Map();

io.on("connection", async (socket)=>{
  const sess=socket.request.session;
  if(!sess || !sess.userId) return;
  const uid=sess.userId;
  socket.join(`user:${uid}`);
  online.set(uid,(online.get(uid)||0)+1);
  await q("UPDATE users SET last_seen=NOW() WHERE id=$1",[uid]).catch(()=>{});
  io.emit("presence:update",{user_id:uid,online:true});

  socket.on("chat:typing", data=>{
    const target=Number(data?.to_user_id);
    if(target) io.to(`user:${target}`).emit("chat:typing",{user_id:uid,typing:!!data.typing});
  });

  socket.on("call:signal", data=>{
    const target=Number(data?.to_user_id);
    if(target) io.to(`user:${target}`).emit("call:signal",{...data,from_user_id:uid});
  });

  socket.on("call:status", async data=>{
    const target=Number(data?.to_user_id);
    const callId=Number(data?.call_id);
    if(target) io.to(`user:${target}`).emit("call:status",{...data,from_user_id:uid});
    if(callId && data.status==="ended") await q("UPDATE calls SET status='ended',ended_at=NOW() WHERE id=$1",[callId]).catch(()=>{});
  });

  socket.on("disconnect",async()=>{
    const n=(online.get(uid)||1)-1;
    if(n<=0) {
      online.delete(uid);
      await q("UPDATE users SET last_seen=NOW() WHERE id=$1",[uid]).catch(()=>{});
      io.emit("presence:update",{user_id:uid,online:false,last_seen:new Date().toISOString()});
    } else online.set(uid,n);
  });
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

init().then(()=>{
  server.listen(PORT,()=>console.log(`Afaan Social running on port ${PORT}`));
}).catch(err=>{
  console.error("Startup failed:",err);
  process.exit(1);
});
