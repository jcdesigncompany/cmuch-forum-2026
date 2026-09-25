import { loadContent, sb } from "./common.js";
(async function(){
"use strict";
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
var S=null;
var KV="assets/img/kv.jpg";
var LOGO="assets/img/logo.png";
var LOGO_FULL="assets/img/logo-full.png";
var A={can:false,preview:false};
var UI={track:"all",q:"",mode:0,step:0};
var TRACKS={opening:"開幕",policy:"國家政策與藍圖",practice:"兒童醫院深耕實踐",panel:"綜合座談",logistics:"報到與休息"};
var WD="日一二三四五六";

/* ---------- helpers ---------- */
function dInfo(){var p=(S.info.date||"2026-11-27").split("-").map(Number);var dt=new Date(Date.UTC(p[0],p[1]-1,p[2]));return {y:p[0],m:p[1],d:p[2],wd:WD[dt.getUTCDay()]}}
function dateZh(){var x=dInfo();return x.y+"年"+x.m+"月"+x.d+"日（"+x.wd+"）"}
function toMin(t){var p=String(t||"0:0").split(":").map(Number);return (p[0]||0)*60+(p[1]||0)}
function tpNow(){var n=new Date();return new Date(n.getTime()+(n.getTimezoneOffset()+480)*60000)}
function sorted(){return S.sessions.slice().sort(function(a,b){return toMin(a.start)-toMin(b.start)})}
function person(id){for(var i=0;i<S.people.length;i++){if(S.people[i].id===id)return S.people[i]}return null}
function adminView(){return false}
function visible(p){return !!p&&(p.status==="confirmed"||S.info.showInvited||adminView())}
function initials(n){n=String(n||"").trim();return n?n.slice(0,1):"?"}
function uid(p){return p+Math.random().toString(36).slice(2,8)}
function mapsUrl(){return "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(S.info.mapQuery||S.info.address)}
function appleUrl(){return "https://maps.apple.com/?daddr="+encodeURIComponent(S.info.address)}
function calUrl(){
  var x=dInfo(),pad=function(n){return String(n).padStart(2,"0")};
  function z(t){var m=toMin(t)-480;var d=new Date(Date.UTC(x.y,x.m-1,x.d,0,m));return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+"T"+pad(d.getUTCHours())+pad(d.getUTCMinutes())+"00Z"}
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(S.info.line1+S.info.line2)+"&dates="+z(S.info.start)+"/"+z(S.info.end)+"&location="+encodeURIComponent(S.info.venue+" "+S.info.address)+"&details="+encodeURIComponent(S.info.subtitle)
}
function regOpen(){return !!(S.registration&&S.registration.open)}
function roleLabel(s){return s.track==="panel"?"與談人":"講者"}
function rolesOf(id){var r=[];sorted().forEach(function(s){if((s.speakers||[]).indexOf(id)>-1)r.push({s:s,role:roleLabel(s)});if((s.moderators||[]).indexOf(id)>-1)r.push({s:s,role:"座長"})});return r}
function toast(msg){var t=document.createElement("div");t.className="toast";t.setAttribute("role","status");t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},2600)}

var IC={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
 cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17h7"/></svg>',
 ppl:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9"/></svg>',
 bus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 18v3M16 18v3"/><circle cx="8" cy="14.5" r=".8" fill="currentColor"/><circle cx="16" cy="14.5" r=".8" fill="currentColor"/></svg>',
 pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
 search:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
 bell:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/></svg>'
};

/* ---------- live status ---------- */
function liveState(){
  var n=tpNow(),x=dInfo();
  var ev=new Date(x.y,x.m-1,x.d),today=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  var diff=Math.round((ev-today)/864e5),mins=n.getHours()*60+n.getMinutes();
  var list=sorted(),cur=null,next=null;
  if(diff===0){for(var i=0;i<list.length;i++){var s=list[i],st=toMin(s.start),en=toMin(s.end||s.start);if(mins>=st&&mins<en)cur=s;if(!next&&st>mins)next=s}}
  return {diff:diff,mins:mins,cur:cur,next:next}
}
function liveHTML(){
  var L=liveState();
  if(L.diff>0)return '<div class="live"><i></i><span>距離論壇開幕還有 <b class="num">'+L.diff+'</b> 天</span></div>';
  if(L.diff<0)return '<div class="live"><i></i><span>論壇已圓滿結束，感謝各位貴賓與先進參與</span></div>';
  if(L.mins<toMin(S.info.checkin))return '<div class="live"><i></i><span>今天 '+esc(S.info.checkin)+' 開放報到</span></div>';
  if(L.mins>=toMin(S.info.end))return '<div class="live"><i></i><span>今日議程已結束，感謝參與</span></div>';
  var t=L.cur?"進行中："+L.cur.title:(L.next?"下一場 "+L.next.start+"："+L.next.title:"論壇進行中");
  return '<div class="live on"><i></i><span>'+esc(t)+'</span></div>'
}

/* ---------- sections ---------- */
function streams(){
  var p="";for(var i=0;i<7;i++){var y=380+i*26,c=i%2?"#F28A1E":"#5B97FF";p+='<path d="M-40 '+(y+i*18)+' C 300 '+(y-40)+', 620 '+(260+i*14)+', 1000 '+(250+i*6)+'" stroke="'+c+'" stroke-opacity="'+(0.10+i*0.03)+'" stroke-width="'+(1+i%3*0.6)+'" fill="none"/>'}
  return '<svg class="streams" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+p+'</svg>'
}
function heroHTML(){
  var I=S.info;
  return '<section class="hero" id="home"><div class="kv" style="background-image:url('+KV+')" role="img" aria-label="論壇主視覺：兒童與智慧醫療儀表板"></div>'+streams()+
  '<div class="wrap"><div class="hero-inner">'+
  '<div class="org"><span class="plate"><img src="'+LOGO_FULL+'" alt="'+esc(I.organizer)+'" width="1400" height="182"></span></div>'+
  '<h1><span>'+esc(I.line1)+'</span><span>'+esc(I.line2)+'</span></h1>'+
  '<p class="sub">'+esc(I.subtitle)+'</p><p class="en">'+esc(I.subtitleEn)+'</p>'+
  (I.purpose?'<p class="lead">'+esc(I.purpose)+'</p>':'')+
  '<dl class="facts"><div><dt>日期</dt><dd class="num">'+esc(dateZh())+'</dd></div><div><dt>時間</dt><dd class="num">'+esc(I.start)+'–'+esc(I.end)+'<small>'+esc(I.checkin)+' 開放報到</small></dd></div><div><dt>地點</dt><dd>'+esc(I.venue)+'<small>'+esc(I.address)+'</small></dd></div></dl>'+
  '<div id="live">'+liveHTML()+'</div>'+
  '<div class="cta">'+(regOpen()?'<a class="btn btn-pri" href="register.html">立即報名</a><a class="btn btn-ghost" href="#agenda">查看議程</a>':'<a class="btn btn-pri" href="#agenda">查看議程</a>')+'<a class="btn btn-ghost" href="'+esc(mapsUrl())+'" target="_blank" rel="noopener">導航到會場</a>'+
  '<a class="btn btn-ghost" href="'+esc(calUrl())+'" target="_blank" rel="noopener">加入行事曆</a>'+
  '</div></div></div></section>'
}
function personInline(ids,label){
  ids=ids||[];if(!ids.length)return "";
  var vis=ids.map(person).filter(visible),hidden=ids.length-vis.length;
  var h=vis.map(function(p){return '<button class="pbtn" data-person="'+esc(p.id)+'"><span class="nm"><b>'+esc(p.name)+'</b> '+esc(p.title)+(p.status!=="confirmed"?'<em class="inv">（邀請中）</em>':'')+'</span><span class="og">'+esc(p.org)+'</span></button>'}).join("");
  if(hidden)h+='<span class="tbc">'+(vis.length?'及其他貴賓（確認中）':label+'確認中')+'</span>';
  return '<div><dt>'+label+'</dt><dd>'+h+'</dd></div>'
}
function splitTitle(t){
  t=String(t||"");var lab="",i=t.indexOf("｜");if(i>0){lab=t.slice(0,i);t=t.slice(i+1)}
  var j=t.indexOf("：");return {lab:lab,main:j>0?t.slice(0,j):t,sub:j>0?t.slice(j+1):""}
}
function matches(s){
  var q=UI.q.trim().toLowerCase();if(!q)return true;
  var hay=[s.title,s.speakerText,s.moderatorText,s.note].join(" ");
  (s.speakers||[]).concat(s.moderators||[]).map(person).filter(visible).forEach(function(p){hay+=" "+p.name+" "+p.org+" "+p.title});
  return hay.toLowerCase().indexOf(q)>-1
}
function agendaRows(){
  var L=liveState(),list=sorted().filter(function(s){return (UI.track==="all"||s.track===UI.track||(UI.track!=="all"&&s.track==="logistics"&&false))&&matches(s)});
  if(!list.length)return '<div class="empty">找不到符合的議程，請調整篩選或關鍵字。</div>';
  return '<ol class="timeline">'+list.map(function(s){
    var st=toMin(s.start),en=toMin(s.end||s.start),dur=en-st,compact=s.track==="logistics";
    var now=L.diff===0&&L.mins>=st&&L.mins<en,past=L.diff<0||(L.diff===0&&L.mins>=en&&!!s.end);
    var mlab=s.track==="panel"||s.track==="opening"?"主持人":"座長";
    var ppl=compact?"":(s.speakerText?'<div><dt>'+roleLabel(s)+'</dt><dd>'+esc(s.speakerText)+'</dd></div>':'')+personInline(s.speakers,roleLabel(s))+(s.moderatorText?'<div><dt>'+mlab+'</dt><dd>'+esc(s.moderatorText)+'</dd></div>':'')+personInline(s.moderators,mlab);
    var T=splitTitle(s.title);
    if(!compact&&s.track==="panel"&&!(s.moderators||[]).length&&adminView())ppl+='<div><dt>主持人</dt><dd><span class="tbc">尚未設定</span></dd></div>';
    return '<li class="row t-'+s.track+(compact?' compact':'')+(now?' is-now':'')+(past?' is-past':'')+'" id="s-'+esc(s.id)+'">'+
    '<div class="time"><b>'+esc(s.start)+'</b>'+(s.end?'<span>'+esc(s.end)+'</span>':'')+'</div><div class="dot"></div>'+
    '<div class="body"><div class="card">'+(compact?'':'<div class="meta"><span class="tag">'+esc(TRACKS[s.track]||"")+'</span>'+(T.lab?'<span class="lab">'+esc(T.lab)+'</span>':'')+(dur>0?'<span class="num">'+dur+' 分鐘</span>':'')+(now?'<span class="now">進行中</span>':'')+'</div>')+
    '<h3>'+esc(T.main)+(compact&&now?' <span class="meta"><span class="now">進行中</span></span>':'')+'</h3>'+(T.sub?'<p class="subt">'+esc(T.sub)+'</p>':'')+
    (ppl?'<dl class="people'+(s.track==="panel"?' panel':'')+'">'+ppl+'</dl>':'')+(s.note?'<p class="hint" style="margin:10px 0 0">'+esc(s.note)+'</p>':'')+
    '</div></div></li>'}).join("")+'</ol>'
}
function agendaHTML(){
  var seg=[["all","全部"],["policy",TRACKS.policy],["practice",TRACKS.practice],["panel",TRACKS.panel]];
  return '<section class="sec" id="agenda"><div class="wrap"><div class="sec-head"><h2>論壇議程<small>Programme</small></h2><p>'+esc(dateZh())+'，'+esc(S.info.start)+'–'+esc(S.info.end)+'。點選講者姓名可查看簡介。</p></div>'+
  '<div class="tools"><div class="seg" role="group" aria-label="依主題篩選">'+seg.map(function(o){return '<button data-track="'+o[0]+'" aria-pressed="'+(UI.track===o[0])+'">'+esc(o[1])+'</button>'}).join("")+'</div>'+
  '<label class="search">'+IC.search+'<span class="sr">搜尋議程</span><input id="q" type="search" placeholder="搜尋講題、講者或單位" value="'+esc(UI.q)+'"></label></div>'+
  '<div id="rows">'+agendaRows()+'</div></div></section>'
}
function speakersHTML(){
  function mini(id,role){
    var p=person(id);if(!p||!visible(p))return '<div class="pm tbd"><div class="ava">?</div><div><span class="rl">'+role+'</span><b>確認中</b></div></div>';
    return '<button class="pm" data-person="'+esc(p.id)+'"><div class="ava">'+(p.photo?'<img src="'+p.photo+'" alt="">':esc(initials(p.name)))+'</div>'+
    '<div><span class="rl">'+role+'</span><b>'+esc(p.name)+'</b><small>'+esc(p.title)+(p.status!=="confirmed"?'<em class="inv">（邀請中）</em>':'')+'</small><span class="og">'+esc(p.org)+'</span></div></button>'
  }
  var rows=sorted().filter(function(s){return (s.track==="policy"||s.track==="practice")&&((s.speakers||[]).length||(s.moderators||[]).length)}).map(function(s){
    var T=splitTitle(s.title);
    return '<li class="pair t-'+s.track+'"><div class="ph"><span class="num">'+esc(s.start)+'–'+esc(s.end)+'</span><span class="tag">'+esc(TRACKS[s.track])+'</span><h3>'+esc(T.main)+'</h3></div>'+
    '<div class="pp">'+(s.speakers||[]).map(function(id){return mini(id,"講者")}).join("")+(s.moderators||[]).map(function(id){return mini(id,"座長")}).join("")+'</div></li>'}).join("");
  var panel=sorted().filter(function(s){return s.track==="panel"&&(s.speakers||[]).length})[0],ph="";
  if(panel){var T=splitTitle(panel.title);
    ph='<li class="pair t-panel"><div class="ph"><span class="num">'+esc(panel.start)+'–'+esc(panel.end)+'</span><span class="tag">'+esc(T.lab||TRACKS.panel)+'</span><h3>'+esc(T.main)+'</h3></div>'+
    '<div class="pp panel">'+panel.speakers.map(function(id){return mini(id,"與談人")}).join("")+(panel.moderators||[]).map(function(id){return mini(id,"主持人")}).join("")+'</div></li>'}
  return '<section class="sec" id="speakers"><div class="wrap"><div class="sec-head"><h2>貴賓與講者<small>Speakers &amp; Moderators</small></h2><p>依場次列出講者與座長，點選姓名查看簡介。</p></div>'+
  (rows||ph?'<ol class="pairs">'+rows+ph+'</ol>':'<div class="empty">講者名單確認中，將陸續公布。</div>')+'</div></section>'
}
function travelHTML(){
  var modes=S.travel||[];if(UI.mode>=modes.length)UI.mode=0;var m=modes[UI.mode];
  return '<section class="sec" id="travel"><div class="wrap"><div class="sec-head"><h2>交通資訊<small>Getting There</small></h2><p>建議多利用大眾運輸前往。</p></div>'+
  '<div class="addr"><div><h3>'+esc(S.info.venue)+'</h3><p>'+esc(S.info.address)+'</p></div><div class="acts">'+
  '<a class="btn btn-blue" href="'+esc(mapsUrl())+'" target="_blank" rel="noopener">Google 地圖</a><a class="btn btn-line" href="'+esc(appleUrl())+'" target="_blank" rel="noopener">Apple 地圖</a><button class="btn btn-line" data-copy="'+esc(S.info.address)+'">複製地址</button></div></div>'+
  '<div class="tabs" role="tablist">'+modes.map(function(x,i){return '<button role="tab" aria-selected="'+(i===UI.mode)+'" data-mode="'+i+'">'+esc(x.name)+'</button>'}).join("")+'</div>'+
  (m?'<ol class="steps" role="tabpanel">'+(m.lines||[]).filter(Boolean).map(function(l){var i=l.indexOf("：");return '<li><span>'+(i>0&&i<40?'<b>'+esc(l.slice(0,i))+'</b>：'+esc(l.slice(i+1)):esc(l))+'</span></li>'}).join("")+'</ol>':'')+
  (S.info.travelNote?'<p class="fine">'+esc(S.info.travelNote)+'</p>':'')+'</div></section>'
}
function wayHTML(){
  var st=S.way.steps||[];if(UI.step>=st.length)UI.step=0;var c=st[UI.step]||{t:"",d:""};
  return '<section class="sec" id="way"><div class="wrap"><div class="sec-head"><h2>會場導引<small>Venue Guide</small></h2><p>從抵達校區到入座，依步驟前往國際會議廳。</p></div><div class="way">'+
  '<ol class="route">'+st.map(function(s,i){return '<li class="'+(i<UI.step?"done":"")+(i===UI.step?" cur":"")+'"><button data-step="'+i+'" aria-current="'+(i===UI.step?"step":"false")+'"><span class="pin">'+(i+1)+'</span><b>'+esc(s.t)+(s.confirm&&adminView()?'<em class="badge-inv">待確認</em>':'')+'</b><span>'+esc(s.d)+'</span></button></li>'}).join("")+'</ol>'+
  '<div class="guide" aria-live="polite"><div class="step-of">STEP '+(UI.step+1)+' / '+st.length+'</div><h3>'+esc(c.t)+'</h3><p>'+esc(c.d)+'</p>'+
  '<div class="nav"><button class="btn btn-line" data-stepgo="-1"'+(UI.step===0?" disabled":"")+'>上一步</button>'+(UI.step<st.length-1?'<button class="btn btn-blue" data-stepgo="1">下一步</button>':'<a class="btn btn-blue" href="#agenda">已抵達，查看議程</a>')+'</div>'+
  (S.way.plan?'<div class="plan"><img src="'+S.way.plan+'" alt="會場平面圖"></div>':'')+
  '<div class="facil">'+(S.way.facilities||[]).map(function(f){return '<div><b>'+esc(f.n)+'</b><span>'+esc(f.l)+'</span></div>'}).join("")+'</div></div></div></div></section>'
}
function infoHTML(){
  var I=S.info,c=[I.contactName,I.contactPhone,I.contactEmail].filter(Boolean);
  return '<section class="sec" id="info"><div class="wrap"><div class="sec-head"><h2>主辦與聯絡資訊<small>Contact</small></h2></div>'+
  '<dl class="info-grid"><div><dt>主辦單位</dt><dd>'+esc(I.organizer)+'</dd></div><div><dt>經費來源</dt><dd>'+esc(I.funding)+'</dd></div>'+
  (c.length?'<div><dt>聯絡窗口</dt><dd>'+(I.contactName?esc(I.contactName)+'<br>':'')+(I.contactPhone?'<a href="tel:'+esc(I.contactPhone.replace(/[^\d+#,]/g,""))+'">'+esc(I.contactPhone)+'</a><br>':'')+(I.contactEmail?'<a href="mailto:'+esc(I.contactEmail)+'">'+esc(I.contactEmail)+'</a>':'')+'</dd></div>':'')+
  '</dl><p class="hint" style="margin-top:26px">已報名者可至 <a href="ticket.html">查詢報到證</a> 取得個人 QR code。</p></div></section>'
}
var NAV=[["home","首頁",IC.home],["agenda","議程",IC.cal],["speakers","貴賓",IC.ppl],["travel","交通",IC.bus],["way","導引",IC.pin]];
function pageHTML(){
  var I=S.info;
  return '<header class="topbar"><div class="wrap"><a class="staff-top" href="admin.html" rel="nofollow" title="工作人員登入" aria-label="工作人員登入"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></a><a class="brand" href="#home"><img src="'+LOGO+'" alt=""><span>'+esc(I.organizer)+' <em>'+dInfo().y+'年'+esc(I.line2)+'</em></span></a><nav class="topnav" aria-label="主要導覽">'+NAV.slice(1).map(function(n){return '<a href="#'+n[0]+'">'+n[1]+'</a>'}).join("")+'<a href="#info">聯絡</a>'+(regOpen()?'<a href="register.html" class="reg">報名</a>':'<a href="ticket.html">報到證</a>')+'</nav></div></header>'+
  (I.noticeOn&&I.notice?'<div class="notice" role="status"><div class="wrap">'+IC.bell+'<span>'+esc(I.notice)+'</span></div></div>':'')+
  '<main>'+heroHTML()+agendaHTML()+speakersHTML()+travelHTML()+wayHTML()+infoHTML()+'</main>'+
  '<footer><div class="wrap"><div class="fbrand"><span class="plate sm"><img src="'+LOGO_FULL+'" alt="'+esc(I.organizer)+'" width="1400" height="182"></span><div>'+esc(I.line1+I.line2)+'<br>'+esc(I.funding)+'</div></div><div class="num">'+esc(dateZh())+'　'+esc(I.venue)+'</div><a class="staff" href="admin.html" rel="nofollow">工作人員登入</a></div></footer>'+
  '<nav class="bnav" aria-label="快速導覽"><div class="in">'+NAV.map(function(n){return '<a href="#'+n[0]+'" data-nav="'+n[0]+'">'+n[2]+'<span>'+n[1]+'</span></a>'}).join("")+'</div></nav>'
}

/* ---------- render ---------- */
var root=document.getElementById("root");
function render(){
  var y=window.scrollY;root.innerHTML=pageHTML();observe();window.scrollTo(0,y);
  document.title=S.info.line1+S.info.line2;
}
function renderRows(){var r=$("#rows");if(r)r.innerHTML=agendaRows()}
function sheet(id){
  var p=person(id);if(!p||!visible(p))return;
  var rs=rolesOf(id);
  var el=document.createElement("div");el.className="scrim";
  el.innerHTML='<div class="sheet" role="dialog" aria-modal="true" aria-label="'+esc(p.name)+' 簡介"><button class="x" aria-label="關閉">×</button><div class="hd"><div class="ava">'+(p.photo?'<img src="'+p.photo+'" alt="">':esc(initials(p.name)))+'</div><div><h3>'+esc(p.name)+' <small style="font-size:15px;font-weight:500;color:var(--muted)">'+esc(p.title)+'</small>'+(p.status!=="confirmed"?'<em class="inv">（邀請中）</em>':'')+'</h3><div style="color:var(--muted);font-size:15px">'+esc(p.org)+'</div></div></div>'+
  (p.bio?'<div class="bio">'+esc(p.bio).replace(/【([^】]+)】\n?/g,'<b class="bh">$1</b>')+'</div>':'<p style="color:var(--muted)">簡介整理中。</p>')+
  (rs.length?'<h4>參與場次</h4><ul>'+rs.map(function(r){return '<li><span class="num">'+esc(r.s.start)+'</span>　'+r.role+'｜'+esc(r.s.title)+'</li>'}).join("")+'</ul>':'')+'</div>';
  function close(){el.remove();document.removeEventListener("keydown",k)}
  function k(e){if(e.key==="Escape")close()}
  el.addEventListener("click",function(e){if(e.target===el||e.target.closest(".x"))close()});
  document.addEventListener("keydown",k);document.body.appendChild(el);$(".x",el).focus()
}
var io=null;
function observe(){
  if(io)io.disconnect();if(!("IntersectionObserver" in window))return;
  io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var id=e.target.id;$$("[data-nav],.topnav a").forEach(function(a){a.classList.toggle("on",a.getAttribute("href")==="#"+id)})}})},{rootMargin:"-45% 0px -50% 0px"});
  $$("main section[id]").forEach(function(s){io.observe(s)})
}

/* ---------- public events ---------- */
document.addEventListener("click",function(e){
  var t=e.target.closest("[data-track],[data-person],[data-mode],[data-step],[data-stepgo],[data-copy]");if(!t||t.closest(".drawer"))return;
  if(t.dataset.track){UI.track=t.dataset.track;$$("[data-track]").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.track===UI.track)});renderRows()}
  else if(t.dataset.person){sheet(t.dataset.person)}
  else if(t.dataset.mode!=null){UI.mode=+t.dataset.mode;swap("#travel",travelHTML())}
  else if(t.dataset.step!=null){UI.step=+t.dataset.step;swap("#way",wayHTML())}
  else if(t.dataset.stepgo){UI.step=Math.max(0,Math.min((S.way.steps||[]).length-1,UI.step+(+t.dataset.stepgo)));swap("#way",wayHTML())}
  else if(t.dataset.copy!=null){try{navigator.clipboard.writeText(t.dataset.copy).then(function(){toast("已複製地址")},function(){toast("無法自動複製，請長按地址複製")})}catch(_){toast("無法自動複製，請長按地址複製")}}
});
function swap(sel,html){var old=$(sel);if(!old)return;var d=document.createElement("div");d.innerHTML=html;var n=d.firstChild;old.replaceWith(n);if(io)io.observe(n);var f=$("[aria-current=step]",n);}
document.addEventListener("input",function(e){if(e.target.id==="q"){UI.q=e.target.value;renderRows()}});
setInterval(function(){var l=$("#live");if(l)l.innerHTML=liveHTML();if(liveState().diff===0)renderRows()},60000);

/* ---------- boot ---------- */
try{var got=await loadContent();S=got.S}catch(e){root.innerHTML='<div style="padding:60px 20px;text-align:center">網站內容載入失敗，請重新整理頁面。</div>';return}
if(!S.way)S.way={steps:[],facilities:[]};if(!S.travel)S.travel=[];
render();
if(location.hash){var tg=document.getElementById(location.hash.slice(1));if(tg)tg.scrollIntoView()}
})();
