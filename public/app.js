let me=null, mode="login", socket=null, chatTarget=null;

const $=id=>document.getElementById(id);
function toast(s){$("toast").textContent=s;$("toast").style.display="block";setTimeout(()=>$("toast").style.display="none",2500)}
async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json",...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d}

function authMode(m){mode=m;$("signupFields").hidden=m!=="signup";$("authSubmit").textContent=m==="login"?"Login":"Create account";$("authMsg").textContent=""}
$("authForm").onsubmit=async e=>{
 e.preventDefault();
 try{
  const d=await api("/api/auth/"+(mode==="login"?"login":"signup"),{method:"POST",body:JSON.stringify({
   username:$("username").value,password:$("password").value,full_name:$("full_name").value,phone:$("phone").value,bio:$("bio").value
  })});
  enter(d.user);
 }catch(err){$("authMsg").textContent=err.message}
}
function enter(u){
 me=u;$("auth").hidden=true;$("app").hidden=false;$("adminBtn").hidden=u.role!=="admin";
 $("pFullName").value=u.full_name||"";$("pPhone").value=u.phone||"";$("pAvatar").value=u.avatar_url||"";$("pBio").value=u.bio||"";
 connectSocket();show("home");loadFeed();
}
async function check(){try{const d=await api("/api/me");enter(d.user)}catch{}}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.reload()}
function show(id){document.querySelectorAll(".page").forEach(x=>x.hidden=true);$(id).hidden=false;if(id==="home")loadFeed();if(id==="people"){loadPeople();loadRequests()}if(id==="vip")loadVip();if(id==="admin")loadAdmin()}

async function createPost(){
 try{await api("/api/posts",{method:"POST",body:JSON.stringify({body:$("postBody").value,media_url:$("mediaUrl").value,media_type:$("mediaType").value})});$("postBody").value="";$("mediaUrl").value="";toast("Post received for review");loadFeed()}
 catch(e){toast(e.message)}
}
async function loadFeed(){
 try{const d=await api("/api/feed");$("feed").innerHTML=d.posts.map(p=>`
 <article class="card post"><div class="meta"><b>${esc(p.full_name)}</b> @${esc(p.username)} · ${new Date(p.created_at).toLocaleString()}</div>
 <p>${esc(p.body)}</p>${p.media_url?`<p><a href="${esc(p.media_url)}" target="_blank">Open ${esc(p.media_type||"media")}</a></p>`:""}
 <div><button onclick="comment(${p.id})">Comment (${p.comment_count})</button></div></article>`).join("")||'<div class="card">No approved posts yet.</div>'}
 catch(e){toast(e.message)}
}
async function comment(id){const body=prompt("Comment");if(!body)return;try{await api(`/api/posts/${id}/comments`,{method:"POST",body:JSON.stringify({body})});loadFeed()}catch(e){toast(e.message)}}

async function loadPeople(){
 const q=encodeURIComponent($("peopleSearch").value||"");try{const d=await api("/api/users?q="+q);$("peopleList").innerHTML=d.users.filter(u=>u.id!==me.id).map(u=>`
 <div class="card person"><div class="row"><img class="avatar" src="${esc(u.avatar_url||"")}"><div><b>${esc(u.full_name)}</b><div class="meta">@${esc(u.username)} · ID ${u.id}</div></div></div>
 <div><button onclick="follow(${u.id})">Follow</button><button onclick="friend(${u.id})">Add friend</button><button onclick="startCall(${u.id},'video')">📹</button><button onclick="startCall(${u.id},'audio')">📞</button></div></div>`).join("")}
 catch(e){toast(e.message)}
}
async function follow(id){try{await api("/api/follow/"+id,{method:"POST"});toast("Followed")}catch(e){toast(e.message)}}
async function friend(id){try{await api("/api/friends/request/"+id,{method:"POST"});toast("Friend request sent")}catch(e){toast(e.message)}}
async function loadRequests(){try{const d=await api("/api/friends/requests");$("requests").innerHTML=d.requests.map(r=>`<div class="person"><span>${esc(r.full_name)} @${esc(r.username)}</span><span><button onclick="friendAction(${r.requester_id},'confirm')">Confirm</button><button onclick="friendAction(${r.requester_id},'reject')">Reject</button></span></div>`).join("")||"No requests"}catch(e){}}
async function friendAction(id,a){await api(`/api/friends/${id}/${a}`,{method:"POST"});loadRequests()}

async function saveProfile(){try{const d=await api("/api/profile",{method:"PUT",body:JSON.stringify({full_name:$("pFullName").value,phone:$("pPhone").value,avatar_url:$("pAvatar").value,bio:$("pBio").value})});me=d.user;toast("Profile saved")}catch(e){toast(e.message)}}

async function loadChat(){chatTarget=Number($("chatUser").value);if(!chatTarget)return;try{const d=await api("/api/messages/"+chatTarget);$("chatBox").innerHTML=d.messages.map(m=>`<p><b>${m.sender_id===me.id?"You":"Them"}:</b> ${esc(m.body)}</p>`).join("")||"No messages"}catch(e){toast(e.message)}}
async function sendChat(){if(!chatTarget)return toast("Open a user first");const body=$("chatText").value.trim();if(!body)return;await api("/api/messages/"+chatTarget,{method:"POST",body:JSON.stringify({body})});$("chatText").value="";loadChat()}
function connectSocket(){
 if(socket)return;socket=io();socket.on("message:new",m=>{if(chatTarget===m.sender_id)loadChat();else toast("New message")});
 socket.on("call:incoming",c=>toast("Incoming "+c.call_type+" call from user "+c.caller_id));
 socket.on("call:signal",d=>window.dispatchEvent(new CustomEvent("call-signal",{detail:d})));
}
async function startCall(id,type){try{const d=await api("/api/calls",{method:"POST",body:JSON.stringify({receiver_id:id,call_type:type})});toast("Calling user "+id);/* WebRTC signaling is wired through Socket.IO; full camera UI is next module. */}catch(e){toast(e.message)}}

async function loadVip(){try{const d=await api("/api/vip/info");$("vipPhone").textContent="☎ "+d.admin_phone;$("vipUser").textContent="👤 "+d.admin_username}catch(e){}}
async function vipRequest(){try{await api("/api/vip/request",{method:"POST"});$("vipMsg").textContent="VIP request sent. Admin will contact you."}catch(e){toast(e.message)}}

async function loadAdmin(){
 if(me?.role!=="admin")return;
 try{
  const p=await api("/api/admin/pending-posts");$("pending").innerHTML=p.posts.map(x=>`<div class="adminItem"><b>@${esc(x.username)}</b><p>${esc(x.body)}</p><button onclick="moderatePost(${x.id},'approve')">Approve</button><button onclick="moderatePost(${x.id},'reject')">Reject</button></div>`).join("")||"No pending posts";
  const u=await api("/api/admin/users");$("adminUsers").innerHTML=u.users.map(x=>`<div class="adminItem"><b>${esc(x.full_name)}</b> @${esc(x.username)} <span class="badge">${x.status}</span>
  <button onclick="userAction(${x.id},'warn')">Warn</button><button onclick="userAction(${x.id},'suspend')">Suspend 7d</button><button onclick="userAction(${x.id},'ban')">Ban</button><button onclick="userAction(${x.id},'unban')">Unban</button></div>`).join("");
 }catch(e){toast(e.message)}
}
async function moderatePost(id,a){await api(`/api/admin/posts/${id}/${a}`,{method:"POST"});loadAdmin()}
async function userAction(id,a){await api(`/api/admin/users/${id}/action`,{method:"POST",body:JSON.stringify({action:a,reason:"Admin moderation"})});loadAdmin()}

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
check();
