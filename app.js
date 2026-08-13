// ═══════════════════════════════════════════════════════════════════════
// MOVE — Exercise & Yoga Tracker
// Split from dmackay05/fitness-tracker. Covers Today (session/exercise
// logging) and Yoga (pose library + flows) only — no food/nutrition.
// ═══════════════════════════════════════════════════════════════════════

var store = (function() {
  var _memStore = {};
  try {
    localStorage.setItem('__test__', '1');
    localStorage.removeItem('__test__');
    return {
      get: function(k) { try { return localStorage.getItem(k); } catch(e) { return _memStore[k]||null; } },
      set: function(k,v) { try { localStorage.setItem(k,v); } catch(e) { _memStore[k]=v; } },
      remove: function(k) { try { localStorage.removeItem(k); } catch(e) { delete _memStore[k]; } }
    };
  } catch(e) {
    return {
      get: function(k) { return _memStore[k]||null; },
      set: function(k,v) { _memStore[k]=v; },
      remove: function(k) { delete _memStore[k]; }
    };
  }
})();

var APP_BUILD = "Move v1 — 2026-08-12";
try{ console.log("Move build:", APP_BUILD); }catch(e){}
var SHEETS_URL   = store.get('mv_sheets_url')  || "";
var APP_PIN = (function(){ var p=store.get('mv_pin'); p=(p==null?"":String(p)).trim(); return /^\d{4}$/.test(p)?p:""; })();
var USER_NAME = store.get('mv_name') || "";
// Weight is kept only as a single settings field — it's used to scale the
// app's built-in calorie estimates (calAdj), the same way the original app
// did. No weight *trend* tracking lives in this app; that stays in the main
// fitness tracker / Google Health.
var CURRENT_WEIGHT = parseFloat(store.get('mv_weight')) || 240;
var USER_AGE = parseInt(store.get('mv_age')) || 0;
var USER_MAXHR = parseInt(store.get('mv_maxhr')) || 0;
function dsEstMaxHR(){ if(USER_MAXHR>0) return USER_MAXHR; if(USER_AGE>0) return 220-USER_AGE; return null; }
function dsHrZone(avgHr){
  var mx=dsEstMaxHR(); if(!mx||!avgHr) return null;
  var pct=avgHr/mx*100;
  if(pct<60) return {zone:'Below Z2',pct:pct};
  if(pct<=70) return {zone:'Zone 2',pct:pct};
  if(pct<=80) return {zone:'Zone 3',pct:pct};
  if(pct<=90) return {zone:'Zone 4',pct:pct};
  return {zone:'Zone 5',pct:pct};
}

// ── DATE (local time only) ──────────────────────────────────────────────
function localDateKey(d){ d=d||new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function todayKey(){ return localDateKey(new Date()); }
function keyToDate(k){ var p=k.split("-"); return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2])); }
function prettyDate(k){ return keyToDate(k).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); }

// ── STATE ───────────────────────────────────────────────────────────────
var appData = {};
try { appData = JSON.parse(store.get("mv_data")||"{}"); } catch(e){ appData={}; }
var activeDate = todayKey();

function getDay(key){
  key = key || activeDate;
  if(!appData[key]) appData[key] = {exercises:[]};
  var d = appData[key];
  if(!d.exercises) d.exercises=[];
  return d;
}
function getBurned(){ return getDay().exercises.reduce(function(a,e){return a+(+e.calories||0);},0); }
var CAL_REF_WEIGHT = 240;
function calScale(){ var w = parseFloat(CURRENT_WEIGHT); return (w > 0) ? (w / CAL_REF_WEIGHT) : 1; }
function calAdj(c){ return Math.round((+c || 0) * calScale()); }
function isToday(){ return activeDate===todayKey(); }

// ── SAVE + AUTO-SYNC ────────────────────────────────────────────────────
var _syncTimer=null;
function saveAll(){
  try { store.set("mv_data", JSON.stringify(appData)); } catch(e){}
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(function(){ pushToSheets(); }, 8000);
}
function saveDay(day,key){ key=key||activeDate; appData[key]=day; saveAll(); }

function buildPayload(){
  // Slim payload: just exercises per day, plus the eg completion/streak map
  // and the yoga log — everything this app actually tracks.
  return {
    exercises: appData,
    workouts: (typeof loadDone==="function") ? loadDone() : {},
    yoga: (typeof ygPresetLog==="function") ? ygPresetLog() : {}
  };
}
function pushToSheets(){
  if(!SHEETS_URL) return Promise.resolve();
  return fetch(SHEETS_URL,{method:"POST",mode:"no-cors",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:"data="+encodeURIComponent(JSON.stringify(buildPayload()))}).catch(function(){});
}
function fetchSheet(onRows){
  if(!SHEETS_URL){ onRows(null,false); return; }
  fetch(SHEETS_URL).then(function(r){return r.json();}).then(function(json){
    onRows(json,true);
  }).catch(function(){ onRows(null,false); });
}
function mergeRows(json){
  try{
    if(json && json.exercises){ appData = json.exercises; store.set("mv_data", JSON.stringify(appData)); }
    if(json && json.workouts){ store.set("eg_done", JSON.stringify(json.workouts)); }
    if(json && json.yoga){ store.set("yoga_preset_log", JSON.stringify(json.yoga)); }
  }catch(e){}
}
function fetchOverloadCache(){ /* no-op in this app — kept for compatibility with ported code */ }

// ── UI helpers ──────────────────────────────────────────────────────────
function toast(msg){
  var el=document.getElementById("mv-toast");
  if(!el){ el=document.createElement("div"); el.id="mv-toast"; el.className="toast"; document.body.appendChild(el); }
  el.textContent=msg; el.classList.add("show");
  clearTimeout(toast._t); toast._t=setTimeout(function(){el.classList.remove("show");},1800);
}
function escH(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function attrId(id){ return String(id).replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

// ═══════ dsS helper (used throughout the exercise demo library) ═══════
function dsS(dur,attr,vals){return '<animate attributeName="'+attr+'" values="'+vals+'" keyTimes="0;0.5;1" dur="'+dur+'s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>';}

// ═══════ EXERCISE DEMO SVG LIBRARY (ported verbatim) ═══════

var DS_DEMOS={
  backwalk:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="126" x2="170" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;-10,0;0,0" keyTimes="0;0.5;1" dur="2.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="52" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="62" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="70" x2="84" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(2.2,'x2','84;116;84')+'</line>'+
    '<line x1="100" y1="96" x2="80" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','80;120;80')+'</line>'+
    '<line x1="100" y1="96" x2="120" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','120;80;120')+'</line>'+
    '</g></svg>';},
  tibraise:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<rect x="60" y="118" width="80" height="10" rx="2" fill="#5F5E5A"/>'+
    '<line x1="70" y1="118" x2="70" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="130" y1="118" x2="130" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="49" x2="100" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="70,90 70,72 90,66" fill="none" stroke="#4ec98a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.2,'points','70,90 70,72 90,66; 70,90 70,72 60,80; 70,90 70,72 90,66')+'</polyline>'+
    '<polyline points="130,90 130,72 110,66" fill="none" stroke="#4ec98a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.2,'points','130,90 130,72 110,66; 130,90 130,72 140,80; 130,90 130,72 110,66')+'</polyline>'+
    '</svg>';},
  kneeraise:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="112" x2="170" y2="112" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="60" cy="102" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="68" y1="106" x2="110" y2="106" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="110" y1="106" x2="150" y2="106" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="110" y1="106" x2="120" y2="70" stroke="#4ec98a" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'x2','120;96;120')+dsS(2.4,'y2','70;80;70')+'</line>'+
    '<line x1="120" y1="70" x2="120" y2="100" stroke="#4ec98a" stroke-width="4" stroke-linecap="round">'+dsS(2.4,'x1','120;96;120')+dsS(2.4,'y1','70;80;70')+dsS(2.4,'x2','120;100;120')+dsS(2.4,'y2','100;106;100')+'</line>'+
    '</svg>';},
  dip:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="70" y1="40" x2="70" y2="120" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="130" y1="40" x2="130" y2="120" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="60" y1="50" x2="80" y2="50" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="120" y1="50" x2="140" y2="50" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,20;0,0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="55" x2="100" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="60" x2="70" y2="50" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="60" x2="130" y2="50" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="86" x2="90" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="86" x2="110" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g></svg>';},
  extrot:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="122" x2="160" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="70" cy="60" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="70" y1="70" x2="70" y2="110" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="110" x2="60" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="110" x2="82" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="80" x2="98" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="98" y1="90" x2="110" y2="72" stroke="#4ec98a" stroke-width="4" stroke-linecap="round">'+dsS(2.2,'x2','110;96;110')+dsS(2.2,'y2','72;104;72')+'</line>'+
    '</svg>';},
  trap3:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="126" x2="160" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="90" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="18 90 55;18 90 55" dur="0.1s"/></g>'+
    '<line x1="90" y1="55" x2="105" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="104" x2="94" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="104" x2="118" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="98" y1="70" x2="130" y2="98" stroke="#4ec98a" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'x2','130;100;130')+dsS(2.4,'y2','98;80;98')+'</line>'+
    '</svg>';},
  nordic:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="126" x2="90" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="55" cy="118" r="8" fill="none" stroke="#5F5E5A" stroke-width="4"/>'+
    '<line x1="90" y1="126" x2="90" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 90 96;-46 90 96;0 90 96" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="90" y1="96" x2="90" y2="56" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="90" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="90" y1="66" x2="120" y2="70" stroke="#4ec98a" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  pulldown:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="172" y1="16" x2="172" y2="122" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="156" y1="30" x2="172" y2="30" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="156" cy="30" r="3" fill="#5F5E5A"/>'+
    '<line x1="30" y1="122" x2="172" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="90" y1="96" x2="90" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="120" x2="70" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="96" x2="86" y2="56" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="84" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<polyline points="86,58 108,50 132,40" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.6,'points','86,58 108,50 132,40; 86,58 104,84 94,64; 86,58 108,50 132,40')+'</polyline>'+
    '<line x1="156" y1="30" x2="132" y2="40" stroke="#4ec98a" stroke-width="3" stroke-linecap="round">'+dsS(2.6,'x2','132;94;132')+dsS(2.6,'y2','40;64;40')+'</line>'+
    '</svg>';},
  row:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="126" x2="150" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="96" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="122" y2="62" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="128" cy="54" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<polyline points="122,62 124,86 128,104" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','122,62 124,86 128,104; 122,62 140,72 120,80; 122,62 124,86 128,104')+'</polyline>'+
    '<line x1="128" y1="124" x2="128" y2="104" stroke="#4ec98a" stroke-width="3" stroke-linecap="round">'+dsS(2.4,'y2','104;80;104')+'</line>'+
    '</svg>';},
  press:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="100" y1="74" x2="100" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="64" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="108" x2="88" y2="130" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="108" x2="112" y2="130" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="86,76 80,58 84,40" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','86,76 80,90 90,80; 86,76 80,58 84,30; 86,76 80,90 90,80')+'</polyline>'+
    '<polyline points="114,76 120,58 116,40" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','114,76 120,90 110,80; 114,76 120,58 116,30; 114,76 120,90 110,80')+'</polyline>'+
    '<rect x="78" y="34" width="12" height="8" rx="2" fill="#4ec98a"><animateTransform attributeName="transform" type="translate" values="0,46;0,0;0,46" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></rect>'+
    '<rect x="110" y="34" width="12" height="8" rx="2" fill="#4ec98a"><animateTransform attributeName="transform" type="translate" values="0,46;0,0;0,46" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></rect>'+
    '</svg>';},
  pushup:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="126" x2="170" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<polyline points="156,118 110,110 74,102" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','156,118 110,110 74,102; 156,120 110,116 74,114; 156,118 110,110 74,102')+'</polyline>'+
    '<circle cx="62" cy="100" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"><animate attributeName="cy" values="100;112;100" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></circle>'+
    '<line x1="74" y1="102" x2="70" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'y1','102;114;102')+'</line>'+
    '<line x1="120" y1="124" x2="126" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</svg>';},
  squat:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,26;0,0" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="42" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="52" x2="100" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="60" x2="78" y2="52" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="60" x2="122" y2="52" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '<polyline points="100,86 84,104 86,130" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','100,86 84,104 86,130; 100,112 74,116 86,130; 100,86 84,104 86,130')+'</polyline>'+
    '<polyline points="100,86 116,104 114,130" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','100,86 116,104 114,130; 100,112 126,116 114,130; 100,86 116,104 114,130')+'</polyline>'+
    '<line x1="60" y1="132" x2="140" y2="132" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  goblet:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+'<g><animateTransform attributeName="transform" type="translate" values="0,0;0,26;0,0" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+'<circle cx="100" cy="36" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+'<line x1="100" y1="46" x2="100" y2="80" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+'<rect x="82" y="52" width="36" height="18" rx="4" fill="#5eead433" stroke="#5eead4" stroke-width="3"/>'+'<line x1="82" y1="61" x2="70" y2="61" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+'<line x1="118" y1="61" x2="130" y2="61" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+'</g>'+'<polyline points="100,80 84,100 86,128" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','100,80 84,100 86,128; 100,108 72,114 86,128; 100,80 84,100 86,128')+'</polyline>'+'<polyline points="100,80 116,100 114,128" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','100,80 116,100 114,128; 100,108 128,114 114,128; 100,80 116,100 114,128')+'</polyline>'+'<line x1="58" y1="130" x2="142" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+'</svg>';},
  hinge:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="100" y1="92" x2="100" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g transform="rotate(0 100 92)"><animateTransform attributeName="transform" type="rotate" values="0 100 92; -62 100 92; 0 100 92" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="92" x2="100" y2="40" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="30" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="54" x2="100" y2="86" stroke="#4ec98a" stroke-width="3" stroke-linecap="round"/></g>'+
    '<line x1="64" y1="130" x2="136" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  ballcurl:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="122" x2="160" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="50" cy="110" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="58" y1="113" x2="92" y2="113" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="113" x2="100" y2="84" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="100,84 134,98 162,110" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.6,'points','100,84 134,98 162,110; 100,84 120,92 116,106; 100,84 134,98 162,110')+'</polyline>'+
    '<circle cx="162" cy="110" r="10" fill="none" stroke="#c9a44a" stroke-width="3">'+dsS(2.6,'cx','162;116;162')+dsS(2.6,'cy','110;106;110')+'</circle>'+
    '</svg>';},
  bridge:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="120" x2="160" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="56" cy="106" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<polyline points="64,108 96,108 128,108" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','64,108 100,108 128,108; 64,108 100,70 128,108; 64,108 100,108 128,108')+'</polyline>'+
    '<line x1="128" y1="108" x2="128" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'y1','108;72;108')+'</line>'+
    '</svg>';},
  fly:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="100" y1="66" x2="100" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="56" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="104" x2="88" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="112" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="88,72 64,76 44,72" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','88,72 64,76 44,72; 88,72 80,74 72,72; 88,72 64,76 44,72')+'</polyline>'+
    '<polyline points="112,72 136,76 156,72" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','112,72 136,76 156,72; 112,72 120,74 128,72; 112,72 136,76 156,72')+'</polyline>'+
    '</svg>';},
  catcow:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<path d="M55 70 Q100 60 145 70" fill="none" stroke="#9a9d8c" stroke-width="6" stroke-linecap="round">'+
    '<animate attributeName="d" values="M55 70 Q100 60 145 70; M55 64 Q100 96 145 64; M55 70 Q100 60 145 70" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></path>'+
    '<circle cx="48" cy="64" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="58" y1="72" x2="58" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="142" y1="72" x2="142" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="40" y1="118" x2="160" y2="118" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  kneehug:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="34" y1="122" x2="170" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="52" cy="114" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="60" y1="116" x2="98" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="-3 98 116;3 98 116;-3 98 116" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite"/>'+
    '<line x1="98" y1="116" x2="82" y2="82" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="82" y1="82" x2="98" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="66" y1="116" x2="86" y2="88" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  nine90:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="126" x2="162" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;5,0;0,0" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="124" x2="60" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="124" x2="88" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="120" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="98" x2="120" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="88" y2="54" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="88" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="88" y1="64" x2="116" y2="96" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  ninetytransition:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<g><animateTransform attributeName="transform" type="translate" values="-12,0;12,0;-12,0" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<path d="M60 118 Q86 124 112 110" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M112 110 Q128 108 140 122" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M60 118 Q48 112 38 124" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="108" x2="100" y2="66" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="56" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="76" x2="78" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="76" x2="122" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  child:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="120" x2="162" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite"/>'+
    '<line x1="124" y1="104" x2="120" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="116" x2="148" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M124 104 Q104 100 80 113" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="98" y1="110" x2="58" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="72" cy="112" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/></g>'+
    '</svg>';},
  dragon:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="126" x2="162" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,4;0,0" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="94" y1="104" x2="70" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="124" x2="52" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="94" y1="104" x2="122" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="122" y1="108" x2="122" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="94" y1="104" x2="90" y2="62" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="89" cy="52" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="91" y1="74" x2="118" y2="100" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  caterpillar:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="120" x2="162" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite"/>'+
    '<line x1="72" y1="114" x2="142" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M72 112 Q92 102 112 110" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="104" y1="108" x2="134" y2="114" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="112" cy="110" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/></g>'+
    '</svg>';},
  twist:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="34" y1="122" x2="170" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite"/>'+
    '<circle cx="60" cy="110" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="68" y1="112" x2="112" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="112" x2="150" y2="114" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="110" x2="100" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="120" x2="118" y2="121" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="76" y1="110" x2="50" y2="106" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  legsup:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="150" y1="28" x2="150" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="34" y1="120" x2="150" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.8s" repeatCount="indefinite"/>'+
    '<circle cx="56" cy="112" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="64" y1="114" x2="120" y2="114" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="114" x2="144" y2="40" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="114" x2="66" y2="120" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  swan:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="120" x2="162" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite"/>'+
    '<line x1="102" y1="104" x2="52" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="102" y1="104" x2="124" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="124" y1="112" x2="98" y2="117" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M102 104 Q120 104 134 106" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="140" cy="106" r="7" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="126" y1="106" x2="150" y2="113" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/></g>'+
    '</svg>';},
  hollow:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="34" y1="124" x2="170" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite"/>'+
    '<path d="M58 100 Q100 120 146 96" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="54" cy="98" r="7" fill="none" stroke="#9a9d8c" stroke-width="4"/></g>'+
    '</svg>';},
  plank:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="124" x2="170" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite"/>'+
    '<line x1="78" y1="124" x2="100" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="124" x2="82" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="82" y1="100" x2="152" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="72" cy="96" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/></g>'+
    '</svg>';},
  curl:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="126" x2="140" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="38" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="47" x2="100" y2="94" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="94" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="94" x2="112" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="56" x2="86" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="56" x2="114" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="86" x2="80" y2="110" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','80;90;80')+dsS(2.2,'y2','110;64;110')+'</line>'+
    '<line x1="114" y1="86" x2="120" y2="110" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','120;110;120')+dsS(2.2,'y2','110;64;110')+'</line>'+
    '</svg>';},
  triceps:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="84" y1="14" x2="116" y2="14" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="60" y1="126" x2="140" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="42" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="51" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="112" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="60" x2="90" y2="88" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="108" y1="60" x2="110" y2="88" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="88" x2="94" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','94;88;94')+dsS(2.2,'y2','72;114;72')+'</line>'+
    '<line x1="110" y1="88" x2="106" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','106;112;106')+dsS(2.2,'y2','72;114;72')+'</line>'+
    '<line x1="100" y1="18" x2="94" y2="72" stroke="#4ec98a" stroke-width="3" stroke-linecap="round">'+dsS(2.2,'x2','94;88;94')+dsS(2.2,'y2','72;114;72')+'</line>'+
    '</svg>';},
  lateralraise:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="126" x2="140" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="42" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="51" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="112" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="58" x2="78" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'x2','78;52;78')+dsS(2.4,'y2','92;58;92')+'</line>'+
    '<line x1="110" y1="58" x2="122" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'x2','122;148;122')+dsS(2.4,'y2','92;58;92')+'</line>'+
    '</svg>';},
  calf:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="126" x2="130" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="130" y1="126" x2="130" y2="138" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="130" y1="138" x2="170" y2="138" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-12;0,0" keyTimes="0;0.5;1" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="53" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="64" x2="86" y2="92" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="108" y1="64" x2="114" y2="92" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="118" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="118" y1="120" x2="130" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="92" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/></g>'+
    '</svg>';},
  legraise:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="34" y1="120" x2="170" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="52" cy="108" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="60" y1="112" x2="104" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="104" y1="112" x2="150" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.6,'x2','150;108;150')+dsS(2.6,'y2','112;62;112')+'</line>'+
    '</svg>';},
  pallof:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="22" y1="34" x2="22" y2="122" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="22" y1="72" x2="36" y2="72" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="60" y1="124" x2="150" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="53" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="90" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="110" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="68" x2="120" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'x2','120;142;120')+'</line>'+
    '<line x1="36" y1="72" x2="120" y2="72" stroke="#4ec98a" stroke-width="3" stroke-linecap="round">'+dsS(2.4,'x2','120;142;120')+'</line>'+
    '</svg>';},
  slam:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="124" x2="140" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="48" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="57" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="112" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="60" x2="96" y2="30" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(1.8,'x2','96;94;96')+dsS(1.8,'y2','30;108;30')+'</line>'+
    '<line x1="108" y1="60" x2="104" y2="30" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(1.8,'x2','104;106;104')+dsS(1.8,'y2','30;108;30')+'</line>'+
    '<circle cx="100" cy="22" r="7" fill="#4ec98a">'+dsS(1.8,'cy','22;112;22')+'</circle>'+
    '</svg>';},
  latwalk:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="124" x2="160" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="48" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="57" x2="100" y2="88" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="62" x2="80" y2="84" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="108" y1="62" x2="120" y2="84" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="88" x2="84" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="84" y1="104" x2="84" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="88" x2="118" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x2','118;134;118')+'</line>'+
    '<line x1="118" y1="104" x2="118" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.2,'x1','118;134;118')+dsS(2.2,'x2','118;134;118')+'</line>'+
    '<line x1="84" y1="100" x2="118" y2="100" stroke="#4ec98a" stroke-width="3" stroke-linecap="round">'+dsS(2.2,'x2','118;134;118')+'</line>'+
    '</svg>';},
  stepup:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="20" y1="124" x2="180" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<rect x="122" y="100" width="48" height="24" rx="2" fill="none" stroke="#5F5E5A" stroke-width="3"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;-6,-22;0,0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="96" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="96" y1="53" x2="100" y2="94" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="94" x2="134" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="94" x2="90" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/></g>'+
    '</svg>';},
  russiantwist:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="124" x2="160" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="80" cy="74" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="84" y1="82" x2="100" y2="114" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="114" x2="132" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="132" y1="100" x2="124" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="98" x2="108" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(1.8,'x1','92;104;92')+dsS(1.8,'x2','108;120;108')+'</line>'+
    '<circle cx="100" cy="98" r="5" fill="#4ec98a">'+dsS(1.8,'cx','100;112;100')+'</circle>'+
    '</svg>';},
  woodchop:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="124" x2="140" y2="124" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="55" x2="100" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="112" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="100,64 84,52 70,44" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.2,'points','100,64 84,52 70,44; 100,64 116,84 130,98; 100,64 84,52 70,44')+'</polyline>'+
    '<circle cx="70" cy="42" r="5" fill="#4ec98a">'+dsS(2.2,'cx','70;130;70')+dsS(2.2,'cy','42;100;42')+'</circle>'+
    '</svg>';},
  deadbug:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="120" x2="172" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="56" cy="108" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="64" y1="112" x2="110" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="98" y1="112" x2="98" y2="82" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="78" y1="112" x2="60" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(2.6,'x2','60;42;60')+dsS(2.6,'y2','98;110;98')+'</line>'+
    '<polyline points="110,112 118,86 110,82" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'+
    '<line x1="110" y1="112" x2="138" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.6,'x2','138;158;138')+dsS(2.6,'y2','98;112;98')+'</line>'+
    '</svg>';},
  bicycle:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="122" x2="172" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="56" cy="110" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="64" y1="112" x2="104" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="110" x2="58" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<polyline points="104,112 112,92 96,86" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2,'points','104,112 112,92 96,86; 104,112 130,98 152,96; 104,112 112,92 96,86')+'</polyline>'+
    '<polyline points="104,112 130,98 152,96" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2,'points','104,112 130,98 152,96; 104,112 112,92 96,86; 104,112 130,98 152,96')+'</polyline>'+
    '</svg>';},
  splitsquat:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="118" y1="118" x2="160" y2="100" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,20;0,0" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="82" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="82" y1="50" x2="82" y2="80" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="82" y1="58" x2="64" y2="68" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="82" y1="58" x2="100" y2="68" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<polyline points="82,80 66,98 64,124" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','82,80 66,98 64,124; 82,104 56,108 64,124; 82,80 66,98 64,124')+'</polyline>'+
    '<polyline points="82,80 100,94 118,100" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.4,'points','82,80 100,94 118,100; 82,80 110,88 118,100; 82,80 100,94 118,100')+'</polyline>'+
    '</g>'+
    '<line x1="44" y1="126" x2="100" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  facepull:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="100" cy="42" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="52" x2="100" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<polyline points="100,60 130,70 138,46" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.2,'points','100,60 130,70 138,46; 100,60 124,52 112,40; 100,60 130,70 138,46')+'</polyline>'+
    '<polyline points="100,60 70,70 62,46" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">'+dsS(2.2,'points','100,60 70,70 62,46; 100,60 76,52 88,40; 100,60 70,70 62,46')+'</polyline>'+
    '<line x1="86" y1="100" x2="80" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="114" y1="100" x2="120" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="64" y1="130" x2="136" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  wallpushup:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="155" y1="14" x2="155" y2="140" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="25" y1="138" x2="100" y2="138" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g>'+dsS(2.4,'transform','translate(0,0); translate(12,0); translate(0,0)')+
    '<line x1="45" y1="130" x2="132" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="141" cy="64" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="132" y1="72" x2="153" y2="57" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '</svg>';},
  standcatcow:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="140" y1="70" x2="172" y2="70" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="140" y1="70" x2="140" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<path d="M60 100 Q100 90 140 70" fill="none" stroke="#9a9d8c" stroke-width="6" stroke-linecap="round">'+
    '<animate attributeName="d" values="M60 100 Q100 90 140 70; M60 96 Q100 118 140 70; M60 100 Q100 90 140 70" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></path>'+
    '<circle cx="52" cy="98" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="62" y1="104" x2="62" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="62" y1="104" x2="58" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="40" y1="130" x2="80" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  slrdl:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<g transform="rotate(0 70 92)"><animateTransform attributeName="transform" type="rotate" values="0 70 92; -55 70 92; 0 70 92" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="70" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="70" y1="50" x2="70" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="60" x2="40" y2="56" stroke="#4ec98a" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="70" y1="60" x2="100" y2="56" stroke="#4ec98a" stroke-width="3" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="70" y1="92" x2="66" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g transform="rotate(0 70 92)"><animateTransform attributeName="transform" type="rotate" values="0 70 92; 32 70 92; 0 70 92" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="92" x2="116" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="44" y1="130" x2="92" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  stand:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="100" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4">'+dsS(2.4,'cy','40;36;40')+'</circle>'+
    '<line x1="100" y1="50" x2="100" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(2.4,'y1','50;46;50')+'</line>'+
    '<line x1="100" y1="62" x2="76" y2="80" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(2.4,'y1','62;58;62')+'</line>'+
    '<line x1="100" y1="62" x2="124" y2="80" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(2.4,'y1','62;58;62')+'</line>'+
    '<line x1="100" y1="104" x2="86" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="114" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="62" y1="134" x2="138" y2="134" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  standsqueeze:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="100" cy="38" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="48" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="58" x2="80" y2="74" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="58" x2="120" y2="74" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<ellipse cx="100" cy="98" rx="20" ry="9" fill="none" stroke="#4ec98a" stroke-width="3">'+dsS(1.2,'rx','20;14;20')+'</ellipse>'+
    '<line x1="92" y1="106" x2="88" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="108" y1="106" x2="112" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="64" y1="134" x2="136" y2="134" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  figure4:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="128" y1="68" x2="160" y2="68" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="160" y1="68" x2="160" y2="100" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 100 90; -8 100 90; 0 100 90" keyTimes="0;0.5;1" dur="2.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="38" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="48" x2="100" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="58" x2="128" y2="68" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="60" x2="86" y2="78" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="90" x2="110" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="110" y1="112" x2="98" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="90" x2="132" y2="98" stroke="#4ec98a" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="132" y1="98" x2="110" y2="112" stroke="#4ec98a" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="64" y1="134" x2="120" y2="134" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  hipcircle:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="100" cy="38" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="48" x2="96" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="96" y1="92" x2="92" y2="130" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 96 92; 360 96 92" dur="2.6s" repeatCount="indefinite"/>'+
    '<line x1="96" y1="92" x2="96" y2="124" stroke="#4ec98a" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="64" y1="132" x2="128" y2="132" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  chestopen:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="60" y1="20" x2="60" y2="132" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 100 80; -28 100 80; 0 100 80" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="100" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="54" x2="100" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="62" x2="64" y2="60" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="62" x2="124" y2="80" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="100" x2="90" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="100" x2="112" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="70" y1="134" x2="140" y2="134" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  lowlunge:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="118" y1="100" x2="150" y2="100" stroke="#5F5E5A" stroke-width="4" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,8;0,0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="90" cy="42" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="90" y1="52" x2="92" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="68" x2="118" y2="100" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="92" y1="86" x2="74" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="74" y1="100" x2="68" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="86" x2="122" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="122" y1="92" x2="148" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="50" y1="130" x2="160" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  shouldercar:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<circle cx="100" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="50" x2="100" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="86" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="114" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="58" x2="86" y2="74" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 100 58; 360 100 58" dur="2.8s" repeatCount="indefinite"/>'+
    '<line x1="100" y1="58" x2="100" y2="20" stroke="#4ec98a" stroke-width="4" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="70" y1="134" x2="130" y2="134" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '</svg>';},
  deadhang:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="14" x2="150" y2="14" stroke="#5F5E5A" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="14" x2="100" y2="32" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="114" y1="14" x2="100" y2="32" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<g>'+dsS(2.4,'transform','translate(0,0); translate(0,6); translate(0,0)')+
    '<circle cx="100" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="56" x2="100" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="92" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="108" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '</svg>';},
  scappull:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="14" x2="150" y2="14" stroke="#5F5E5A" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="14" x2="100" y2="36" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="114" y1="14" x2="100" y2="36" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<g>'+dsS(1.6,'transform','translate(0,0); translate(0,10); translate(0,0)')+
    '<circle cx="100" cy="48" r="9" fill="none" stroke="#4ec98a" stroke-width="4"/>'+
    '<line x1="100" y1="58" x2="100" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="92" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="108" y2="132" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '</svg>';},
  pullneg:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="14" x2="150" y2="14" stroke="#5F5E5A" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="14" x2="100" y2="22" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="114" y1="14" x2="100" y2="22" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<g>'+dsS(3,'transform','translate(0,0); translate(0,68); translate(0,0)')+
    '<circle cx="100" cy="22" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="32" x2="100" y2="70" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="70" x2="92" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="70" x2="108" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</g>'+
    '</svg>';},
  pullband:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="14" x2="150" y2="14" stroke="#5F5E5A" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="14" x2="100" y2="30" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="114" y1="14" x2="100" y2="30" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<g>'+dsS(2,'transform','translate(0,0); translate(0,40); translate(0,0)')+
    '<circle cx="100" cy="30" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="100" y1="40" x2="100" y2="78" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="78" x2="92" y2="106" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="78" x2="108" y2="106" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M92 106 Q88 124 100 134 Q112 124 108 106" fill="none" stroke="#4ec98a" stroke-width="3.5"/>'+
    '</g>'+
    '</svg>';},
  tgu:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="130" x2="170" y2="130" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 70 120; -40 70 120; -70 70 120; -40 70 120; 0 70 120" keyTimes="0;0.3;0.5;0.7;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<circle cx="120" cy="112" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="112" y1="116" x2="70" y2="120" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="104" y1="116" x2="112" y2="76" stroke="#4ec98a" stroke-width="4" stroke-linecap="round"/>'+
    '<rect x="104" y="64" width="16" height="12" rx="2" fill="#4ec98a33" stroke="#4ec98a" stroke-width="2.5"/>'+
    '</g>'+
    '<line x1="70" y1="120" x2="46" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</svg>';},
  birddog:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="126" x2="170" y2="126" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="66" cy="70" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="74" y1="74" x2="128" y2="78" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="86" y1="76" x2="84" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="122" y1="78" x2="126" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="74" y1="74" x2="36" y2="66" stroke="#4ec98a" stroke-width="5" stroke-linecap="round">'+dsS(2.6,'y2','66;60;66')+'</line>'+
    '<line x1="128" y1="78" x2="166" y2="70" stroke="#4ec98a" stroke-width="5" stroke-linecap="round">'+dsS(2.6,'y2','70;64;70')+'</line>'+
    '</svg>';},
  sideplank:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="128" x2="170" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="60" cy="72" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="68" y1="78" x2="150" y2="112" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="74" y1="82" x2="72" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="150" y1="112" x2="166" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="76" y1="82" x2="82" y2="40" stroke="#4ec98a" stroke-width="4" stroke-linecap="round">'+dsS(2.6,'x2','82;62;82')+dsS(2.6,'y2','40;96;40')+'</line>'+
    '</svg>';},
  wristecc:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="96" x2="130" y2="96" stroke="#5F5E5A" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="96" x2="140" y2="70" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="0 140 70; -45 140 70; 0 140 70" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="140" y1="70" x2="156" y2="58" stroke="#4ec98a" stroke-width="5" stroke-linecap="round"/>'+
    '<rect x="150" y="42" width="12" height="20" rx="2" fill="#4ec98a33" stroke="#4ec98a" stroke-width="2.5"/>'+
    '</g>'+
    '</svg>';},
  hipthrust:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<rect x="30" y="76" width="34" height="50" rx="4" fill="none" stroke="#5F5E5A" stroke-width="3"/>'+
    '<line x1="30" y1="128" x2="170" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="52" cy="62" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<g><animateTransform attributeName="transform" type="rotate" values="14 64 78; 0 64 78; 14 64 78" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="64" y1="78" x2="116" y2="88" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="106" y1="86" x2="94" y2="66" stroke="#4ec98a" stroke-width="3" stroke-linecap="round"/>'+
    '</g>'+
    '<line x1="116" y1="88" x2="122" y2="106" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="122" y1="106" x2="124" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '</svg>';},
  ballrow:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="30" y1="128" x2="170" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="86" cy="104" r="22" fill="none" stroke="#5F5E5A" stroke-width="3"/>'+
    '<circle cx="60" cy="66" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="68" y1="72" x2="118" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="118" y1="90" x2="148" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="78" x2="76" y2="104" stroke="#4ec98a" stroke-width="5" stroke-linecap="round">'+dsS(2,'y2','104;84;104')+'</line>'+
    '</svg>';},
  seated:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="40" y1="122" x2="160" y2="122" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="52" r="9" fill="none" stroke="#9a9d8c" stroke-width="4">'+dsS(4,'cy','52;49;52')+'</circle>'+
    '<line x1="100" y1="62" x2="100" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(4,'y1','62;59;62')+'</line>'+
    '<path d="M100 100 Q74 104 66 116 Q82 122 100 114 Q118 122 134 116 Q126 104 100 100" fill="none" stroke="#9a9d8c" stroke-width="4" stroke-linejoin="round"/>'+
    '<line x1="100" y1="72" x2="80" y2="96" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="72" x2="120" y2="96" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '</svg>';},
  downdog:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="24" y1="128" x2="176" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="66" cy="92" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="60" y1="100" x2="46" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="72" y1="86" x2="112" y2="52" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="52" x2="150" y2="126" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+dsS(3,'x2','150;146;150')+'</line>'+
    '</svg>';},
  fold:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="50" y1="128" x2="150" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="104" y1="126" x2="104" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M104 72 Q100 46 76 52" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+
    '<animate attributeName="d" values="M104 72 Q100 46 76 52; M104 72 Q94 42 70 62; M104 72 Q100 46 76 52" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></path>'+
    '<circle cx="72" cy="60" r="9" fill="none" stroke="#9a9d8c" stroke-width="4">'+dsS(3.4,'cy','60;70;60')+'</circle>'+
    '<line x1="82" y1="58" x2="80" y2="112" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round">'+dsS(3.4,'y2','112;120;112')+'</line>'+
    '</svg>';},
  cobra:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="24" y1="120" x2="176" y2="120" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="90" y1="112" x2="170" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M90 112 Q70 100 62 76" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round">'+
    '<animate attributeName="d" values="M90 112 Q70 100 62 76; M90 112 Q66 94 56 66; M90 112 Q70 100 62 76" keyTimes="0;0.5;1" dur="3.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/></path>'+
    '<circle cx="58" cy="66" r="9" fill="none" stroke="#9a9d8c" stroke-width="4">'+dsS(3.4,'cy','66;58;66')+'</circle>'+
    '<line x1="70" y1="94" x2="66" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '</svg>';},
  savasana:function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="24" y1="112" x2="176" y2="112" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="52" cy="100" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '<line x1="62" y1="102" x2="150" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="103" x2="92" y2="110" stroke="#9a9d8c" stroke-width="3.5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="86" r="5" fill="none" stroke="#4ec98a" stroke-width="2" opacity="0.7">'+dsS(5,'r','5;12;5')+dsS(5,'opacity','0.7;0.1;0.7')+'</circle>'+
    '</svg>';}
};

var DS_DEMOMAP={"mon-curl": "curl", "mon-tri": "triceps", "mon-bike": "bicycle", "mon-legraise": "legraise", "tue-lat": "latwalk", "tue-pallof": "pallof", "tue-step": "stepup", "wed-bike": "bicycle", "wed-legraise": "legraise", "wed-slam": "slam", "wed-rotslam": "woodchop", "thu-lateral": "lateralraise", "thu-hammer": "curl", "thu-tri": "triceps", "thu-bike": "bicycle", "thu-legraise": "legraise", "thu-russian": "russiantwist", "fri-calf": "calf", "fri-obliques": "woodchop", "fri-deadbug": "deadbug"};
var DS_DEMOCAP={"backwalk": "short steps backward, land on the ball of the foot", "tibraise": "heels elevated, weight back, lift the toes", "kneeraise": "lying flat, drive one knee to the chest, slow return", "dip": "comfortable depth only — nowhere near shoulder-below-elbow", "extrot": "elbow pinned to the side — only the forearm rotates", "trap3": "arm at a 30° angle from the body — raise along that line", "nordic": "ankles locked, lower slowly, catch yourself early", "pulldown": "band anchored high — kneel facing it, pull down", "row": "no anchor — hinge forward, pull the elbow back", "press": "press straight overhead", "fly": "arms wide, then squeeze together in front", "pallof": "band from your side — press straight out, resist the twist", "latwalk": "band above the knees — step out, stay in the half-squat", "triceps": "elbows pinned — only the forearms extend down", "curl": "upper arms still — only the forearms move", "nine90": "half-kneeling, both knees at 90 — shift the hips forward", "ninetytransition": "seated, both knees at 90 — rotate hip to hip, stay tall", "kneehug": "on your back — knees hugged to the chest", "dragon": "deep low lunge, back knee down", "goblet": "weight at chest as counterbalance — sink deep, elbows brush the knees", "squat": "sit back and down, drive through the whole foot", "splitsquat": "rear foot elevated behind you — front leg does the work", "facepull": "pull to your face, elbows high and wide — not a row", "wallpushup": "hands on the wall or desk edge — lean in, press away", "standcatcow": "hands on the desk, hinge forward — round and arch through the spine", "slrdl": "one leg plants, the other extends back as you hinge — hips stay square", "stand": "feet rooted, tailbone tucked, crown of the head lifts", "standsqueeze": "squeeze both glutes hard, hold, release", "figure4": "ankle crossed over the knee, hinge forward until the hip opens", "hipcircle": "biggest slow circle the hip can make, ribs stay down", "chestopen": "forearm on the frame, rotate away — open across the chest", "lowlunge": "long stance, hands forward, sink the hips gently", "shouldercar": "biggest slow circle the shoulder can make, ribs down", "deadhang": "full grip, arms straight, shoulder blades pulled down and back", "scappull": "arms stay straight — only the shoulder blades pull down", "pullneg": "chin over the bar, then lower as slowly as you can", "pullband": "band looped under the foot, pull the chest to the bar", "tgu": "weight locked overhead the whole way — roll to elbow, to hand, to standing", "birddog": "opposite arm and leg extend — flat back, no rocking", "sideplank": "hips stacked and lifted — reach the top arm under, then back to vertical", "wristecc": "forearm supported — lower the weight slowly, use the other hand to lift it back", "hipthrust": "shoulders on the couch — hips sink low, then drive up to a flat tabletop", "ballrow": "chest on the ball — row the handle up, lower back stays out of it", "seated": "sit tall, eyes soft — breathe low into the belly", "downdog": "hips to the sky, long spine — pedal the heels", "fold": "hinge and hang heavy — soft knees, let the head go", "cobra": "press the chest forward and up — hips stay grounded", "savasana": "flat on your back, everything releases — just breathe"};

// ═══════ EXERCISE PLAN DATA (DS_SESSIONS, ported verbatim) ═══════

function dsCore(id,name,rx,cal,cue,demo){return {id:id,name:name,slot:'Core',target:'Core',equip:'Bodyweight',rx:rx,cal:cal,cue:cue,demo:demo||null,log:'setsreps',sets:3};}
var DS_WARMUP_ARMCIRCLE={id:'warmup-armcircle',name:'Arm Circles + Shoulder Rolls',demo:'shouldercar',slot:'Warm-up',target:'Shoulders · Upper Body Mobility',equip:'Bodyweight',rx:'2 min',cal:10,cue:'Small circles forward 20s, then backward 20s. Follow with big circles forward 20s, backward 20s. Finish with 10 slow shoulder rolls each direction — loosen everything before you load it.',log:'time',secs:120};
var DS_WARMUP_HIPFLOW9={id:'warmup-hipflow-9',name:'Leg Swings + Hip Openers',demo:'legswing',slot:'Warm-up',target:'Hips · SI Joint Mobility',equip:'Bodyweight',rx:'3–4 min',cal:20,cue:'Front-to-back leg swings 10/leg (hold a wall for balance), then side-to-side swings 10/leg. Finish with 90/90 hip switches or slow hip circles, 30s each direction — wake up the hips before anything loads them.',log:'time',secs:210};
var DS_WARMUP_HIPFLOW7={id:'warmup-hipflow-7',name:'Leg Swings + Hip Openers',demo:'legswing',slot:'Warm-up',target:'Hips · SI Joint Mobility',equip:'Bodyweight',rx:'5 min',cal:25,cue:'Front-to-back leg swings 12/leg, side-to-side swings 12/leg, then 90/90 hip switches for 8 reps/side and slow hip circles 30s each direction — get the hips moving before squats and deadlifts load them.',log:'time',secs:300};
var DS_WARMUP_KBHALO={id:'warmup-kbhalo',name:'KB Halo + Around-the-World',demo:'kbhalo',slot:'Warm-up',target:'Shoulders · Core',equip:'8 lb kettlebell',rx:'10/dir + 8/dir',cal:15,cue:'Halo: circle the KB close around your head, core braced. Around-the-World: pass hand to hand around your waist, reverse halfway. Keep the circle small on the right side — this is an overhead/behind-the-head path, exactly where your right shoulder history shows up.',log:'setsreps',sets:1};
var DS_WALK30={id:'post-walk',name:'Post-session Walk',demo:'walk',slot:'Cardio',target:'Zone 2 · HDL & calorie gap',equip:'None',rx:'~30 min brisk',cal:170,cue:'Brisk but easy — conversational pace. This is your main HDL lever, so consistency beats intensity here',log:'done',variants:[{name:'Rucked Walk',equip:'Loaded backpack · 15–25 lb',rx:'~30 min brisk',cal:230,cue:'Pack rides high between the shoulder blades, straps cinched tight — posture tall, no forward lean. Start ~15 lb; if the SI joint complains, drop weight, not the walk',demo:'ruck'},{name:'Interval Walk (low-impact HIIT)',equip:'None',rx:'~20 min · 1 min fast / 1–2 min easy, repeat',cal:180,cue:'Push the pace hard for 1 min — not a jog, just a fast, purposeful walk — then ease off and recover. Repeat 8–10 rounds. Same interval-training effect on visceral fat as Tabata/circuits, zero impact on the knees.',demo:'walk'}]};
var DS_RIDE20={id:'post-ride',name:'Easy Ride',demo:'ride',slot:'Cardio',target:'Zone 2 · HDL & calorie gap',equip:'Indoor recumbent bike (display dead — pace by Fitbit HR)',rx:'~25 min easy spin · Fitbit in Zone 2 (~60–70% max HR)',cal:150,cue:'Recumbent bike, no console readout — go by Fitbit heart rate instead. Keep it in Zone 2: conversational pace, not gasping. If HR creeps above Zone 2, ease off resistance rather than stopping. Zone 2 volume is what moves HDL over time',log:'done'};
var DS_ACTIVEREST={id:'active-rest',name:'Active Rest Intervals',slot:'Cardio',target:'Extra calorie burn between sets',equip:'Jump rope or light band',rx:'3–5 min total, spread across rest periods',cal:40,cue:'Light jump rope or low-resistance band work between sets — heart rate up, not a second workout',log:'done',setup:'Instead of standing still between sets, spend 3–5 min total (30–45s at a time) on light jump rope or a low-resistance band exercise. Keep it easy enough that it doesn\\u2019t eat into your strength sets — the point is extra burn, not extra fatigue.',variants:[{name:'Banded Circuit Intervals (HIIT-style)',equip:'Tube band, light resistance',rx:'20–30s hard / 30–40s rest, cycle 3–4 band moves for 10–12 min',cal:90,cue:'Pick 3–4 light-resistance moves you already know (banded squat, row, press) and cycle through them fast for 20–30s each, resting just enough to reset form. This mimics Tabata-style intervals without the jumping or impact — do it as a standalone finisher after your main lifts, not squeezed between working sets.',demo:'squat'}]};

/* ── Saturday heat alternative: indoor full-body circuit (arms/legs/core/mobility) ── */
var DS_SATHEAT_MOVES=[
  DS_WARMUP_HIPFLOW7,
  {id:'sathot-squat',name:'Banded Squat',slot:'Squat',target:'Quads · Glutes',equip:'Tube 40–50 lb',rx:'3×12–15',cal:40,cue:'Sit back and down, drive through the whole foot — knees track over the toes',demo:'squat',log:'setsreps',sets:3},
  {id:'sathot-row',name:'Bent-Over Row',slot:'Back · Biceps',target:'Back · Biceps',equip:'Tube 30–40 lb',rx:'3×10–12',cal:35,cue:'Flat back, hinge forward — elbows drive to your back pockets',demo:'row',log:'setsreps',sets:3},
  {id:'sathot-bridge',name:'Glute Bridge',demo:'bridge',slot:'Glutes',target:'Glutes · SI-Joint Friendly',equip:'Tube 30–40 lb across hips',rx:'3×15–20',cal:30,cue:'Floor-based and controlled — easy on the SI joint. Squeeze glutes hard at the top',log:'setsreps',sets:3},
  {id:'sathot-lateral',name:'Lateral Raise',demo:'lateralraise',slot:'Side Delts',target:'Side Delts',equip:'Tube 10 lb',rx:'3×12–15',cal:25,cue:'Lead with elbows, not hands — pour water from a pitcher',log:'setsreps',sets:3},
  {id:'sathot-latwalk',name:'Lateral Band Walk',slot:'Hips',target:'Hip Abductors',equip:'Mini loop band',rx:'3×12/side',cal:25,cue:'Stay low in the quarter-squat, keep tension on the band the whole way',demo:'latwalk',log:'setsreps',sets:3},
  {id:'sathot-hammer',name:'Hammer Curl',demo:'curl',slot:'Biceps',target:'Biceps · Forearms',equip:'Tube 10–20 lb',rx:'3×12–15',cal:25,cue:'Neutral grip, thumbs up — easier on the medial elbow than a straight-bar curl',log:'setsreps',sets:3},
  {id:'sathot-deadbug',name:'Dead Bug',demo:'deadbug',slot:'Core',target:'Core · SI Joint',equip:'Bodyweight',rx:'3×10/side',cal:20,cue:'Low back glued to the floor — gentle, floor-supported anti-extension work',log:'setsreps',sets:3,
    variants:[{name:'Bird Dog',equip:'Bodyweight',rx:'3×8/side',cue:'Opposite arm and leg extend, flat back, zero rocking. Swap in if Dead Bug pops your SI joint.',demo:'birddog'}]},
  {id:'sathot-squathold',name:'Deep Squat Hold',demo:'squat',slot:'Mobility',target:'Hips · Ankles',equip:'Bodyweight',rx:'Build toward 30 min',cal:15,cue:'Sink into the bottom of a squat, chest up — hold as long as feels good today',log:'time',secs:60}
];
var DS_SAT_HEAT={title:'Indoor Heat Circuit',sub:'Arms · Legs · Core · Mobility — Ride Alternative',accent:'#f97316',moves:DS_SATHEAT_MOVES};
var DS_SAT_HEAT_ON={}; try{ DS_SAT_HEAT_ON=JSON.parse(store.get("ds_sat_heat_on")||"{}"); }catch(e){ DS_SAT_HEAT_ON={}; }
function dsToggleSatHeat(){ DS_SAT_HEAT_ON[activeDate]=!DS_SAT_HEAT_ON[activeDate]; try{ store.set("ds_sat_heat_on", JSON.stringify(DS_SAT_HEAT_ON)); }catch(e){} dsRender(); }
function dsSessOf(sk){ if(sk==='sat'&&DS_SAT_HEAT_ON[activeDate])return DS_SAT_HEAT; return DS_SESSIONS[sk]; }

var DS_SESSIONS={
  mon:{title:'Upper Body Push + Pull',sub:'Chest · Shoulders · Back · Arms',accent:'var(--accent)',
    moves:[DS_WARMUP_ARMCIRCLE,DS_WARMUP_HIPFLOW9,DS_WARMUP_KBHALO,
      {id:'mon-pushup',name:'Banded Push-ups',slot:'Horizontal Push',target:'Chest · Triceps',equip:'Tube band or bodyweight',rx:'3–4×10–15',cal:35,cue:'Chest to floor, elbows 45° back — push the floor away explosively. Wrists stay stacked directly under the shoulders — if the left wrist complains from full extension, try push-up handles/blocks or a slight fist grip to keep it neutral.',demo:'pushup',log:'setsreps',sets:4,
        variants:[{name:'Wall Push-up',equip:'Bodyweight only',rx:'3×12–15',cue:'Hands on the wall, feet back — lean in and press away. Easiest regression, start here if floor push-ups aren\'t happening yet',demo:'wallpushup'},
                  {name:'Incline Push-up (counter/desk)',equip:'Bodyweight only',rx:'3×10–15',cue:'Hands on a sturdy counter or desk edge — the higher the surface, the easier. Lower the surface height as you get stronger',demo:'pushup'},
                  {name:'Knee Push-up',equip:'Bodyweight only',rx:'3×8–12',cue:'Knees down, straight line from knees to head — chest to floor, full range of motion counts more than reps',demo:'pushup'},
                  {name:'Floor DB Press',equip:'10 lb dumbbells',rx:'3×12',cue:'Lower under control, press to the ceiling',demo:'press'},
                  {name:'Banded Chest Press (anchor)',equip:'Tube 20–30 lb',rx:'3×12–15',cue:'Drive the handles together in front of your chest',demo:'press'},
                  {name:'Super Band Push-up',equip:'Ultra Heavy band across upper back',rx:'3×8–12',cue:'Band under both palms, draped across the upper back — explode off the floor against the tension',demo:'pushup'},
                  {name:'Deficit Push-up',equip:'Yoga blocks under hands + mini loop band',rx:'3×8–12',cue:'Hands elevated on blocks — chest drops below hand level for a deeper stretch before the band resists at the top',demo:'pushup'}]},
      {id:'mon-ohp',name:'Overhead Press',slot:'Vertical Push',target:'Shoulders',equip:'Tube 20–30 → 40–50 lb',rx:'3×10–12',cal:35,cue:"Press straight to the ceiling — don't let your low back arch",demo:'press',log:'setsreps',sets:3,
        variants:[{name:'DB Overhead Press',equip:'2× 10 lb dumbbells',rx:'3×12–15',cue:'Press both DBs straight up, brief squeeze at the top — control the descent',demo:'press'},{name:'Seated OHP on Stability Ball',equip:'Ball + 2\u00d7 10 lb DBs',rx:'3\u00d712',cue:'Sit tall on the ball, feet planted wide \u2014 press straight up. The ball keeps you honest: no lower-back arch possible',demo:'press'}]},
      {id:'mon-pullapart',name:'Band Pull-Apart',slot:'Rear Delts',target:'Rear Delts',equip:'Tube 10–20 lb',rx:'3×15–20',cal:25,cue:'Crack a walnut between your shoulder blades — arms stay straight',demo:'fly',log:'setsreps',sets:3},
      {id:'mon-row',name:'Bent-Over Row',slot:'Horizontal Pull',target:'Back · Biceps',equip:'Tube 30–40 → 50–70 lb',rx:'3–4×10–12',cal:35,cue:'Drive elbows into your back pockets — not hands to your chest',demo:'row',log:'setsreps',sets:4,
        variants:[{name:'Wide Row (free)',equip:'Tube 20–30 lb',rx:'3×12',cue:'Pull wide to the ribs, squeeze the mid-back',demo:'row'},
                  {name:'Chest-Supported Row (ball)',equip:'Chest on stability ball + tube band',rx:'3×12',cue:'Chest stays glued to the ball — zero lower back, all upper back',demo:'ballrow'},
                  {name:'Narrow Row',equip:'Tube 30–40 lb',rx:'3×12',cue:'Hands close, pull to the belt line — elbows brush the ribs, hits lats more than mid-back',demo:'row'}]},
      {id:'mon-curl',name:'Bicep Curl',slot:'Biceps',target:'Biceps',equip:'Tube 10–20 → 30 lb',rx:'3×12–15',cal:25,cue:'Upper arms glued to your sides — only forearms move',log:'setsreps',sets:3,
        variants:[{name:'DB Curl (neutral grip)',equip:'2× 10 lb dumbbells',rx:'3×12–15',cue:'Rotate hands slightly inward (semi-neutral, not full palms-forward) — this is the wrist-friendly angle. Curl to the shoulders, slow on the way down. Go back to full supination only if the wrist stays quiet.',demo:'curl'},
                  {name:'Iso-Hold Curl',equip:'2× 10 lb dumbbells or tube',rx:'3×10 + 5s holds',cue:'Curl up, stop and hold 5 sec at 90° halfway, then finish the rep — the hold is the exercise',demo:'curl'},
                  {name:'Forward Fold Curl',equip:'2× 10 lb dumbbells',rx:'3×10–12',cue:'Hinge forward like an RDL and hold it — curl from the hang, arms perpendicular to the floor. No swing possible',demo:'curl'},
                  {name:'Bayesian Curl (low anchor)',equip:'Tube 10–20 lb · low anchor',rx:'3×10–12',cue:'Face away from a low door anchor, arm trailing slightly behind your torso. This keeps peak tension on the bicep right at the bottom, where a standing curl normally goes slack.',demo:'curl'},
                  {name:'Wall-Braced Curl (short head)',equip:'Tube 10–20 lb',rx:'3×10–12',cue:'⚠️ Elbow flag — start light. Brace your upper arm against a wall or chair back to lock the elbow in place. Curl slowly, turn pinkies up at the top. Stop if you feel medial elbow ache.',demo:'curl'},
                  {name:'Reverse Curl (brachialis/forearms)',equip:'Tube 10–20 lb',rx:'3×12–15',cue:'⚠️ Elbow flag — start light. Overhand/pronated grip (palms down), elbows pinned to your sides — curl up without letting the wrists break. Builds arm width and forearm thickness, but the pronated grip loads the elbow more than a standard curl. Don\\u2019t stack this with the Wall-Braced Curl in the same week.',demo:'curl'}]},
      {id:'mon-tri',name:'Triceps Pushdown',slot:'Triceps',target:'Triceps',equip:'Tube 10–20 → 30 lb',rx:'3×12–15',cal:25,cue:'Elbows pinned to ribs — only forearms move',log:'setsreps',sets:3,
        variants:[{name:'DB Kickbacks',equip:'2× 10 lb dumbbells',rx:'3×12/arm',cue:'Hinge forward, upper arm locked parallel to the floor — extend back and squeeze 1 sec at lockout',demo:'triceps'},{name:'DB Overhead Triceps Extension',equip:'1\u00d7 10 lb dumbbell (both hands) or 2\u00d7 2 lb',rx:'3\u00d712\u201315',cue:'Hold the DB overhead with both hands, upper arms vertical and close to your ears \u2014 lower it behind your head by bending only the elbows until you feel a deep stretch, then extend back to lockout. Brace your core so your lower back doesn\u2019t arch. Start light \u2014 stop if you feel any pull on the inside of the elbow.',demo:'triceps'}]},
      {id:'mon-inclinepress',name:'Banded Incline Press',slot:'Chest',target:'Chest · Upper Chest',equip:'Tube 20–30 lb · low anchor',rx:'3×10–12',cal:30,cue:'Anchor low behind you, press up and out at an incline angle — squeeze the upper chest at the top',demo:'press',log:'setsreps',sets:3,variants:[{name:'Ball DB Chest Press',equip:'Ball + 2\u00d7 10 lb DBs',rx:'3\u00d712\u201315',cue:'Upper back on the ball, hips bridged up in line with your shoulders and knees (like a supported bench) \u2014 press both DBs straight up over your chest, lower until elbows are just below the ball line for a deep stretch, press back up. Keep hips locked \u2014 don\u2019t let them drop as you fatigue.',demo:'press'}]},
      {id:'mon-calf',name:'Standing Calf Raise',slot:'Calves',target:'Calves',equip:'Bodyweight or step edge',rx:'3×15–20',cal:15,cue:'Rise onto the toes, 2-sec squeeze at the top, slow controlled lower',demo:'calf',log:'setsreps',sets:3},
      {id:'mon-hollow',name:'Hollow Body Hold',slot:'Core',target:'Core',equip:'Bodyweight',rx:'2×30s holds',cal:20,cue:'Press low back into floor, ribs down — one rigid curved line',demo:'hollow',log:'time',secs:30,sets:2},
      dsCore('mon-bike','Bicycle Crunch','1×12 total (alternating)',20,'Rotate from the ribcage — slow, 2 sec each side'),
      dsCore('mon-legraise','Leg Raise','1×10–12',20,'Low back stays flat — lower only as far as it stays down'),
      {id:'mon-slamskull',name:'Slam Ball Skull Crusher (supine)',slot:'Triceps',target:'Triceps',equip:'Slam ball',rx:'3×6–8',cal:20,cue:'⚠️ Elbow + control flag — lie on your back, arms straight up holding the ball overhead. Bend only the elbows to lower the ball toward your forehead, then press back to lockout. Use your lightest ball, stop the set the moment you feel any elbow pull, and check in on elbow status the next day before adding reps.',log:'setsreps',sets:3},
      {id:'mon-ballpullover',name:'Straight-Arm Ball Pullover',slot:'Back',target:'Lats · Core · Serratus',equip:'Slam ball',rx:'3×10–12',cal:20,cue:'Lie on your back, arms straight up holding the ball overhead. Keeping arms straight (elbows soft, not locked), lower the ball in an arc back toward the floor behind your head, then pull back to the start. No elbow bend — the arc stays behind you, never toward your face.',log:'setsreps',sets:3},
      DS_WALK30,DS_RIDE20,DS_ACTIVEREST]},

  tue:{title:'Lower Body + Core',sub:'Quads · Hamstrings · Glutes · Core',accent:'var(--accent)',
    moves:[DS_WARMUP_ARMCIRCLE,DS_WARMUP_HIPFLOW7,
      {id:'tue-squat',name:'Banded Squat',slot:'Squat',target:'Quads · Glutes',equip:'Clench mini loop above knees',rx:'4×12–15',cal:40,cue:'Mini loop above the knees — sit back and down, knees push out against the band',demo:'squat',log:'setsreps',sets:4,
        variants:[{name:'Goblet Squat',equip:'10 lb dumbbell',rx:'4×15–20',cue:'Hold the DB at your chest — sit back, elbows brush inside the knees',demo:'goblet'},
                  {name:'Long-Length Partial Squat',equip:'Mini loop above knees or bodyweight',rx:'3×15–20',cue:'Drop to the bottom of the squat, then only rise about halfway before sinking back down — never straighten up. Stay loaded in the deep stretch the whole set; quads burn fast.',demo:'squat'},{name:'Ball Wall Squat',equip:'Stability ball against wall',rx:'3\u00d715',cue:'Ball in the low back against the wall \u2014 roll down to parallel, drive up through the heels. Very SI-friendly',demo:'squat'}]},
      {id:'tue-rdl',name:'Romanian Deadlift',slot:'Hinge',target:'Hamstrings',equip:'Tube 40–50 → 90+ lb',rx:'3–4×10–12',cal:35,cue:'Push hips back to the wall — handles glued to your legs',demo:'hinge',log:'setsreps',sets:4,
        variants:[{name:'Single-Leg DB RDL',equip:'10 lb dumbbell (opposite hand)',rx:'3×10–12/leg',cue:'Hinge forward, DB toward the floor as the free leg extends behind you — hips stay square',demo:'slrdl'},
                  {name:'Super Band RDL',equip:'Ultra Heavy band underfoot',rx:'3–4×8–10',cue:'Stand on the band, hinge back — tension peaks at lockout, squeeze the glutes hard at the top',demo:'hinge'}]},
      {id:'tue-lat',name:'Banded Lateral Walk',demo:'latwalk',slot:'Abductors',target:'Hip Abductors',equip:'Mini loop above knees',rx:'3×12/side',cal:25,cue:"Stay in the quarter squat — don't stand up between steps",log:'setsreps',sets:3},
      {id:'tue-bridge',name:'Banded Glute Bridge',slot:'Glutes',target:'Glutes',equip:'Tube 30–40 → 50+ lb',rx:'3×15–20',cal:30,cue:'Drive through heels, squeeze hard at the top — hold 2 sec',demo:'bridge',log:'setsreps',sets:3,
        variants:[{name:'Banded Hip Thrust',equip:'Shoulders on couch + tube band over hips',rx:'3×12–15',cue:'Upper back on the couch edge — hips sink below the seat, then drive to a flat tabletop and squeeze 2 sec',demo:'hipthrust'},{name:'Feet-on-Ball Glute Bridge',equip:'Stability ball',rx:'3\u00d712',cue:'Heels on the ball, bridge up and hold the ball dead still \u2014 glutes and hamstrings work double',demo:'bridge'}]},
      {id:'tue-ballcurl',name:'Stability Ball Leg Curl',slot:'Knee Flexion',target:'Hamstrings',equip:'Stability ball',rx:'3×10–12',cal:30,cue:'Bridge up, curl the ball to your glutes — hips stay high the whole set',demo:'ballcurl',log:'setsreps',sets:3,variants:[{name:'Single-Leg Ball Curl',equip:'Stability ball',rx:'3\u00d76\u20138/leg',cue:'Same drill, one heel on the ball \u2014 hips level, no rolling side to side',demo:'ballcurl'}]},
      {id:'tue-pallof',name:'Banded Pallof Press',demo:'pallof',slot:'Anti-Rotation',target:'Core',equip:'Tube 10–20 → 30 lb',rx:'3×10/side',cal:25,cue:'Press out and resist the rotation — hips and shoulders square',log:'setsreps',sets:3},
      {id:'tue-jump',name:'Jump Squat',slot:'Power',target:'Quads · Glutes',equip:'Bodyweight',rx:'3×10',cal:30,cue:'Land softly — toes first, knees bend to absorb',demo:'squat',log:'setsreps',sets:3,variants:[{name:'Squat to Calf Raise',equip:'Tube 30\u201340 lb',rx:'3\u00d712',cue:'Zero-impact power swap \u2014 squat, drive up, finish tall on the toes with a 1-sec squeeze',demo:'squat'}]},
      {id:'tue-step',name:'Step-Up',demo:'stepup',slot:'Unilateral',target:'Quads · Balance',equip:'Chair or step',rx:'3×10/side',cal:30,cue:"Drive through the front heel only — don't push off the back foot",log:'setsreps',sets:3},
      {id:'tue-calf',name:'Standing Calf Raise',slot:'Calves',target:'Calves',equip:'Tube 20–30 lb or bodyweight',rx:'4×15–20',cal:20,cue:'Full stretch at the bottom, 2-sec squeeze at the top — slow tempo builds the calf best',demo:'calf',log:'setsreps',sets:4},
      DS_WALK30,DS_RIDE20,DS_ACTIVEREST]},

  wed:{title:'Wednesday Yoga Flow',sub:'Full-body mobility · no bands · Charlie Follows + Moves',accent:'var(--purple)',
    moves:[
      {id:'wed-flow-center',name:'Seated Centering Breath',slot:'Flow · 1',target:'Breath · Nervous System',equip:'Mat',rx:'2 min',cal:5,cue:'Sit tall, eyes closed — inhale 4 counts, exhale 6. Let the exhale set the pace for the whole flow',demo:'seated',log:'time',secs:120},
      {id:'wed-flow-catcow',name:'Cat-Cow — breath-led',slot:'Flow · 2',target:'Spine',equip:'Mat',rx:'2 min',cal:8,cue:'Inhale arch, exhale round — the breath moves you, not the other way around. Ease onto hands and knees from your seated breath',demo:'catcow',log:'time',secs:120},
      {id:'wed-flow-birddog',name:'Bird Dog — slow flow',slot:'Flow · 3',target:'Core · SI Stability',equip:'Mat',rx:'6/side',cal:10,cue:'Exhale extend, inhale return — flat back, zero rocking. Stay right where Cat-Cow left you, on hands and knees',demo:'birddog',log:'setsreps',sets:1},
      {id:'wed-flow-child',name:'Child\'s Pose — side reaches',slot:'Flow · 4',target:'Lats · Low Back',equip:'Mat',rx:'90s',cal:5,cue:'Hips to heels, walk the hands right and hold 3 breaths, then left. Sit back from tabletop into this',demo:'child',log:'time',secs:90},
      {id:'wed-flow-downdog',name:'Downward Dog — pedal out',slot:'Flow · 5',target:'Posterior Chain · Shoulders',equip:'Mat',rx:'2 min',cal:10,cue:'Hips high, spine long — bend one knee then the other, pedaling the heels. Press up from Child\'s Pose into this',demo:'downdog',log:'time',secs:120},
      {id:'wed-flow-dragon',name:'Dragon — Low Lunge',slot:'Flow · 6',target:'Hip Flexors',equip:'Mat · yoga blocks',rx:'90s/side',cal:10,cue:'Back knee down, sink the hips forward — blocks under hands if the floor is far. Step one foot forward from Downward Dog',demo:'dragon',log:'time',secs:180},
      {id:'wed-flow-cobra',name:'Cobra — gentle backbend',slot:'Flow · 7',target:'Spine · Chest',equip:'Mat',rx:'90s',cal:6,cue:'Press the chest forward and up, hips glued to the mat — low back stays comfortable. Lower down from Dragon onto your belly',demo:'cobra',log:'time',secs:90},
      {id:'wed-flow-fold',name:'Standing Forward Fold',slot:'Flow · 8',target:'Hamstrings · Spine',equip:'Mat',rx:'90s',cal:5,cue:'Soft knees, hang heavy — grab opposite elbows and sway gently. Push back through Downward Dog, then walk your feet up to standing',demo:'fold',log:'time',secs:90},
      {id:'wed-flow-swan',name:'Sleeping Swan',slot:'Flow · 9',target:'Glutes · Deep Hip',equip:'Mat · block under hip',rx:'2 min/side',cal:10,cue:'Front shin angled, fold over it — block under the hip keeps the pelvis square. Fold your knees and sit down from standing into this',demo:'swan',log:'time',secs:240},
      {id:'wed-flow-cat',name:'Caterpillar — seated fold',slot:'Flow · 10',target:'Hamstrings · Spine',equip:'Mat',rx:'2 min',cal:6,cue:'Round forward and hang — this is yin, let gravity do the work. Straighten your legs out from Swan into this',demo:'caterpillar',log:'time',secs:120},
      {id:'wed-flow-twist',name:'Supine Twist',slot:'Flow · 11',target:'Spine · Obliques',equip:'Mat',rx:'90s/side',cal:6,cue:'Knees drop gently to one side, both shoulders stay down — easy does it with the SI. Roll onto your back from Caterpillar',demo:'twist',log:'time',secs:180},
      {id:'wed-flow-bridge',name:'Slow Bridge Rolls',slot:'Flow · 12',target:'Spine · Glutes',equip:'Mat',rx:'90s',cal:8,cue:'Roll up one vertebra at a time on the inhale, melt down on the exhale. Center back onto your spine from the twist',demo:'bridge',log:'time',secs:90},
      {id:'wed-flow-legsup',name:'Legs Up the Wall',slot:'Flow · 13',target:'Recovery · Circulation',equip:'Wall',rx:'3 min',cal:5,cue:'Hips close to the wall, arms wide — total surrender. Scoot to the wall and swing your legs up from lying down',demo:'legsup',log:'time',secs:180},
      {id:'wed-flow-sav',name:'Savasana',slot:'Flow · 14',target:'Integration',equip:'Mat',rx:'3 min',cal:3,cue:'Flat on your back, let everything go — the pose where the practice lands. Lower your legs down from the wall into this',demo:'savasana',log:'time',secs:180},
      {id:'wed-flow-extcars',name:'Extended Flow — Hip + Shoulder CARs',slot:'Flow · 15 (add-on)',target:'Joint Health · Mobility',equip:'Mat',rx:'5–8 min',cal:15,cue:'Slow, controlled circles — quality over range. This is the stretch of the practice, not a new one',demo:'catcow',log:'time',secs:360,setup:'Extra add-on beyond the core 14-pose flow: a few slow hip CARs (controlled articular rotations) and shoulder CARs, standing or on hands and knees. Move to the edge of range without forcing it — this is what bumps the daily practice from ~20 min to ~25–30 min.'},
      {id:'wed-hollow',name:'Hollow Hold — breath focus',slot:'Core',target:'Full Core',equip:'Bodyweight',rx:'2×30s',cal:20,cue:'Exhale everything out, ribs down — hold the compression',demo:'hollow',log:'time',secs:30,
        variants:[{name:'Bent-Knee Hollow Hold',equip:'Bodyweight',rx:'2×30s',cue:'Same exhale-and-press-flat cue, but knees bent and lifted instead of legs straight — much less pull on the low back/hip flexors',demo:'hollow'}]},
      {id:'wed-bike',name:'Slow Bicycle Crunch',demo:'bicycle',slot:'Core',target:'Obliques',equip:'Bodyweight',rx:'2×8/side',cal:18,cue:'Rotate from the ribcage — 2 full seconds each way',log:'setsreps',sets:2,
        variants:[{name:'Heel Taps',equip:'Bodyweight',rx:'2×10/side',cue:'Knees bent, feet up, lower back flat — tap one heel to the floor at a time, no rotation, no crunch-up',demo:'legraise'}]},
      {id:'wed-legraise',name:'Leg Raise — slow descent',demo:'legraise',slot:'Core',target:'Lower Abs',equip:'Bodyweight',rx:'2×8',cal:18,cue:'3 seconds down — low back stays flat the whole time',log:'setsreps',sets:2,
        variants:[{name:'Bent-Knee Leg Lower',equip:'Bodyweight',rx:'2×8',cue:'Same slow 3-count lower, but knees bent to 90° — shorter lever means far less low-back strain',demo:'legraise'}]},
      {id:'wed-tgu',name:'Turkish Get-Up',slot:'Full Body',target:'Core · Shoulder Stability',equip:'8 lb kettlebell',rx:'2×3/side',cal:30,cue:'Eye stays on the weight the whole time — slow, one step at a time',demo:'tgu',log:'setsreps',sets:2,
        variants:[{name:'Half Get-Up',equip:'8 lb kettlebell',rx:'2×4/side',cue:'Same setup, but only rise to your propped-up elbow and back down — skip the full stand. Same shoulder stability work, much lower coordination demand',demo:'tgu'}]},
      {id:'wed-slam',name:'Ball Slam',demo:'slam',slot:'Power',target:'Full Body',equip:'10 lb slam ball',rx:'3×10',cal:35,cue:'Full reach overhead first — drive the ball through the floor',log:'setsreps',sets:3,
        variants:[{name:'Overhead Reach to Squat',equip:'10 lb slam ball',rx:'3×10',cue:'Reach the ball fully overhead, then squat down and set it on the floor under control — same full-body pattern, zero impact',demo:'squat'}]},
      {id:'wed-rotslam',name:'Rotational Slam',demo:'slam',slot:'Power',target:'Obliques',equip:'10 lb slam ball',rx:'3×8/side',cal:30,cue:'Hips lead the rotation — arms just guide it',log:'setsreps',sets:3,
        variants:[{name:'Standing Pallof Rotation',equip:'Tube 10–20 lb · anchor to one side',rx:'3×8/side',cue:'Hold at your chest, rotate slowly toward the anchor and back — same oblique pattern as the slam, no ballistic force at all',demo:'pallof'}]},
      {id:'wed-fin-splitsquat',name:'Bodyweight Bulgarian Split Squat',slot:'Finisher · Quads',target:'Quads · Balance',equip:'Bodyweight (chair/couch)',rx:'3×10/leg',cal:20,cue:'Rear foot elevated on a couch or chair — front heel drives through the floor, torso stays tall',demo:'splitsquat',log:'setsreps',sets:3,
        setup:'No band needed here — this is a light finisher, not a heavy set. Stand about 2 feet in front of a couch or chair, rear foot up on it (laces down). Lower slowly until your front thigh is close to parallel, then drive back up through the front heel. Keep it controlled; this is about closing a volume gap, not adding fatigue.'},
      {id:'wed-fin-glutebridge',name:'Single-Leg Glute Bridge',slot:'Finisher · Hamstrings/Glutes',target:'Hamstrings · Glutes',equip:'Bodyweight',rx:'3×10/leg',cal:15,cue:'Drive through the planted heel, hips stay square — squeeze 2 seconds at the top',demo:'bridge',log:'setsreps',sets:3,
        setup:'Lie on your back, one foot flat on the floor, the other leg extended straight up or held at 90°. Push through the planted heel to lift your hips until your body forms a straight line knee to shoulder. Keep both hips level — no rotating toward the lifted leg.'},
      {id:'wed-fin-slrdl',name:'Single-Leg RDL Reach (bodyweight)',slot:'Finisher · Hamstrings',target:'Hamstrings · Balance',equip:'Bodyweight',rx:'3×8/leg',cal:15,cue:'Hinge at the hip and reach toward the floor, planted knee soft — flat back the whole way down',demo:'slrdl',log:'setsreps',sets:3,
        setup:'Stand on one leg with a soft bend in the knee. Hinge forward at the hips, letting the free leg extend straight back for balance, and reach toward the floor with the opposite hand. Keep your back flat — stop the descent wherever your hamstring or balance limits you. Slow and controlled beats going deep.'},
      {id:'wed-fin-wallsit',name:'Wall Sit',slot:'Finisher · Quads (isometric)',target:'Quads',equip:'Bodyweight + wall',rx:'2×30–45s',cal:12,cue:'Back flat against the wall, knees near 90° — no spinal loading, just hold and breathe',demo:'squat',log:'time',secs:30,
        setup:'Slide your back down a wall until your knees are bent to roughly 90 degrees, thighs close to parallel with the floor. Hold, keeping your back flat against the wall and breathing steadily. Zero impact and zero spinal load — a good pick specifically because it\'s easy on the SI joint while still building quad endurance.'},
      DS_WALK30]},

  thu:{title:'Upper Body Hypertrophy',sub:'Chest · Back · Shoulders · Arms',accent:'var(--accent)',
    moves:[DS_WARMUP_ARMCIRCLE,DS_WARMUP_HIPFLOW9,DS_WARMUP_KBHALO,
      {id:'thu-chest',name:'Chest — Pull-Apart / Fly',slot:'Horizontal Push',target:'Chest · Rear Delts',equip:'Tube 10–20 → 30 lb',rx:'4×12–15',cal:35,cue:'Hug a big tree — slight elbow bend, feel the stretch open across your chest',demo:'fly',log:'setsreps',sets:4,
        variants:[{name:'Banded Push-up',equip:'Bodyweight / tube',rx:'3×12',cue:'Chest to floor, push the floor away',demo:'pushup'},
                  {name:'Floor DB Press',equip:'10 lb dumbbells',rx:'3×12',cue:'Press to the ceiling, control the lower',demo:'press'},
                  {name:'Low-Anchor Stretch Fly',equip:'Tube 10–20 lb · low anchor',rx:'3×12–15',cue:'Anchor low instead of mid-chest. Face away, step forward for a deep starting stretch, then fly bottom-to-top across your body',demo:'fly'}]},
      {id:'thu-facepull',name:'Rear Delts / Face Pull',slot:'Rear Delts',target:'Rear Delts · Traps',equip:'Tube 10–20 → 30 lb',rx:'3–4×15–20',cal:30,cue:'Pull to your temples, elbows high — thumbs point behind you at the finish',demo:'facepull',log:'setsreps',sets:4,
        variants:[{name:'Cross-Body Rear Delt Fly',equip:'Tube 10–20 lb · chest-height anchor',rx:'3×12–15',cue:'Anchor at chest height, reach the working arm all the way across your body toward the anchor for a deep pre-stretch, then sweep it out and back — rear delt only, no shrugging',demo:'fly'}]},
      {id:'thu-lat',name:'Lats / Pulldown',slot:'Vertical Pull',target:'Lats · Back',equip:'Tube 20–30 → 50 lb',rx:'3–4×10–12',cal:35,cue:'Drive elbows into your back pockets — chest up, slight lean back',demo:'pulldown',log:'setsreps',sets:4,
        variants:[{name:'Wide Row (free)',equip:'Tube 20–30 lb',rx:'3×12',cue:'Pull wide to the ribs, squeeze the mid-back',demo:'row'},
                  {name:'Deep-Stretch Pulldown',equip:'Tube 20–30 lb · high anchor',rx:'3×10–12',cue:'Kneel farther back from the anchor than usual for a longer overhead starting stretch before pulling down',demo:'pulldown'}]},
      {id:'thu-lateral',name:'Lateral Raise',demo:'lateralraise',slot:'Side Delts',target:'Side Delts',equip:'Tube 10 → 20 lb',rx:'3×12–15',cal:25,cue:'Lead with elbows, not hands — pour water from a pitcher',log:'setsreps',sets:3,
        variants:[{name:'Front-Angled Lateral Raise',equip:'Tube 10 lb · anchored low in front of you',rx:'3×12–15',cue:'Stand on the band so it pulls slightly from in front rather than straight down — this loads the side delt earlier, right at the stretched bottom position',demo:'lateralraise'},{name:'Incline Ball Lateral Raise',equip:'Ball + 2× 10 lb dumbbells (or 2 lb to start)',rx:'3×12–15',cue:'Lie chest-down on the ball at an incline, feet braced on the floor behind you — raise both DBs out to your sides leading with the elbows, control the lower for a deep stretch at the bottom. The ball locks your torso still so the delt does all the work instead of momentum.',demo:'lateralraise'}]},
      {id:'thu-hammer',name:'Hammer Curl',slot:'Biceps',target:'Biceps · Forearms',equip:'Tube 10–20 → 30 lb',rx:'3×12–15',cal:25,cue:'Thumbs up the whole time — slow and controlled on the way down. Neutral grip is easier on the medial elbow than supinated curls, so this is the one to progress heaviest — go up one band step at a time.',log:'setsreps',sets:3,
        variants:[{name:'DB Hammer Curl',equip:'2× 10 lb dumbbells',rx:'3×12–15',cue:'Neutral grip, thumbs up — curl both DBs together or alternate',demo:'curl'}]},
      {id:'thu-inclinecurl',name:'Stability Ball Incline Curl (long head)',slot:'Biceps',target:'Biceps — Long Head',equip:'Stability ball tilted + tube band, low anchor',rx:'3×6–10',cal:20,cue:'⚠️ Highest elbow caution — lie back on the ball at an incline, arms hanging behind your torso line, curl from a deep stretch. Start with a light band or no band at all the first session. Stop immediately if elbow soreness lingers past 24h. Trial on a separate week from wall-braced curls so you know which one caused any flare-up.',demo:'curl',log:'setsreps',sets:3,variants:[{name:'DB Incline Curl on Ball',equip:'Ball + 2\u00d7 10 lb DBs',rx:'3\u00d710\u201312',cue:'Lean back over the ball so the arms hang behind the torso \u2014 curl from that deep stretch, slow negatives. Full supination (palms up) targets the long head best, but if your left wrist pops, rotate hands slightly inward toward neutral \u2014 same fix as your standing curl.',demo:'curl'},{name:'Ball Preacher Curl',equip:'Ball + 2\u00d7 10 lb DBs',rx:'3\u00d710\u201312',cue:'Kneel behind the ball, drape the back of your upper arm over the front at a downward angle (not flat on top) \u2014 let the arm hang almost straight at the bottom, curl up, squeeze 1 sec, then 3-sec slow lower. Keep the wrist neutral, straight in line with the forearm — if it still pops, back off from full palms-up toward a slight inward angle.',demo:'curl'}]},
      {id:'thu-tri',name:'Triceps Pushdown',demo:'triceps',slot:'Triceps',target:'Triceps',equip:'Tube 10–20 → 30 lb',rx:'3×12–15',cal:25,cue:'Elbows pinned to ribs — only forearms move',log:'setsreps',sets:3,variants:[{name:'DB Kickbacks',equip:'2\u00d7 10 lb dumbbells',rx:'3\u00d712/arm',cue:'Hinge forward, upper arm locked parallel to the floor \u2014 extend and squeeze 1 sec at lockout',demo:'triceps'},{name:'Overhead Band Extension',equip:'Tube 10\u201320 lb \u00b7 low anchor',rx:'3\u00d712\u201315',cue:'Elbows by the ears, forearms only \u2014 the deep stretch at the bottom is the point',demo:'triceps'},{name:'Ball Skull Crusher',equip:'Ball + 1\u00d7 10 lb DB (or 2\u00d7 2 lb)',rx:'3\u00d710\u201312',cue:'Upper back/shoulders on the ball, hips bridged up like a supported bench \u2014 hold the DB(s) straight overhead, bend only at the elbow to lower toward your forehead, then extend back up. Upper arms stay vertical and still the whole time; keep hips level, don\u2019t let them sag.',demo:'triceps'},{name:'DB Overhead Triceps Extension',equip:'1\u00d7 10 lb dumbbell (both hands) or 2\u00d7 2 lb',rx:'3\u00d712\u201315',cue:'Hold the DB overhead with both hands, upper arms vertical and close to your ears \u2014 lower it behind your head by bending only the elbows until you feel a deep stretch, then extend back to lockout. Brace your core so your lower back doesn\u2019t arch. Start light \u2014 stop if you feel any pull on the inside of the elbow.',demo:'triceps'}]},
      {id:'thu-hollow',name:'Hollow Body Hold',slot:'Core',target:'Core',equip:'Bodyweight',rx:'2×30s holds',cal:20,cue:'Press low back into floor, ribs down — one rigid curved line',demo:'hollow',log:'time',secs:30,sets:2},
      dsCore('thu-bike','Bicycle Crunch','1×12 total (alternating)',20,'Rotate from the ribcage — slow, 2 sec each side'),
      dsCore('thu-legraise','Leg Raise','1×10–12',20,'Low back stays flat — lower only as far as it stays down'),
      dsCore('thu-russian','Russian Twist','1×10/side',20,'Rotate the ribcage — slow and controlled, not a swing. Keep the range small if you feel anything near the SI joint; this is a rotational load like the Friday woodchop.'),
      {id:'thu-slamskull',name:'Slam Ball Skull Crusher (supine)',slot:'Triceps',target:'Triceps',equip:'Slam ball',rx:'3×6–8',cal:20,cue:'⚠️ Elbow + control flag — lie on your back, arms straight up holding the ball overhead. Bend only the elbows to lower the ball toward your forehead, then press back to lockout. Use your lightest ball, stop the set the moment you feel any elbow pull, and check in on elbow status the next day before adding reps.',log:'setsreps',sets:3},
      {id:'thu-ballpullover',name:'Straight-Arm Ball Pullover',slot:'Back',target:'Lats · Core · Serratus',equip:'Slam ball',rx:'3×10–12',cal:20,cue:'Lie on your back, arms straight up holding the ball overhead. Keeping arms straight (elbows soft, not locked), lower the ball in an arc back toward the floor behind your head, then pull back to the start. No elbow bend — the arc stays behind you, never toward your face.',log:'setsreps',sets:3},
      DS_WALK30,DS_RIDE20,DS_ACTIVEREST]},

  fri:{title:'Lower Body + Core Strength',sub:'Quads · Hamstrings · Glutes · Core',accent:'var(--accent)',
    moves:[DS_WARMUP_ARMCIRCLE,DS_WARMUP_HIPFLOW7,
      {id:'fri-bulg',name:'Banded Bulgarian Split Squat',slot:'Unilateral Squat',target:'Quads · Balance',equip:'Tube 20–30 → 40–50 lb',rx:'3×10/leg',cal:40,cue:'Front heel drives through the floor — torso stays tall',demo:'splitsquat',log:'setsreps',sets:3,variants:[{name:'Banded Reverse Lunge',equip:'Tube 20\u201330 lb',rx:'3\u00d710/leg',cue:'Step back, drop the knee, drive through the front heel \u2014 easier to balance than Bulgarians, same quad work',demo:'splitsquat'}]},
      {id:'fri-sumo',name:'Banded Sumo Squat',slot:'Squat',target:'Inner Thigh · Glutes',equip:'Tube 40–50 lb stacked',rx:'3×12–15',cal:35,cue:'Wide stance, toes out, knees push out — sit straight down',demo:'squat',log:'setsreps',sets:3,variants:[{name:'Goblet Sumo Squat',equip:'10 lb dumbbell',rx:'3\u00d715\u201320',cue:'DB at the chest, wide stance \u2014 sit straight down between the knees',demo:'goblet'}]},
      {id:'fri-slrdl',name:'Single-Leg RDL',slot:'Hinge · Unilateral',target:'Hamstrings',equip:'10 lb dumbbell (opposite hand)',rx:'3×10–12/leg',cal:30,cue:'Hinge forward, DB toward the floor as the free leg extends behind — hips stay square, slow 3-count down',demo:'slrdl',log:'setsreps',sets:3,
        variants:[{name:'Banded RDL — Bilateral',equip:'Tube 40–50 lb',rx:'3×10–12',cue:'Stand on the tube, soft knees, push hips straight back — flat back, handles tracing down the thighs. Easier balance day than single-leg, same hamstring stretch',demo:'hinge'}],
        setup:'Stand on one leg with a soft bend in the knee, holding the dumbbell in the hand opposite your standing leg. Hinge at the hips, letting the free leg extend straight back for counterbalance, and lower the weight toward the floor. Keep your back flat and hips square to the floor throughout \u2014 stop wherever your hamstring or balance limits you. This is gentler on the SI joint than a bilateral RDL since there\'s no spinal loading from a barbell-style hold, and it directly targets the hamstring/quad volume gap.'},
      {id:'fri-goodmorning',name:'Banded Good Morning',slot:'Hip Hinge · Posterior Chain',target:'Hamstrings · Glutes · Lower Back',equip:'Tube 30–40 → 50+ lb',rx:'3×12–15',cal:35,demo:'hinge',cue:'Hips back, flat back — squeeze glutes hard to stand up',log:'setsreps',sets:3,
        setup:'Stand on the center of the band, feet shoulder-width apart. Loop it behind your neck across your upper back, or hold the handles at shoulder height. With a slight, fixed bend in your knees, hinge forward at the hips until your torso is roughly parallel to the floor or you feel a deep hamstring stretch. Drive your hips forward to return to standing, squeezing your glutes at the top. Same hip hinge as the RDL, but the load sits on your back instead of in your hands — that means more demand on your spinal erectors and core to keep the torso rigid.',
        mistakes:['Rounding the lower back — keep it flat. If you can’t, don’t go as deep.','Bending the knees too much — this is a hip hinge, not a squat.','Going too heavy too soon — start light, your hamstrings and lower back need time to adapt.'],
        variants:[{name:'Stability Ball Hamstring Bridge',equip:'Stability ball',rx:'3×12–15',cue:'Heels on the ball, hips bridged up — no spinal loading at all, pure hamstring/glute posterior chain work if the Good Morning feels like too much load on the back',demo:'hipthrust'}]},
      {id:'fri-nordic',name:'Stability Ball Leg Curl',slot:'Knee Flexion',target:'Hamstrings',equip:'Stability ball',rx:'3×10–12',cal:30,cue:'Hips stay up the whole set — curl the ball in, roll out over a slow 3-count',demo:'ballcurl',log:'setsreps',sets:3,variants:[{name:'Single-Leg Ball Curl',equip:'Stability ball',rx:'3\u00d76\u20138/leg',cue:'One heel on the ball \u2014 hips level, slow 3-count roll-out',demo:'ballcurl'}]},
      {id:'fri-calf',name:'Single-Leg Calf Raise',demo:'calf',slot:'Calves',target:'Calves',equip:'Step edge, bodyweight',rx:'4×12–15/leg',cal:25,cue:'Heel hangs off the step, full stretch at the bottom, 2-sec squeeze at the top',log:'setsreps',sets:4},
      {id:'fri-obliques',name:'Obliques / Rotation',demo:'woodchop',slot:'Rotation',target:'Obliques',equip:'Tube 10–20 → 30 lb',rx:'3×10/side',cal:25,cue:'Power from the hips rotating — arms guide, core drives. Stop short of any pinch near the SI joint — rotation under load is a higher-demand pattern for it.',log:'setsreps',sets:3,
        variants:[{name:'Slow Standing Pallof Rotation',equip:'Tube 10–20 lb · anchor to one side',rx:'3×8/side',cue:'Hold at your chest, rotate slowly toward the anchor and back — same oblique pattern, far less rotational force on the SI joint',demo:'pallof'}]},
      {id:'fri-deadbug',name:'Dead Bug',demo:'deadbug',slot:'Anti-Extension',target:'Core · SI Joint',equip:'Bodyweight or ball',rx:'3×8/side',cal:20,cue:'Low back glued to the floor — if it lifts, you\'ve gone too far',log:'setsreps',sets:3,
        variants:[{name:'Bird Dog',equip:'Bodyweight · mat',rx:'3×8/side',cue:'Opposite arm and leg extend — flat back, zero rocking. Swap in if Dead Bug pops your SI joint',demo:'birddog'}]},
      {id:'fri-sqpress',name:'Squat to Press',slot:'Power',target:'Full Body',equip:'10 lb DBs or slam ball',rx:'3×10',cal:35,cue:'Legs drive up first, then press — one fluid motion',demo:'press',log:'setsreps',sets:3,variants:[{name:'KB Squat to Press',equip:'8 lb kettlebell',rx:'3\u00d712',cue:'Goblet-hold the bell, squat, then punch it overhead as you stand \u2014 one fluid motion',demo:'goblet'}]},
      {id:'fri-plank',name:'Plank',slot:'Anti-Extension',target:'Core',equip:'Bodyweight',rx:'3×30–45s',cal:20,cue:'Squeeze glutes, brace core — straight line head to heels, breathe',demo:'plank',log:'time',secs:40,variants:[{name:'Stability Ball Plank',equip:'Forearms on ball',rx:'3\u00d720\u201330s',cue:'Forearms on the ball, body straight \u2014 the wobble is the work. Shorter holds count',demo:'plank'}]},
      DS_WALK30,DS_RIDE20,DS_ACTIVEREST]},

  sat:{title:'Mountain Bike Ride',sub:'Cardio · Fat Loss · HDL Boost',accent:'var(--blue)',
    moves:[
      {id:'sat-ride',name:'Mountain Bike Ride',demo:'ride',slot:'Cardio',target:'Aerobic base',equip:'Roadmaster · compression sleeve',rx:'30–60 min',cal:0,cue:'Mostly easy with a few honest climbs — keep it conversational',log:'cardio',perMin:9.2,defMin:45,variants:[{name:'Interval Ride',equip:'Roadmaster · compression sleeve',rx:'30–45 min · 1 min hard / 1–2 min easy, repeat',perMin:11.5,defMin:35,cue:'Push a hard, standing-effort pace for 1 min, then settle back to conversational for the recovery. Repeat for most of the ride. This is HIIT on equipment you already have — no impact, and it edges out steady-state for visceral fat loss.',demo:'ride'}]},
      {id:'sat-walk',name:'Optional Recovery Walk',demo:'walk',slot:'Cardio',target:'NEAT',equip:'Outdoors',rx:'20–30 min',cal:0,cue:'Loose and easy — protect the joints, keep moving',log:'cardio',perMin:4.3,defMin:30,variants:[{name:'Rucked Walk',equip:'Loaded backpack · 15–25 lb',rx:'20–30 min',perMin:6.2,defMin:30,cue:'Pack high and tight, chest proud — recovery pace with a load beats a fast unloaded shuffle',demo:'ruck'}]}]},

  sun:{title:'Sunday Recovery',sub:'Active recovery · Walk + Gentle Flow',accent:'var(--green)',
    moves:[
      {id:'sun-walk',name:'Recovery Walk',demo:'walk',slot:'Cardio',target:'NEAT · circulation',equip:'Outdoors',rx:'30–45 min',cal:0,cue:'Easy pace, nose breathing — let the body recover, not work',log:'cardio',perMin:4.3,defMin:35,variants:[{name:'Rucked Walk',equip:'Loaded backpack · 10–15 lb',rx:'30–45 min',perMin:5.8,defMin:35,cue:'Sunday version stays easy — lighter load, nose breathing, tall posture',demo:'ruck'}]},
      {id:'sun-flow',name:'Gentle Mobility Flow',slot:'Mobility',target:'Whole body',equip:'Mat',rx:'15–20 min',cal:50,cue:'Move where you feel stuck — slow, breath-led, no intensity',demo:'catcow',log:'done'}]}
};

var DS_WEEKMAP=['sun','mon','tue','wed','thu','fri','sat'];
var DS_DAYLABEL={mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun'};

// ═══════ COMPLETION TRACKER + STREAK DASHBOARD (ported, trimmed) ═══════

/* ═══════ block boundary ═══════ */

(function(){
  function slug(s){return (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");}
  function pad(n){return String(n).padStart(2,"0");}
  function dkey(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
  function today(){return dkey(new Date());}
  function loadDone(){try{return JSON.parse(localStorage.getItem("eg_done")||"{}")||{};}catch(e){return {};}}
  function saveDone(o){try{localStorage.setItem("eg_done",JSON.stringify(o));}catch(e){}}
  function url(){return localStorage.getItem("mv_sheets_url")||"";}
  window.egSlug=slug; window.egToday=today;
  // Bridge hooks for the tracker's yoga completion card (dash + streak + auto-push)
  window.egIsDone=function(exid){ return !!((loadDone()[today()]||{})[exid]); };
  window.egSetDone=function(exid,on){ var d=loadDone(),t=today(); d[t]=d[t]||{}; if(on)d[t][exid]=true; else delete d[t][exid]; if(!Object.keys(d[t]).length)delete d[t]; saveDone(d); renderDash(); scheduleSync(); };
  document.addEventListener("DOMContentLoaded",function(){ if(typeof tgYogaRefresh==="function") tgYogaRefresh(); });

  function tagCards(){
    document.querySelectorAll(".exercise-card").forEach(function(card){
      var nm=card.querySelector(".exercise-name"); if(nm) card.dataset.exid=slug(nm.textContent);
    });
  }
  window.egOnDotChange=function(tracker){
    var card=tracker.closest(".exercise-card"); if(!card) return;
    var exid=card.dataset.exid||slug((card.querySelector(".exercise-name")||{}).textContent||"");
    if(!exid) return;
    var dots=tracker.querySelectorAll(".set-dot"), done=tracker.querySelectorAll(".set-dot.done").length;
    var all=dots.length>0 && done===dots.length;
    var d=loadDone(), t=today(); d[t]=d[t]||{};
    if(all) d[t][exid]=true; else delete d[t][exid];
    if(!Object.keys(d[t]).length) delete d[t];
    saveDone(d); egCrossLog(); renderDash(); scheduleSync();
  };

  // Log estimated calories from completed strength exercises into TODAY's tracker day.
  // Excludes the Wednesday yoga flow (logged separately) so it isn't double-counted.
  function egCrossLog(){
    try{
      if(typeof getDay!=="function"||typeof saveDay!=="function"||typeof todayKey!=="function") return;
      var tk=todayKey(), day=getDay(tk), id="eg-strength-"+tk;
      day.exercises=(day.exercises||[]).filter(function(e){return e.id!==id;});
      saveDay(day,tk);
      if(typeof renderAll==="function") renderAll();
    }catch(e){}
  }

  function restoreToday(){
    var set=(loadDone()[today()])||{};
    document.querySelectorAll(".exercise-card").forEach(function(card){
      if(!set[card.dataset.exid]) return;
      var tr=card.querySelector(".set-tracker"); if(!tr) return;
      tr.querySelectorAll(".set-dot").forEach(function(dot){dot.classList.add("done");});
      var msg=tr.querySelector(".set-complete-msg"); if(msg) msg.classList.add("show");
    });
  }

  var syncTimer=null;
  function scheduleSync(){ if(!url())return; clearTimeout(syncTimer); syncTimer=setTimeout(function(){pushSync();},4000); }
  function pushSync(cb){
    var u=url(); if(!u){ if(cb)cb(false); return; }
    setStatus("Saving\u2026");
    fetch(u,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:"data="+encodeURIComponent(JSON.stringify({workouts:loadDone()}))})
      .then(function(){ localStorage.setItem("eg_last_sync",Date.now()); setStatus("\u2713 Saved "+new Date().toLocaleTimeString()); if(cb)cb(true); })
      .catch(function(){ setStatus("Offline \u2014 will retry next time"); if(cb)cb(false); });
  }
  function setStatus(s){ var el=document.getElementById("eg-sync-status"); if(el) el.textContent=s; }

  window.egSaveUrl=function(){
    var v=((document.getElementById("eg-url")||{}).value||"").trim();
    localStorage.setItem("mv_sheets_url",v);
    setStatus(v?"URL saved":"URL cleared");
    if(v) pushSync();
  };
  window.egPushNow=function(){ if(!url()){setStatus("Enter your Apps Script URL first");return;} pushSync(); };
  window.egOpenSettings=function(){ var o=document.getElementById("eg-settings"); if(!o)return; var ue=document.getElementById("eg-url"); if(ue)ue.value=url(); o.style.display="block"; };
  window.egCloseSettings=function(){ var o=document.getElementById("eg-settings"); if(o)o.style.display="none"; };

  function streak(d){
    var s=0, day=new Date();
    if(!(d[today()]&&Object.keys(d[today()]).length)) day.setDate(day.getDate()-1);
    for(var g=0;g<400;g++){ var k=dkey(day); if(d[k]&&Object.keys(d[k]).length){s++;day.setDate(day.getDate()-1);}else break; }
    return s;
  }
  function pretty(id){ return id.replace(/-/g," ").replace(/\b\w/g,function(c){return c.toUpperCase();}); }
  function bestStreak(d){
    var ks=Object.keys(d).filter(function(k){return Object.keys(d[k]).length;}).sort(), best=0,cur=0,prev=null;
    ks.forEach(function(k){
      if(prev){var diff=Math.round((new Date(k+"T00:00")-new Date(prev+"T00:00"))/86400000);cur=(diff===1)?cur+1:1;}else{cur=1;}
      if(cur>best)best=cur; prev=k;
    });
    return best;
  }
  function renderDash(){
    var el=document.getElementById("mv-dash"); if(!el) return;
    var d=loadDone();
    var allK=Object.keys(d).filter(function(k){return Object.keys(d[k]).length;}).sort();
    var totalW=allK.length, totalEx=allK.reduce(function(a,k){return a+Object.keys(d[k]).length;},0);
    var st=streak(d), best=bestStreak(d);
    var now=new Date(), wd=(now.getDay()+6)%7, monday=new Date(now); monday.setDate(now.getDate()-wd);
    var dl=["M","T","W","T","F","S","S"], wkTrained=0, wkCells=[];
    for(var i=0;i<7;i++){var dt=new Date(monday);dt.setDate(monday.getDate()+i);var k=dkey(dt);var n=d[k]?Object.keys(d[k]).length:0;if(n)wkTrained++;var isT=k===today();
      wkCells.push('<div style="flex:1;text-align:center"><div style="font-size:10px;color:#777;margin-bottom:4px">'+dl[i]+'</div><div style="height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;'+(n?"background:var(--accent);color:#0f0f0f":"background:rgba(255,255,255,.05);color:#555")+(isT?";outline:2px solid #7dd3fc;outline-offset:1px":"")+'">'+(n||"\u00b7")+'</div></div>');}
    var heat="";
    for(var j=34;j>=0;j--){var d2=new Date();d2.setDate(d2.getDate()-j);var k2=dkey(d2);var c2=d[k2]?Object.keys(d[k2]).length:0;
      var bg=c2===0?"rgba(255,255,255,.05)":c2<3?"rgba(232,255,71,.35)":c2<5?"rgba(232,255,71,.65)":"var(--accent)";
      heat+='<div title="'+k2+": "+c2+'" style="width:100%;padding-bottom:100%;border-radius:3px;background:'+bg+'"></div>';}
    var weeks=[],labels=[];
    for(var w=5;w>=0;w--){var ws=new Date(monday);ws.setDate(monday.getDate()-7*w);var c=0;for(var x=0;x<7;x++){var wk=new Date(ws);wk.setDate(ws.getDate()+x);var kk=dkey(wk);if(d[kk]&&Object.keys(d[kk]).length)c++;}weeks.push(c);labels.push((ws.getMonth()+1)+"/"+ws.getDate());}
    var maxW=Math.max(1,Math.max.apply(null,weeks));
    var bars=weeks.map(function(c,i){var hh=Math.round((c/maxW)*70);return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="font-size:10px;color:#aaa">'+c+'</div><div style="width:58%;height:'+hh+'px;min-height:3px;background:'+(c?"var(--accent)":"rgba(255,255,255,.12)")+';border-radius:4px 4px 0 0"></div><div style="font-size:9px;color:#666">'+labels[i]+'</div></div>';}).join("");
    var tally={}; allK.forEach(function(k){Object.keys(d[k]).forEach(function(ex){tally[ex]=(tally[ex]||0)+1;});});
    var top=Object.keys(tally).sort(function(a,b){return tally[b]-tally[a];}).slice(0,5), maxT=top.length?tally[top[0]]:1;
    var topHtml=top.length?top.map(function(ex){var pct=Math.round((tally[ex]/maxT)*100);return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:#ccc">'+pretty(ex)+'</span><span style="color:#5eead4">'+tally[ex]+'\u00d7</span></div><div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:var(--accent)"></div></div></div>';}).join(""):'<div style="color:#666">No data yet.</div>';
    var recent=allK.slice().reverse().slice(0,8);
    var recentHtml=recent.length?recent.map(function(k){var n=Object.keys(d[k]).length;return '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="color:#ccc">'+k+'</span><span style="color:#5eead4;font-weight:600">'+n+' ex</span></div>';}).join(""):'<div style="color:#666;padding:8px 0">No workouts logged yet \u2014 tap the set dots as you train.</div>';
    function stat(v,l,c){return '<div style="flex:1;text-align:center;background:rgba(255,255,255,.03);border-radius:12px;padding:14px 4px"><div style="font-size:23px;font-weight:800;color:'+c+'">'+v+'</div><div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:3px">'+l+'</div></div>';}
    function lbl(t){return '<div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:22px 0 10px">'+t+'</div>';}
    var h='<div style="display:flex;gap:8px">'+stat(st,"Streak","#86efac")+stat(best,"Best","#fbbf24")+stat(wkTrained+"/7","Week","#5eead4")+stat(totalW,"Workouts","#7dd3fc")+'</div>';
    h+=lbl("This week")+'<div style="display:flex;gap:6px">'+wkCells.join("")+'</div>';
    h+=lbl("Last 5 weeks")+'<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">'+heat+'</div>';
    h+=lbl("Workouts per week")+'<div style="display:flex;align-items:flex-end;gap:6px;height:104px;padding-top:6px">'+bars+'</div>';
    h+=lbl("Most-trained exercises")+topHtml;
    h+=lbl("Recent workouts")+recentHtml;
    h+='<div style="font-size:11px;color:#5a5a5a;margin-top:16px;text-align:center">'+totalEx+' exercises completed all-time</div>';
    el.innerHTML=h;
  }

  window.tagCards = tagCards;
  window.restoreToday = restoreToday;
  window.egRenderDash = renderDash;
})();

document.addEventListener("DOMContentLoaded", function(){
  if(typeof tagCards==="function") tagCards();
  if(typeof restoreToday==="function") restoreToday();
  if(typeof egRenderDash==="function") egRenderDash();
});


// ═══════ TODAY TAB RENDERER (new, simplified — see header note) ═══════

// ═══════════════════════════════════════════════════════════════════════
// TODAY TAB — simplified session renderer
// v1 scope: shows the day's plan as cards (name, target, equipment, cue),
// lets you swap to a listed variant, and tracks set-by-set completion
// (via the eg_* system below, ported from the original app). What this
// v1 does NOT include from the original: automatic weekly variant
// rotation, per-exercise rep-weight memory (DS_PROG), and band-ceiling
// autoregulation suggestions. Those are candidates for a v2 pass.
// ═══════════════════════════════════════════════════════════════════════

function dsWeekdayKey(dateKey){
  var d = keyToDate(dateKey||activeDate);
  return DS_WEEKMAP[d.getDay()];
}
function dsSessionForToday(){
  return DS_SESSIONS[dsWeekdayKey()];
}

// Per-move display state: which variant index is currently shown (0 = primary move itself)
var DS_UI = {};
try{ DS_UI = JSON.parse(store.get("mv_ui")||"{}"); }catch(e){ DS_UI={}; }
function dsSaveUI(){ try{ store.set("mv_ui", JSON.stringify(DS_UI)); }catch(e){} }
function dsDayState(){
  var wk = dsWeekdayKey();
  if(!DS_UI[wk]) DS_UI[wk]={};
  return DS_UI[wk];
}

function dsDemoSvg(name){
  if(!name) return "";
  var fn = DS_DEMOS[name];
  if(typeof fn !== "function") return "";
  try{ return fn(); }catch(e){ return ""; }
}

function dsActiveVariant(move){
  var st = dsDayState(), idx = st[move.id]||0;
  if(idx===0 || !move.variants || !move.variants[idx-1]) return {name:move.name, equip:move.equip, rx:move.rx, cue:move.cue, demo:move.demo, isVariant:false};
  var v = move.variants[idx-1];
  return {name:v.name, equip:v.equip, rx:v.rx, cue:v.cue, demo:v.demo||move.demo, isVariant:true};
}
function dsSwapVariant(moveId, dir){
  var st = dsDayState(), move = dsFindMove(moveId); if(!move) return;
  var max = (move.variants||[]).length;
  var cur = st[moveId]||0;
  var next = cur + dir;
  if(next < 0) next = max; if(next > max) next = 0;
  st[moveId] = next;
  dsSaveUI();
  renderToday();
}
function dsFindMove(moveId){
  var sess = dsSessionForToday(); if(!sess) return null;
  for(var i=0;i<sess.moves.length;i++){ if(sess.moves[i].id===moveId) return sess.moves[i]; }
  return null;
}

function dsSetCount(move){
  return move.sets || 3;
}

function renderToday(){
  var wrap = document.getElementById("today-moves");
  if(!wrap) return;
  var sess = dsSessionForToday();
  var titleEl = document.getElementById("today-title"), subEl = document.getElementById("today-sub");
  if(titleEl) titleEl.textContent = sess ? sess.title : "Rest Day";
  if(subEl) subEl.textContent = sess ? sess.sub : "";

  if(!sess || !sess.moves || !sess.moves.length){
    wrap.innerHTML = '<div class="empty" style="padding:30px 16px;text-align:center;color:#888">No session scheduled — rest day.</div>';
    return;
  }

  wrap.innerHTML = sess.moves.map(function(move){
    var av = dsActiveVariant(move);
    var sets = dsSetCount(move);
    var exid = egSlug(move.name === av.name ? move.name : (move.name + "-" + av.name));
    var hasVariants = move.variants && move.variants.length;
    var demoSvg = dsDemoSvg(av.demo);
    var burnEst = calAdj(move.cal||0);

    return '<div class="exercise-card" data-exid="'+exid+'" data-moveid="'+attrId(move.id)+'">' +
      (demoSvg ? '<div class="demo-wrap" style="max-width:160px;margin:0 auto 6px">'+demoSvg+'</div>' : '') +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
        '<div>' +
          '<div class="exercise-name" style="font-weight:700;font-size:15px">'+escH(av.name)+'</div>' +
          '<div style="font-size:11px;color:#888;margin-top:2px">'+escH(move.target||"")+' · '+escH(av.equip||"")+'</div>' +
        '</div>' +
        '<div style="font-size:11px;color:#5eead4;white-space:nowrap">🔥 '+burnEst+' kcal</div>' +
      '</div>' +
      '<div style="font-size:12px;color:#cfe84f;margin-top:6px;font-family:\'DM Mono\',monospace">'+escH(av.rx||"")+'</div>' +
      (av.cue ? '<div style="font-size:12px;color:#aaa;margin-top:6px;line-height:1.5">'+escH(av.cue)+'</div>' : '') +
      (hasVariants ? '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">' +
        '<button class="bs" onclick="dsSwapVariant(\''+attrId(move.id)+'\',-1)" style="padding:4px 10px">‹</button>' +
        '<span style="font-size:10px;color:#888;font-family:\'DM Mono\',monospace">'+(av.isVariant?"Variant":"Primary")+'</span>' +
        '<button class="bs" onclick="dsSwapVariant(\''+attrId(move.id)+'\',1)" style="padding:4px 10px">›</button>' +
      '</div>' : '') +
      '<div class="set-tracker" style="display:flex;gap:6px;margin-top:10px" data-sets="'+sets+'">' +
        Array.from({length:sets}).map(function(_,i){
          return '<div class="set-dot" onclick="dsToggleSetDot(this)" style="width:26px;height:26px;border-radius:50%;border:2px solid #333;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;color:#666">'+(i+1)+'</div>';
        }).join("") +
      '</div>' +
      '<div class="set-complete-msg" style="display:none;margin-top:6px;font-size:11px;color:#4ade80">✓ Complete</div>' +
    '</div>';
  }).join("");

  tagCards();
  restoreToday();
  if(typeof renderDash==="function") renderDash();
}

function dsToggleSetDot(el){
  el.classList.toggle("done");
  el.style.background = el.classList.contains("done") ? "var(--accent,#cfe84f)" : "";
  el.style.borderColor = el.classList.contains("done") ? "var(--accent,#cfe84f)" : "#333";
  el.style.color = el.classList.contains("done") ? "#0f0f0f" : "#666";
  var tracker = el.closest(".set-tracker");
  if(typeof egOnDotChange==="function") egOnDotChange(tracker);
  var card = el.closest(".exercise-card");
  var msg = card && card.querySelector(".set-complete-msg");
  var allDone = tracker && Array.prototype.every.call(tracker.querySelectorAll(".set-dot"), function(d){return d.classList.contains("done");});
  if(msg) msg.classList.toggle("show", !!allDone);
  if(msg) msg.style.display = allDone ? "block" : "none";
}

// ═══════ YOGA TAB (poses, flows, PAILs/RAILs — ported) ═══════
function getLatestWeight(){ return CURRENT_WEIGHT; }


var WEIGHT = 231;
var YOGA_DEMOS={
  "mountain":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="52" x2="100" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="100" x2="88" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="100" x2="112" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="52" x2="90" y2="98" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="52" x2="110" y2="98" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="40" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "childs":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="140" y1="108" x2="150" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="140" y1="108" x2="105" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="98" x2="80" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="80" y1="108" x2="55" y2="116" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="80" cy="108" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "catcow":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="62" y1="122" x2="62" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="140" y1="122" x2="140" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<path d="M62 98 Q100 90 140 98" fill="none" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"><animate attributeName="d" values="M62 98 Q100 84 140 98;M62 98 Q100 108 140 98;M62 98 Q100 84 140 98" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>'+
    '<line x1="140" y1="98" x2="152" y2="90" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="160" cy="86" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</svg>';},
  "downdog":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="108" y1="82" x2="70" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="108" y1="82" x2="150" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="108" cy="72" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "cobra":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="150" y1="122" x2="80" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="108" x2="95" y2="122" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="70" cy="96" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "sphinx":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="150" y1="122" x2="85" y2="114" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="85" y1="114" x2="85" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="72" cy="100" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "seated-forward":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="58" y1="122" x2="150" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="58" y1="122" x2="90" y2="102" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="90" y1="102" x2="122" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="122" y1="116" x2="142" y2="120" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="122" cy="116" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "bridge":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="58" y1="122" x2="85" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="85" y1="98" x2="130" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="130" y1="98" x2="150" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="50" cy="124" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "butterfly":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="122" x2="80" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="120" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="100" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="86" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "happy-baby":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="45" y1="124" x2="60" y2="124" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="60" y1="124" x2="100" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="124" x2="95" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="90" x2="122" y2="86" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="95" y1="90" x2="108" y2="98" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="45" cy="124" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "reclined-butterfly":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="40" y1="118" x2="55" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="55" y1="118" x2="115" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="115" y1="118" x2="95" y2="100" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="100" x2="112" y2="112" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="40" cy="118" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "corpse":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="35" y1="122" x2="58" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="58" y1="122" x2="150" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="58" y1="122" x2="48" y2="112" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<line x1="140" y1="114" x2="168" y2="106" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="35" cy="122" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "legs-up":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="50" y1="124" x2="60" y2="124" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="60" y1="124" x2="150" y2="124" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="150" y1="124" x2="156" y2="40" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="158" y1="12" x2="158" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="50" cy="124" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "supine-twist":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="45" y1="118" x2="58" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="58" y1="118" x2="95" y2="118" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="118" x2="125" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="125" y1="100" x2="140" y2="82" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="70" y1="118" x2="78" y2="104" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="45" cy="118" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "staff":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="60" y1="122" x2="150" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="60" y1="122" x2="60" y2="70" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="60" cy="70" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "puppy":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="135" y1="124" x2="135" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="135" y1="100" x2="95" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="108" x2="70" y2="120" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="70" y1="120" x2="55" y2="124" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="70" cy="120" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "easy-pose":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="122" x2="78" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="122" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="100" y2="72" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="72" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "standing-forward":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="100" x2="100" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="100" x2="100" y2="92" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="92" x2="100" y2="126" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="92" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "low-lunge":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="96" x2="88" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="60" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="118" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="118" y1="98" x2="118" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="88" y2="44" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="88" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "warrior1":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="96" x2="60" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="120" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="98" x2="120" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="88" y2="44" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="44" x2="70" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="88" y1="44" x2="106" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="88" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "warrior2":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="124" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="140" y1="124" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="100" y2="46" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="68" y1="66" x2="132" y2="66" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "reverse-warrior":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="124" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="140" y1="124" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="100" y2="46" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="128" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="46" x2="80" y2="40" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="46" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "ext-side-angle":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="124" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="135" y1="118" x2="100" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="98" x2="132" y2="76" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="132" y1="76" x2="150" y2="58" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="132" cy="76" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "triangle":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="124" x2="120" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="150" y1="124" x2="120" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="120" y1="98" x2="132" y2="58" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="120" y1="98" x2="95" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="132" y1="58" x2="140" y2="46" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="132" cy="58" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "warrior3":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="124" x2="95" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="98" x2="55" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="98" x2="135" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="55" y1="90" x2="38" y2="86" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="55" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "half-moon":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="90" y1="124" x2="90" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="92" x2="68" y2="80" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="90" y1="92" x2="130" y2="82" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="92" x2="108" y2="50" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="98" cy="84" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "chair":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="124" x2="88" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="100" x2="112" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="100" x2="100" y2="52" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="52" x2="82" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="52" x2="118" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="52" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "eagle":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="124" x2="96" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="96" y1="100" x2="108" y2="96" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="96" y1="100" x2="100" y2="48" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="48" x2="96" y2="52" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="48" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "tree":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="124" x2="100" y2="80" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="80" x2="82" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="80" x2="100" y2="58" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="94" y1="68" x2="106" y2="68" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="58" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "pigeon":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="72" y1="124" x2="110" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="110" y1="118" x2="150" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="110" y1="118" x2="110" y2="62" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="110" cy="62" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "boat":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="105" y1="122" x2="150" y2="82" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="122" x2="70" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="86" x2="45" y2="92" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="70" cy="86" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "camel":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="124" x2="95" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="100" x2="118" y2="84" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="118" y1="84" x2="128" y2="72" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="95" y1="100" x2="112" y2="118" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="128" cy="72" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "bow":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="125" y1="118" x2="100" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="116" x2="85" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="85" y1="100" x2="90" y2="90" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="125" y1="118" x2="118" y2="96" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="85" y1="100" x2="118" y2="96" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="90" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "locust":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="118" x2="60" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="60" y1="118" x2="48" y2="112" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="60" y1="118" x2="35" y2="106" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="118" x2="168" y2="104" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="48" cy="112" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "seated-twist":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="122" x2="95" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="116" x2="100" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="116" x2="108" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="82" x2="124" y2="76" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="124" y1="76" x2="132" y2="88" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="92" y1="82" x2="80" y2="100" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="108" cy="72" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "rev-warrior":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="72" y1="124" x2="115" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="148" y1="124" x2="115" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="115" y1="100" x2="95" y2="64" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="64" x2="80" y2="112" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="95" y1="64" x2="116" y2="40" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="95" cy="64" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "thread-needle":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="60" y1="122" x2="60" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="150" y1="122" x2="150" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="60" y1="98" x2="150" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="60" y1="98" x2="130" y2="112" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="140" cy="114" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "pyramid":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="76" y1="124" x2="135" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="76" y1="124" x2="95" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="95" y1="104" x2="112" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="112" cy="98" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "wide-fold":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="58" y1="124" x2="100" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="142" y1="124" x2="100" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="108" x2="100" y2="118" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="118" x2="88" y2="124" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<line x1="100" y1="118" x2="112" y2="124" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="100" cy="118" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "crescent-lunge":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="124" x2="88" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="60" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="96" x2="88" y2="44" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="44" x2="72" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="88" y1="44" x2="104" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="88" cy="44" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "upward-dog":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="150" y1="124" x2="90" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="108" x2="60" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="108" x2="82" y2="90" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="82" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "half-pigeon":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="122" x2="108" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="108" y1="118" x2="148" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="108" y1="118" x2="88" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="88" y1="108" x2="72" y2="100" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="72" cy="100" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "dolphin":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="90" x2="70" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="118" x2="70" y2="128" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="90" x2="150" y2="128" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="95" cy="80" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "fish":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="55" y1="122" x2="90" y2="118" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="118" x2="118" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="118" y1="98" x2="132" y2="116" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="118" y1="98" x2="145" y2="120" stroke="#9a9d8c" stroke-width="2" stroke-linecap="round"/>'+
    '<circle cx="132" cy="116" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "hero":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="122" x2="105" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="122" x2="100" y2="76" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="76" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "cow-face":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="122" x2="85" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="115" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="100" y2="74" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="74" x2="80" y2="70" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="100" y1="74" x2="122" y2="80" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="74" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "half-lord":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="72" y1="122" x2="98" y2="114" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="98" y1="114" x2="102" y2="116" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="98" y1="114" x2="118" y2="108" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="102" y1="116" x2="110" y2="72" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="94" y1="82" x2="126" y2="76" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="126" y1="76" x2="134" y2="90" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="94" y1="82" x2="82" y2="98" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="110" cy="72" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "crow":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="92" y1="120" x2="100" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="108" y1="120" x2="100" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="108" x2="100" y2="96" stroke="#9a9d8c" stroke-width="6" stroke-linecap="round"/>'+
    '<line x1="100" y1="96" x2="100" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="94" y1="96" x2="108" y2="90" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="106" y1="96" x2="112" y2="90" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="86" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "side-crow":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="120" x2="102" y2="106" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="110" y1="120" x2="102" y2="106" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="102" y1="106" x2="102" y2="90" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="102" y1="98" x2="70" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="70" y1="104" x2="48" y2="98" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="102" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "headstand":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="18" x2="100" y2="80" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="85" y1="80" x2="115" y2="80" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="18" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "forearm-stand":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="20" x2="100" y2="78" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="80" y1="98" x2="120" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="80" y1="98" x2="100" y2="78" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="120" y1="98" x2="100" y2="78" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="100" cy="20" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "shoulder-stand":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="55" y1="124" x2="80" y2="124" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="80" y1="124" x2="95" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="90" x2="95" y2="36" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="55" cy="124" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "plow":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="60" y1="122" x2="95" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="104" x2="140" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="55" cy="124" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "wheel":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="124" x2="90" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="90" y1="90" x2="130" y2="90" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="130" y1="90" x2="150" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="78" cy="98" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "king-pigeon":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="68" y1="122" x2="105" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="116" x2="112" y2="86" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="86" x2="118" y2="72" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="105" y1="116" x2="140" y2="78" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="140" y1="78" x2="124" y2="58" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="118" cy="72" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "side-plank":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="70" y1="118" x2="95" y2="108" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="108" x2="150" y2="124" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="108" x2="85" y2="80" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="102" cy="98" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "king-dancer":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="92" y1="124" x2="92" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="92" y1="92" x2="105" y2="76" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="105" y1="76" x2="112" y2="64" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="112" y1="64" x2="130" y2="52" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="105" y1="76" x2="108" y2="38" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="112" cy="64" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "firefly":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="88" y1="120" x2="100" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="112" y1="120" x2="100" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="100" y2="90" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="158" y2="92" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "eight-angle":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="90" y1="120" x2="98" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="106" y1="120" x2="98" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="98" y1="108" x2="98" y2="92" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="98" y1="104" x2="130" y2="96" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="130" y1="96" x2="140" y2="108" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<circle cx="98" cy="92" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "peacock":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="90" y1="120" x2="90" y2="108" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="90" y1="108" x2="160" y2="104" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="172" cy="104" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "flying-pigeon":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="118" x2="100" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="112" y2="98" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="104" x2="100" y2="90" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="90" x2="140" y2="96" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "scale":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="86" y1="120" x2="100" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="114" y1="120" x2="100" y2="104" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="94" y1="104" x2="100" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="106" y1="104" x2="100" y2="116" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<circle cx="100" cy="92" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "handstand":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="18" x2="100" y2="80" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="85" y1="80" x2="115" y2="80" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="18" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "wild-thing":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="62" y1="122" x2="88" y2="106" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="88" y1="106" x2="112" y2="94" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="112" y1="94" x2="126" y2="102" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="112" y1="94" x2="146" y2="68" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="126" cy="102" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "lotus":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="100" y1="118" x2="85" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="118" x2="115" y2="122" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="100" y1="118" x2="100" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="86" r="9" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "standing-split":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,2;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="95" y1="124" x2="95" y2="98" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="95" y1="98" x2="90" y2="90" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="90" y1="90" x2="76" y2="128" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '<line x1="95" y1="98" x2="120" y2="48" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="90" cy="90" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "splits":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    '<line x1="28" y1="128" x2="172" y2="128" stroke="#5F5E5A" stroke-width="3" stroke-linecap="round"/>'+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-1;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="40" y1="122" x2="100" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="160" y2="122" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="100" y1="122" x2="100" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<circle cx="100" cy="86" r="8" fill="none" stroke="#9a9d8c" stroke-width="4"/>'+
    '</g>'+
    '</svg>';},
  "chin-stand":function(){return '<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">'+
    ''+
    '<g><animateTransform attributeName="transform" type="translate" values="0,0;0,-3;0,0" keyTimes="0;0.5;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1"/>'+
    '<line x1="80" y1="124" x2="98" y2="106" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="98" y1="106" x2="122" y2="100" stroke="#9a9d8c" stroke-width="5" stroke-linecap="round"/>'+
    '<line x1="122" y1="100" x2="140" y2="86" stroke="#9a9d8c" stroke-width="4" stroke-linecap="round"/>'+
    '<line x1="140" y1="86" x2="132" y2="112" stroke="#9a9d8c" stroke-width="3" stroke-linecap="round"/>'+
    '</g>'+
    '</svg>';}
};

var POSES = [

// ═══════════════════════════════════════════════════
// BEGINNER
// ═══════════════════════════════════════════════════
{id:"mountain",e:"🧍",n:"Mountain Pose",s:"Tadasana",l:"beginner",c:"standing",cpm:2.2,dur:60,
desc:"The foundation of all standing poses. Develops body awareness, alignment, and intentional standing.",
steps:["Stand feet together or hip-width, toes forward.","Distribute weight evenly across all four corners of both feet.","Engage thighs, lift kneecaps, tuck tailbone slightly.","Roll shoulders back and down, arms at sides, palms forward.","Lengthen through crown of head as if a string pulls you upward.","Breathe deeply and hold 30-60 seconds."],
cue:"Press all four corners into the earth. Feel tall and rooted.",
ben:["Posture","Body Awareness","Grounding","Focus","Balance"]},

{id:"childs",e:"🙇",n:"Child's Pose",s:"Balasana",l:"beginner",c:"restorative",cpm:1.8,dur:90,
desc:"A resting pose that gently stretches the hips, thighs, and lower back. Perfect between harder poses.",
steps:["Kneel with big toes touching, knees wide apart.","Sit hips back toward heels.","Walk hands forward, lower forehead to mat.","Extend arms forward or rest alongside body.","Let belly fall between thighs and breathe into your back.","Hold 30 seconds to 3 minutes."],
cue:"With each exhale, let hips sink heavier toward your heels.",
ben:["Hip Flexors","Lower Back","Stress Relief","Recovery","Breath"]},

{id:"catcow",e:"🐄",n:"Cat-Cow",s:"Marjaryasana-Bitilasana",l:"beginner",c:"seated",cpm:2.5,dur:60,
desc:"A gentle flow between two poses that warms up the spine. Excellent for back pain and as a morning warm-up.",
steps:["Start on hands and knees, wrists under shoulders, knees under hips.","COW: Inhale, drop belly, lift chest and tailbone, gaze forward.","CAT: Exhale, round spine to ceiling, tuck chin and tailbone.","Flow smoothly, matching each movement to your breath.","Move slowly — this is about spinal mobility, not speed.","Complete 8-12 rounds."],
cue:"Let your breath lead. Inhale to open, exhale to round.",
ben:["Spinal Mobility","Back Pain","Core Warm-Up","Breath","Hip Mobility"]},

{id:"downdog",e:"🐕",n:"Downward Dog",s:"Adho Mukha Svanasana",l:"beginner",c:"standing",cpm:3.2,dur:60,
desc:"One of yoga's most iconic poses. Strengthens arms while stretching the entire back of the body.",
steps:["Start in tabletop. Curl toes under, push hips up and back.","Straighten legs (slight bend OK if hamstrings are tight).","Press hands firmly, spread fingers wide.","Rotate inner elbows toward each other to protect shoulders.","Let head hang between arms — no neck strain.","Press heels toward floor and hold 30-60 seconds."],
cue:"Push the floor away with your hands. Keep a long spine.",
ben:["Hamstrings","Calves","Shoulders","Upper Back","Inversion"]},

{id:"cobra",e:"🐍",n:"Cobra Pose",s:"Bhujangasana",l:"beginner",c:"backbend",cpm:2.8,dur:45,
desc:"A gentle backbend that strengthens the spine and opens the chest. Counter-movement for forward-bent postures.",
steps:["Lie face down, hands under shoulders, elbows close to body.","Press tops of feet and pelvis into the mat.","Inhale and lift chest off the floor using back muscles first.","Use hands for light support — don't push yourself up.","Keep elbows slightly bent, shoulders away from ears.","Hold 15-30 seconds, lower slowly."],
cue:"Lift from your back, not from your arms. Slide forward and up.",
ben:["Lower Back","Chest","Shoulders","Posture","Energy"]},

{id:"sphinx",e:"🦁",n:"Sphinx Pose",s:"Salamba Bhujangasana",l:"beginner",c:"backbend",cpm:2.0,dur:60,
desc:"A gentler backbend than Cobra. Great for those with sensitive lower backs or as a warm-up to deeper backbends.",
steps:["Lie face down with legs extended, feet hip-width.","Bring elbows under shoulders, forearms on the mat parallel.","Press forearms down and lift chest and head.","Keep lower back relaxed — no squeezing the glutes.","Gaze forward or slightly up.","Hold 30-60 seconds."],
cue:"Press forearms into mat like you're pushing the floor away from you.",
ben:["Lower Back","Chest Opening","Spine","Posture","Gentle Backbend"]},

{id:"seated-forward",e:"🙏",n:"Seated Forward Fold",s:"Paschimottanasana",l:"beginner",c:"seated",cpm:2.0,dur:60,
desc:"A deep stretch for the entire back of the body. Calming for the nervous system and excellent for tight hamstrings.",
steps:["Sit with legs extended, feet flexed.","Inhale and sit tall, lengthening spine.","Exhale and hinge forward from hips — keep back flat as long as possible.","Reach for feet, ankles, or shins without rounding.","With each inhale lengthen, with each exhale fold deeper.","Hold 30-90 seconds. Never force or bounce."],
cue:"Lead with your chest forward, not just fold down.",
ben:["Hamstrings","Lower Back","Calves","Spine","Calming"]},

{id:"bridge",e:"🌉",n:"Bridge Pose",s:"Setu Bandha Sarvangasana",l:"beginner",c:"backbend",cpm:3.5,dur:45,
desc:"Strengthens the glutes, hamstrings, and lower back while opening the chest. Perfect antidote to sitting.",
steps:["Lie on back, knees bent, feet flat hip-width apart.","Arms flat at sides, palms down.","Press feet firmly and lift hips toward ceiling.","Squeeze glutes and press arms into mat.","Keep knees over heels — don't let them splay.","Hold 30-60 seconds, lower slowly. Repeat 2-3x."],
cue:"Drive through your heels, not your toes. Squeeze glutes hard.",
ben:["Glutes","Hamstrings","Lower Back","Hip Flexors","Chest"]},

{id:"butterfly",e:"🦋",n:"Butterfly Pose",s:"Baddha Konasana",l:"beginner",c:"seated",cpm:1.8,dur:90,
desc:"A gentle hip opener that stretches the inner thighs and groin. Works well for cyclists and desk workers.",
steps:["Sit with soles of feet together, knees out to sides.","Hold ankles or feet with both hands.","Sit tall and breathe into the inner groin.","Gently press knees toward the floor — don't force.","Option to hinge forward for a deeper stretch.","Hold 60-120 seconds."],
cue:"Breathe into your hips. Let gravity open them rather than forcing.",
ben:["Inner Thighs","Groin","Hip Opening","Lower Back","Circulation"]},

{id:"happy-baby",e:"👶",n:"Happy Baby",s:"Ananda Balasana",l:"beginner",c:"restorative",cpm:1.8,dur:90,
desc:"A deeply relaxing hip opener that releases tension in the lower back and inner thighs. Hard to do without smiling.",
steps:["Lie on your back. Exhale and bend knees to chest.","Grip outside edges of feet (or shins).","Open knees wider than torso, bringing toward armpits.","Flex feet, stacking ankles over knees.","Gently pull feet down as if pushing knees toward the floor.","Rock gently side to side. Hold 60-90 seconds."],
cue:"Let your spine melt into the mat. Rock gently like a content baby.",
ben:["Hips","Inner Thighs","Lower Back","Stress Relief","Recovery"]},

{id:"reclined-butterfly",e:"🌸",n:"Reclined Butterfly",s:"Supta Baddha Konasana",l:"beginner",c:"restorative",cpm:1.5,dur:180,
desc:"A fully passive hip opener. Place pillows under knees for support if needed. Perfect for end of practice.",
steps:["Lie on your back with soles of feet together.","Let knees fall out to the sides.","Place hands on belly or extend arms out to sides.","Close eyes and breathe deeply.","Option: place pillows or blocks under each knee for support.","Hold 2-5 minutes."],
cue:"There is nothing to do here. Simply breathe and release.",
ben:["Hips","Groin","Inner Thighs","Nervous System","Recovery"]},

{id:"corpse",e:"😴",n:"Corpse Pose",s:"Savasana",l:"beginner",c:"restorative",cpm:1.2,dur:300,
desc:"The most important pose in yoga. Deep rest that allows your body to absorb the benefits of practice. Never skip it.",
steps:["Lie flat on back, feet mat-width apart, toes falling out.","Arms slightly away from body, palms facing up.","Close eyes and let body become completely heavy.","Consciously relax each part from feet to face.","Breathe naturally. Return to breath when mind wanders.","Stay 3-10 minutes."],
cue:"Nowhere to go. Nothing to do. Just be here.",
ben:["Recovery","Stress Relief","Nervous System","Absorption","Rest"]},

{id:"legs-up",e:"🦵",n:"Legs Up the Wall",s:"Viparita Karani",l:"beginner",c:"restorative",cpm:1.5,dur:300,
desc:"A gentle inversion with massive recovery benefits. Reduces leg swelling and calms the nervous system.",
steps:["Sit sideways with one hip against the wall.","Swing legs up wall as you lie back.","Scoot hips as close to wall as comfortable.","Arms at sides or on belly, palms up.","Close eyes and fully relax.","Hold 5-15 minutes."],
cue:"Let gravity do all the work. Breathe and release.",
ben:["Leg Recovery","Circulation","Stress Relief","Lower Back","Blood Pressure"]},

{id:"supine-twist",e:"🌀",n:"Supine Spinal Twist",s:"Supta Matsyendrasana",l:"beginner",c:"twist",cpm:2.0,dur:60,
desc:"A passive twist that releases the spine and outer hips. Perfect way to end a practice or release after cycling.",
steps:["Lie on back. Draw right knee to chest.","Cross right knee over body to the left, letting it fall toward the floor.","Extend right arm out to the right, gaze right.","Keep both shoulders grounded — the twist happens in the spine.","Place left hand on right knee for a gentle assist.","Hold 30-60 seconds each side."],
cue:"Let shoulder blades melt into the floor. Don't force the twist.",
ben:["Spine","IT Band","Outer Hip","Lower Back","Digestion"]},

{id:"staff",e:"📏",n:"Staff Pose",s:"Dandasana",l:"beginner",c:"seated",cpm:2.0,dur:30,
desc:"The seated equivalent of Mountain Pose. Establishes proper alignment for all seated poses.",
steps:["Sit with legs extended straight in front of you.","Place hands on floor beside hips, fingers forward.","Flex feet toward you.","Sit tall — press sitting bones into floor and lengthen spine.","Press palms down to help lift the chest.","Hold 30-60 seconds."],
cue:"Sitting up straight is harder than it looks. Use your core.",
ben:["Posture","Core","Hamstrings","Body Awareness","Alignment"]},

{id:"puppy",e:"🐶",n:"Puppy Pose",s:"Uttana Shishosana",l:"beginner",c:"restorative",cpm:2.0,dur:60,
desc:"A heart-melting pose halfway between Child's and Downward Dog. Opens the chest and shoulders beautifully.",
steps:["Start in tabletop on hands and knees.","Walk hands forward while keeping hips over knees.","Lower chest and chin (or forehead) toward the mat.","Keep arms active — press into palms.","Let chest melt toward the floor.","Hold 30-60 seconds."],
cue:"Hips stay high over knees. Let your heart sink toward the earth.",
ben:["Chest","Shoulders","Spine","Upper Back","Hip Flexors"]},

{id:"easy-pose",e:"🧘",n:"Easy Pose",s:"Sukhasana",l:"beginner",c:"seated",cpm:1.5,dur:120,
desc:"A comfortable cross-legged seated position for meditation and breathing exercises. The starting point of many practices.",
steps:["Sit on floor or folded blanket for added height.","Cross legs comfortably at shins (not lotus).","Place hands on knees, palms up or down.","Sit tall — spine long, shoulders relaxed.","Close eyes or soften your gaze.","Hold as long as comfortable."],
cue:"Sit tall as if a thread lifts the crown of your head.",
ben:["Posture","Calming","Hip Flexibility","Focus","Meditation"]},

{id:"standing-forward",e:"🌊",n:"Standing Forward Fold",s:"Uttanasana",l:"beginner",c:"standing",cpm:2.5,dur:60,
desc:"A full-body forward fold that releases the hamstrings, calves, and spine. Calming and grounding.",
steps:["Stand with feet hip-width apart.","Exhale and hinge forward from hips, folding over legs.","Bend knees generously if hamstrings are tight.","Let head hang heavy — release neck completely.","Hold elbows and sway gently, or reach for the floor.","Hold 30-60 seconds."],
cue:"Let your head be the heaviest thing. Release everything downward.",
ben:["Hamstrings","Calves","Spine","Inversion Benefits","Calming"]},

{id:"low-lunge",e:"🏃",n:"Low Lunge",s:"Anjaneyasana",l:"beginner",c:"standing",cpm:3.2,dur:45,
desc:"A deep hip flexor opener that's essential for cyclists and runners. Also opens the chest and builds leg strength.",
steps:["From standing, step right foot forward into a lunge.","Lower left knee to the mat, untuck toes.","Adjust front knee to be directly over ankle.","Lift torso upright and raise arms overhead.","Sink hips down and forward — feel the hip flexor stretch.","Hold 30-60 seconds, repeat left side."],
cue:"Sink hips toward the floor. The more your hip drops, the deeper the stretch.",
ben:["Hip Flexors","Quads","Groin","Chest","Balance"]},

// ═══════════════════════════════════════════════════
// INTERMEDIATE
// ═══════════════════════════════════════════════════
{id:"warrior1",e:"⚔️",n:"Warrior I",s:"Virabhadrasana I",l:"intermediate",c:"standing",cpm:4.0,dur:45,
desc:"A powerful standing pose that builds leg and core strength while opening the hips and chest.",
steps:["Step left foot back 3-4 feet into a lunge.","Turn left foot out 45 degrees, press outer edge down.","Bend right knee over right ankle (aim for 90 degrees).","Square hips forward toward the front of the mat.","Raise arms overhead, palms facing each other.","Hold 30-45 seconds, repeat other side."],
cue:"Ground through the back foot. Feel warrior strength rising up.",
ben:["Quads","Glutes","Hip Flexors","Core","Shoulders"]},

{id:"warrior2",e:"🏹",n:"Warrior II",s:"Virabhadrasana II",l:"intermediate",c:"standing",cpm:4.2,dur:45,
desc:"The quintessential warrior pose. Opens hips, builds leg strength, challenges focus and steadiness.",
steps:["Feet wide (about 4 feet), right foot pointing right, left in slightly.","Bend right knee to 90 degrees over ankle.","Extend arms parallel to floor, reaching actively both ways.","Gaze over right middle finger — steady and focused.","Keep torso upright, not leaning forward or back.","Hold 30-45 seconds, repeat left side."],
cue:"Sink deep into the bent knee. Extend through both fingertips.",
ben:["Inner Thighs","Quads","Glutes","Shoulders","Stamina"]},

{id:"reverse-warrior",e:"🌈",n:"Reverse Warrior",s:"Viparita Virabhadrasana",l:"intermediate",c:"standing",cpm:3.8,dur:30,
desc:"A beautiful side stretch from Warrior II that opens the entire side body and builds lateral flexibility.",
steps:["From Warrior II with right knee bent.","Flip front palm up and reach right arm up and back.","Slide left hand down the back left leg.","Let the torso arc back and to the side in a long curve.","Keep the front knee bent at 90 degrees.","Hold 20-30 seconds, repeat other side."],
cue:"Create a long arc from your back heel to your fingertips.",
ben:["Side Body","Obliques","Hip Flexors","Chest","Shoulder Opening"]},

{id:"ext-side-angle",e:"📐",n:"Extended Side Angle",s:"Utthita Parsvakonasana",l:"intermediate",c:"standing",cpm:4.0,dur:30,
desc:"A lateral strengthening pose that opens the side body, strengthens the legs, and builds endurance.",
steps:["From Warrior II, lower right forearm to right thigh (or hand to floor outside foot).","Extend left arm over left ear, palm down — one long diagonal line.","Press outer edge of back foot firmly into mat.","Rotate top shoulder open toward the ceiling.","Gaze up at top hand or forward.","Hold 30 seconds, repeat other side."],
cue:"One long line from back foot to top fingertips. Open the chest to the ceiling.",
ben:["Side Body","Legs","Core","Chest","Stamina"]},

{id:"triangle",e:"📐",n:"Triangle Pose",s:"Trikonasana",l:"intermediate",c:"standing",cpm:3.5,dur:45,
desc:"A deep lateral stretch that opens the sides of the body, strengthens the legs, and improves balance.",
steps:["Feet wide, right foot right, left foot slightly in.","Extend arms parallel to floor.","Shift right hip back as you reach right hand to shin, ankle, or floor.","Extend left arm straight up toward ceiling.","Keep both legs straight. Gaze up at left hand.","Hold 30-45 seconds each side."],
cue:"Stack top hip over bottom. Open your chest to the ceiling.",
ben:["Hamstrings","IT Band","Side Body","Balance","Hip Opening"]},

{id:"warrior3",e:"🦅",n:"Warrior III",s:"Virabhadrasana III",l:"intermediate",c:"balance",cpm:4.5,dur:30,
desc:"A challenging balance pose that builds leg strength, core stability, and full-body coordination.",
steps:["Shift weight onto right foot from standing.","Lean torso forward as you lift left leg behind.","Aim for a T-shape — torso and lifted leg parallel to floor.","Arms extend forward, out to sides, or back alongside body.","Engage core and standing leg. Flex raised foot.","Hold 15-30 seconds each side."],
cue:"Reach through your raised heel as much as your extended arms.",
ben:["Balance","Core","Glutes","Hamstrings","Focus"]},

{id:"half-moon",e:"🌙",n:"Half Moon Pose",s:"Ardha Chandrasana",l:"intermediate",c:"balance",cpm:4.2,dur:30,
desc:"Combines strength, flexibility, and focus. Opens the hips and side body while challenging balance.",
steps:["From Triangle, bend right knee and place right hand on floor 12 inches in front of right foot.","Shift weight to right hand and foot.","Lift left leg parallel to floor, open left hip to ceiling.","Extend left arm toward ceiling.","Gaze at floor for stability or look up at top hand.","Hold 15-30 seconds each side."],
cue:"Stack hips and shoulders. Let the top side be free and open.",
ben:["Balance","Core","Hip Opening","Hamstrings","Focus"]},

{id:"chair",e:"💺",n:"Chair Pose",s:"Utkatasana",l:"intermediate",c:"standing",cpm:4.5,dur:30,
desc:"One of the most demanding standing poses. Burns calories, builds leg strength, and challenges mental fortitude.",
steps:["Stand with feet together or hip-width.","Inhale and raise arms overhead.","Exhale and bend knees deeply as if sitting into a chair.","Aim for thighs parallel to floor — or as low as you can go.","Keep chest lifted, weight in heels.","Hold 30-60 seconds. Feel the burn."],
cue:"Sit lower. Chest up. Arms active. Breathe through the discomfort.",
ben:["Quads","Glutes","Core","Ankles","Endurance"]},

{id:"eagle",e:"🦆",n:"Eagle Pose",s:"Garudasana",l:"intermediate",c:"balance",cpm:3.8,dur:30,
desc:"A complex balance pose that requires wrapping the limbs. Excellent for improving focus and coordination.",
steps:["Stand and shift weight to right foot.","Bend right knee slightly and cross left thigh over right.","Wrap left foot around right calf if possible.","Cross right arm under left at elbows, then wrap forearms, palms together.","Lift elbows to shoulder height and sink deeper.","Hold 20-30 seconds, repeat other side."],
cue:"Every wrap squeezes the midline. Breathe wide into your back.",
ben:["Balance","Hip Flexibility","Shoulder Mobility","Focus","Ankles"]},

{id:"tree",e:"🌳",n:"Tree Pose",s:"Vrksasana",l:"intermediate",c:"balance",cpm:3.2,dur:45,
desc:"The classic balance pose. Builds ankle stability, leg strength, and concentration. Great for developing focus.",
steps:["Stand on right foot. Bend left knee.","Place left foot on inner right thigh or calf (never on the knee).","Press foot into leg and leg back into foot.","Bring hands to heart center or raise overhead.","Fix gaze on a still point in front of you.","Hold 30-60 seconds, repeat other side."],
cue:"Find stillness in the ground. Your standing leg is the trunk — rooted.",
ben:["Balance","Leg Strength","Hip Flexibility","Focus","Posture"]},

{id:"pigeon",e:"🕊️",n:"Pigeon Pose",s:"Eka Pada Rajakapotasana",l:"intermediate",c:"seated",cpm:2.8,dur:90,
desc:"One of the deepest hip openers in yoga. Targets the piriformis and hip flexors — crucial for cyclists.",
steps:["From downward dog, bring right knee forward toward right wrist.","Lower right shin to floor at an angle.","Extend left leg straight back, knee and top of foot on floor.","Square hips forward as much as possible.","Stay upright on hands or fold forward over front shin.","Hold 60-120 seconds, repeat left side."],
cue:"Breathe into the tension. This is the hip opening cyclists need.",
ben:["Hip Flexors","Piriformis","IT Band","Lower Back","Psoas"]},

{id:"boat",e:"⛵",n:"Boat Pose",s:"Navasana",l:"intermediate",c:"core",cpm:5.0,dur:30,
desc:"An intense core strengthener targeting the abs, hip flexors, and lower back simultaneously.",
steps:["Sit with knees bent, feet flat.","Lean back slightly and lift feet off floor, balance on sitting bones.","Extend legs to 45 degrees (or straighten fully).","Extend arms forward parallel to floor, palms facing.","Keep chest lifted, spine long — do NOT round.","Hold 20-30 seconds. Rest and repeat 3-5 times."],
cue:"Lift through your chest, not just your legs. Core works as a unit.",
ben:["Core","Hip Flexors","Lower Back","Balance","Digestion"]},

{id:"camel",e:"🐪",n:"Camel Pose",s:"Ustrasana",l:"intermediate",c:"backbend",cpm:3.8,dur:30,
desc:"A deep chest and hip flexor opener. One of the best antidotes to phone and desk posture.",
steps:["Kneel with knees hip-width, tops of feet flat.","Hands on lower back, fingers pointing down.","Engage core, slowly arch back, opening chest to ceiling.","Reach back for heels one at a time if comfortable.","Keep hips over knees.","Hold 20-30 seconds. Come out slowly."],
cue:"Open your chest to the sky. Let your heart lead the way back.",
ben:["Chest","Hip Flexors","Spine","Posture","Energy"]},

{id:"bow",e:"🏹",n:"Bow Pose",s:"Dhanurasana",l:"intermediate",c:"backbend",cpm:4.5,dur:30,
desc:"A full backbend that simultaneously strengthens the back and stretches the front of the body.",
steps:["Lie face down, arms at sides.","Bend knees and reach back to grab ankles.","Inhale and lift chest and thighs simultaneously off the floor.","Rock on your belly if you can.","Keep knees hip-width — don't let them splay.","Hold 20-30 seconds, release, repeat 2-3 times."],
cue:"Kick feet into hands and hands away from feet — the tension creates the lift.",
ben:["Back Strength","Chest","Hip Flexors","Hamstrings","Posture"]},

{id:"locust",e:"🦗",n:"Locust Pose",s:"Salabhasana",l:"intermediate",c:"backbend",cpm:4.0,dur:30,
desc:"A prone backbend that directly strengthens the lower back — often neglected and very important.",
steps:["Lie face down, arms alongside body, palms facing up.","Forehead or chin on mat.","Inhale and simultaneously lift head, chest, arms, and legs.","Keep legs straight and together.","Reach actively through arms behind you.","Hold 20-30 seconds, lower, rest, repeat."],
cue:"Squeeze your inner thighs toward each other. Reach your fingertips toward your feet.",
ben:["Lower Back","Glutes","Hamstrings","Core","Posture"]},

{id:"seated-twist",e:"🌀",n:"Seated Spinal Twist",s:"Ardha Matsyendrasana",l:"intermediate",c:"twist",cpm:2.5,dur:60,
desc:"One of the most important twists. Detoxifying for the organs, releases the spine, and stretches the outer hips.",
steps:["Sit with legs extended. Bend right knee and cross foot over left leg, planting outside left knee.","Place right hand on the floor behind you.","Wrap left arm around right knee or hook elbow to knee.","Inhale to lengthen spine, exhale to twist right.","Hold 30-60 seconds, then switch sides."],
cue:"Inhale to grow tall, exhale to twist deeper. The spine must lengthen before it rotates.",
ben:["Spine","Outer Hip","Digestion","IT Band","Lower Back"]},

{id:"rev-warrior",e:"🌈",n:"Revolved Triangle",s:"Parivrtta Trikonasana",l:"intermediate",c:"twist",cpm:3.8,dur:30,
desc:"A challenging twist that combines balance, hamstring flexibility, and spinal rotation.",
steps:["Stand feet wide, right foot forward.","Bring left hand to outside of right foot or block.","Open right arm toward ceiling, twisting torso right.","Keep hips level and square as possible.","Keep both legs straight (slight bend in front knee is fine).","Hold 20-30 seconds each side."],
cue:"Lengthen your spine before you rotate. Roots before the branch can twist.",
ben:["Hamstrings","Spine","Balance","Detox","Hip Stability"]},

{id:"thread-needle",e:"🧵",n:"Thread the Needle",s:"Parsva Balasana",l:"intermediate",c:"twist",cpm:2.2,dur:60,
desc:"A gentle shoulder and upper back twist done from hands and knees. Excellent for tight shoulders.",
steps:["Start in tabletop on hands and knees.","Slide right arm under left arm along the floor, shoulder coming down.","Rest right cheek or temple on the mat.","Left arm stays extended or presses into floor for leverage.","Breathe into the right shoulder and upper back.","Hold 30-60 seconds, repeat other side."],
cue:"Let your shoulder melt into the mat. Breathe into the tight spots.",
ben:["Upper Back","Shoulders","Neck","Thoracic Spine","Stress Relief"]},

{id:"pyramid",e:"🏛️",n:"Pyramid Pose",s:"Parsvottanasana",l:"intermediate",c:"standing",cpm:3.2,dur:45,
desc:"An intense hamstring stretch combined with hip balance. Develops focus and lengthens the entire back of the body.",
steps:["Stand with right foot forward, left foot back at 45 degrees, feet hip-width.","Square hips as much as possible toward front.","Inhale and lengthen spine, exhale and fold over front leg.","Keep both legs straight (slight bend if needed).","Hands on floor, shins, or in prayer behind back.","Hold 30-45 seconds each side."],
cue:"Fold over your front leg like a pyramid. Keep the back hip from lifting.",
ben:["Hamstrings","Hip Alignment","Balance","Lower Back","Calves"]},

{id:"wide-fold",e:"🦁",n:"Wide-Legged Forward Fold",s:"Prasarita Padottanasana",l:"intermediate",c:"standing",cpm:2.8,dur:60,
desc:"A wide-stance forward fold that opens the inner thighs and hamstrings while providing mild inversion benefits.",
steps:["Stand with feet wide apart (4-5 feet).","Place hands on hips.","Inhale and lengthen spine.","Exhale and hinge forward from hips, placing hands on floor.","Walk hands back between feet, lowering crown of head toward floor.","Hold 30-60 seconds."],
cue:"Press outer edges of feet down. Let gravity lengthen your spine.",
ben:["Inner Thighs","Hamstrings","Inversion","Lower Back","Calming"]},

{id:"crescent-lunge",e:"🌙",n:"Crescent Lunge",s:"Ashta Chandrasana",l:"intermediate",c:"standing",cpm:4.0,dur:45,
desc:"A powerful variation of Low Lunge with the back knee lifted. Builds serious leg and core strength.",
steps:["From standing, step right foot forward into a deep lunge.","Lift back knee off the floor, pressing back heel high.","Both legs are active and engaged.","Raise arms overhead and lift chest.","Stack front knee over ankle.","Hold 30-45 seconds, repeat other side."],
cue:"Back heel pushes high, front knee drives forward. Create opposing forces.",
ben:["Hip Flexors","Quads","Core","Balance","Upper Body"]},

{id:"upward-dog",e:"🐕",n:"Upward Dog",s:"Urdhva Mukha Svanasana",l:"intermediate",c:"backbend",cpm:3.0,dur:20,
desc:"A deeper backbend than Cobra that also strengthens the arms and wrists. Key pose in sun salutations.",
steps:["Lie face down, hands under shoulders.","Press tops of feet into mat (not tucked under).","Press hands firmly and fully straighten arms, lifting entire torso and thighs off floor.","Only hands and tops of feet touch the mat.","Lift chest high, gaze forward or slightly up.","Hold 15-30 seconds."],
cue:"Press the floor away fully — hips and thighs completely off the mat.",
ben:["Chest","Wrists","Arms","Back Strength","Hip Flexors"]},

{id:"half-pigeon",e:"🕊️",n:"Half Pigeon Forward Fold",s:"Ardha Kapotasana",l:"intermediate",c:"seated",cpm:2.2,dur:120,
desc:"Pigeon with a forward fold. A deeper, more restorative version that targets the hip rotators intensely.",
steps:["Set up pigeon with right shin forward.","Walk hands forward and lower forehead to mat or stacked fists.","Keep hips as square as possible.","Breathe into the right outer hip and glute.","With each exhale, allow the hip to soften.","Hold 90-120 seconds, repeat left side."],
cue:"The deeper you breathe, the deeper you'll go. Don't rush this one.",
ben:["Piriformis","Hip Rotators","IT Band","Lower Back","Stress Relief"]},

{id:"dolphin",e:"🐬",n:"Dolphin Pose",s:"Ardha Pincha Mayurasana",l:"intermediate",c:"inversion",cpm:4.2,dur:30,
desc:"A forearm-supported inversion preparation that builds shoulder strength for headstand and forearm stand.",
steps:["Start in forearm plank — elbows under shoulders, forearms on mat.","Curl toes under and press hips up as in downward dog.","Walk feet toward elbows as far as possible.","Press forearms firmly into mat, lift hips high.","Keep neck relaxed, gaze between hands or at feet.","Hold 20-30 seconds."],
cue:"Press your forearms into the earth like you're trying to push it away.",
ben:["Shoulders","Core","Hamstrings","Inversion Prep","Upper Back"]},

{id:"fish",e:"🐟",n:"Fish Pose",s:"Matsyasana",l:"intermediate",c:"backbend",cpm:2.8,dur:30,
desc:"A chest-opening backbend that counters shoulder rounding. Often used as a counter-pose after shoulder stand.",
steps:["Lie on back with arms alongside body, palms down.","Press elbows into floor and lift chest high.","Tilt head back and rest crown or top of head lightly on mat.","The weight should be on elbows and forearms — not the neck.","Legs can be straight or crossed in lotus.","Hold 20-30 seconds."],
cue:"Most of the weight is on your elbows, not your head. Lift your chest high.",
ben:["Chest","Throat","Shoulders","Hip Flexors","Energy"]},

{id:"hero",e:"🦸",n:"Hero Pose",s:"Virasana",l:"intermediate",c:"seated",cpm:1.8,dur:120,
desc:"A kneeling pose that stretches the knees, ankles, and quads deeply. Sit on a block if knees are sensitive.",
steps:["Kneel with knees together, feet wider than hips.","Sit your hips between your heels (use a block if needed).","Place hands on thighs, palms down.","Sit tall, lengthening the spine.","Keep toes pointing straight back.","Hold 1-3 minutes."],
cue:"Sit in this pose with the same dignity as a hero at rest.",
ben:["Quads","Knees","Ankles","Posture","Digestion"]},

{id:"cow-face",e:"🐮",n:"Cow Face Pose",s:"Gomukhasana",l:"intermediate",c:"seated",cpm:2.2,dur:60,
desc:"Deeply opens the hips and shoulders simultaneously. One of the most thorough stretches in yoga.",
steps:["Sit with left knee on top of right — knees stacked, feet out to sides.","Reach right arm up and bend elbow, hand behind head.","Reach left arm behind back from below.","Clasp hands behind back (use a strap if they don't reach).","Sit tall and breathe.","Hold 30-60 seconds, repeat other side."],
cue:"Stack the knees directly on top of each other for full effect.",
ben:["Hips","Shoulders","Chest","IT Band","Thoracic Spine"]},

{id:"half-lord",e:"🌀",n:"Half Lord of Fishes",s:"Ardha Matsyendrasana",l:"intermediate",c:"twist",cpm:2.5,dur:60,
desc:"A deep seated twist that massages the abdominal organs, releases the spine, and opens the outer hip.",
steps:["Sit with both legs extended. Bend right knee, foot flat on floor outside left thigh.","Option to bend left leg and tuck foot near right hip.","Left elbow hooks outside right knee.","Right hand on floor behind you.","Inhale to grow tall, exhale to twist right.","Hold 30-60 seconds, switch sides."],
cue:"Grow taller with every inhale, twist deeper with every exhale.",
ben:["Spine","Outer Hip","Organs","IT Band","Shoulder"]},

// ═══════════════════════════════════════════════════
// ADVANCED
// ═══════════════════════════════════════════════════
{id:"crow",e:"🐦",n:"Crow Pose",s:"Bakasana",l:"advanced",c:"balance",cpm:5.5,dur:20,
desc:"The gateway arm balance. Requires core strength, arm strength, and courage to lean forward and fly.",
steps:["Squat with feet together. Place hands flat, shoulder-width.","Bend elbows and rest knees on backs of upper arms.","Lean weight forward — this is the key step.","Lift one foot, then the other. Squeeze knees into arms.","Gaze forward, not down.","Hold as long as possible."],
cue:"Lean forward more than feels safe. That's the only way to fly.",
ben:["Upper Body","Core","Wrist Strength","Focus","Confidence"]},

{id:"side-crow",e:"🦅",n:"Side Crow",s:"Parsva Bakasana",l:"advanced",c:"balance",cpm:6.0,dur:15,
desc:"A rotational arm balance that takes crow to the next level. Requires core strength and hip flexibility.",
steps:["Squat and twist torso to the right.","Place both hands on the floor to the right of your feet.","Stack knees on right upper arm (both knees).","Lean forward and lift feet off the floor.","Keep legs together and active.","Hold 5-15 seconds, repeat other side."],
cue:"Both knees on ONE arm. Commit to the lean. Breathe.",
ben:["Core","Obliques","Arm Strength","Balance","Hip Flexibility"]},

{id:"headstand",e:"🙃",n:"Headstand",s:"Sirsasana",l:"advanced",c:"inversion",cpm:5.0,dur:60,
desc:"The king of yoga poses. Full-body strength, improved circulation, remarkable balance and focus.",
steps:["Kneel and interlace fingers on mat, forming a triangle base with forearms.","Place crown of head on mat, cradled by hands.","Straighten legs and walk feet toward face.","Engage core and lift one knee then the other to chest.","Extend legs straight up toward ceiling.","Hold 15-60 seconds. Counter with child's pose."],
cue:"Arms do most of the work — not your neck. Press forearms firmly.",
ben:["Full Body","Inversion","Balance","Focus","Circulation"]},

{id:"forearm-stand",e:"🤸",n:"Forearm Stand",s:"Pincha Mayurasana",l:"advanced",c:"inversion",cpm:5.5,dur:30,
desc:"A full inversion on the forearms requiring shoulder strength, core control, and significant balance.",
steps:["Set up like Dolphin Pose with forearms on mat.","Walk feet in close to your torso.","Kick one leg up and follow with the other.","Stack hips over shoulders over elbows.","Press forearms firmly into floor, engage core.","Hold 10-30 seconds. Use a wall when learning."],
cue:"The forearms are your foundation. Press them into the earth with intention.",
ben:["Shoulder Strength","Core","Balance","Full Inversion","Focus"]},

{id:"shoulder-stand",e:"🕯️",n:"Shoulder Stand",s:"Salamba Sarvangasana",l:"advanced",c:"inversion",cpm:4.0,dur:60,
desc:"The queen of yoga poses. Full inversion with thyroid stimulation, calming effects, and leg recovery benefits.",
steps:["Lie on back. Swing legs over head with momentum.","Support lower back with hands, elbows on mat.","Extend legs straight up toward ceiling.","Keep weight on shoulders and upper arms — not neck.","Gaze at chest, not to the side.","Hold 30-120 seconds. Counter with fish pose."],
cue:"Walk your hands down your back toward shoulders. The straighter the body, the easier.",
ben:["Full Inversion","Thyroid","Leg Recovery","Calming","Core"]},

{id:"plow",e:"🚜",n:"Plow Pose",s:"Halasana",l:"advanced",c:"inversion",cpm:3.5,dur:60,
desc:"An inversion that stretches the back of the neck and upper spine intensely. Often done after shoulder stand.",
steps:["From shoulder stand, lower straight legs over head to the floor.","Toes may or may not touch the floor.","Keep hands on lower back for support.","Keep legs as straight as possible.","Breathe slowly — this position compresses the chest.","Hold 30-60 seconds."],
cue:"Never turn your head in Plow. Breathe carefully into your upper back.",
ben:["Upper Back","Neck","Hamstrings","Inversion","Calming"]},

{id:"wheel",e:"🎡",n:"Wheel Pose",s:"Urdhva Dhanurasana",l:"advanced",c:"backbend",cpm:5.8,dur:20,
desc:"A full backbend that opens the entire front of the body. Energizing and powerful.",
steps:["Lie on back. Bend knees, feet flat hip-width.","Place hands by ears, fingers toward feet.","Press hands and feet simultaneously, lift hips.","Straighten arms (work toward it) and let head hang.","Press chest toward the wall behind you.","Hold 10-20 seconds. Rest knees to chest after."],
cue:"Press the floor away with your hands. Chest forward, hips high.",
ben:["Spine Flexibility","Chest","Shoulders","Hip Flexors","Energy"]},

{id:"king-pigeon",e:"👑",n:"King Pigeon Pose",s:"Raja Kapotasana",l:"advanced",c:"backbend",cpm:4.5,dur:30,
desc:"The full expression of pigeon — a deep backbend combined with a hip opener. Takes years to develop.",
steps:["From pigeon with right shin forward, prop up on hands.","Bend left knee and reach back with left hand to catch foot.","Arch back deeply and try to bring foot toward head.","Use both hands if possible.","Keep front hip pressing toward the floor.","Hold 15-30 seconds, repeat other side."],
cue:"Open through your entire front body. This is a pose of full surrender.",
ben:["Full Spine","Hip Flexors","Chest","Shoulders","Quadriceps"]},

{id:"side-plank",e:"💪",n:"Side Plank",s:"Vasisthasana",l:"advanced",c:"core",cpm:6.0,dur:30,
desc:"Powerful lateral core strengthener that builds shoulder stability and balance. Best oblique exercise in yoga.",
steps:["Start in plank on hands.","Shift weight to right hand and foot, stacking left foot on top.","Lift left arm to ceiling.","Keep body in one straight line — don't let hips sag.","Gaze at top hand or forward.","Hold 15-30 seconds each side."],
cue:"Push the floor away with your supporting hand. One plank of wood.",
ben:["Obliques","Core","Shoulder Stability","Balance","Wrist Strength"]},

{id:"king-dancer",e:"💃",n:"King Dancer",s:"Natarajasana",l:"advanced",c:"balance",cpm:4.8,dur:30,
desc:"A graceful and challenging balance pose that opens the chest and requires hip flexor flexibility.",
steps:["Stand on right foot. Bend left knee and reach back with left hand to grab ankle.","Extend right arm forward for balance.","Kick left foot back and up as high as you can.","Lean torso forward as leg rises — counterbalancing.","Find a fixed point to gaze at.","Hold 15-30 seconds, repeat other side."],
cue:"It's a backbend disguised as balance. Let your heart open forward.",
ben:["Balance","Hip Flexors","Chest","Shoulder","Core"]},

{id:"firefly",e:"✨",n:"Firefly Pose",s:"Tittibhasana",l:"advanced",c:"balance",cpm:6.5,dur:15,
desc:"An advanced arm balance demanding core strength, hip flexibility, and total body control.",
steps:["Squat with feet slightly wider than hips.","Thread arms under legs, placing hands behind heels.","Bend elbows slightly and shift weight back into hands.","Lift hips and extend legs straight out to sides.","Flex feet and keep legs as parallel to floor as possible.","Hold as long as possible."],
cue:"Squeeze arms with thighs. Your core is everything here.",
ben:["Core","Upper Body","Hip Flexibility","Arm Strength","Focus"]},

{id:"eight-angle",e:"🔢",n:"Eight-Angle Pose",s:"Astavakrasana",l:"advanced",c:"balance",cpm:6.5,dur:15,
desc:"A complex arm balance requiring the body to hook one leg over the upper arm while extending both legs.",
steps:["From seated, lift right leg and hook right thigh over right upper arm.","Place both hands on floor.","Hook left foot behind right foot.","Lean forward onto arms and lift hips, extending legs to the right.","Keep chest lifted, gaze forward.","Hold 5-15 seconds, repeat other side."],
cue:"The hooking is the key. Once the leg is hooked, the lean makes it fly.",
ben:["Core","Arms","Hip Flexibility","Balance","Coordination"]},

{id:"peacock",e:"🦚",n:"Peacock Pose",s:"Mayurasana",l:"advanced",c:"balance",cpm:7.0,dur:10,
desc:"One of the most demanding arm balances. Requires exceptional core and arm strength to balance horizontally.",
steps:["Kneel and place hands on floor, fingers pointing toward feet.","Bend elbows and press upper arms into belly.","Lean forward until belly rests on elbows.","Extend legs back and lean forward until feet lift off.","Body should be horizontal, parallel to floor.","Hold 5-10 seconds."],
cue:"Squeeze elbows together. The balance point is smaller than you think.",
ben:["Core","Arms","Wrists","Balance","Digestion Stimulation"]},

{id:"flying-pigeon",e:"🦅",n:"Flying Pigeon",s:"Eka Pada Galavasana",l:"advanced",c:"balance",cpm:6.0,dur:15,
desc:"Combines the hip opening of pigeon with the demands of arm balancing. A pose of grace and strength.",
steps:["Stand and cross right ankle over left thigh in figure four.","Bend standing leg and bring hands to floor.","Hook right foot around right upper arm.","Lean forward and slowly shift weight to hands.","Extend left leg back and up as you balance.","Hold 5-15 seconds, repeat other side."],
cue:"The hip opening from the figure four makes the balance achievable. Commit to the lean.",
ben:["Hip Opening","Core","Arms","Balance","Coordination"]},

{id:"scale",e:"⚖️",n:"Scale Pose",s:"Tolasana",l:"advanced",c:"balance",cpm:5.5,dur:15,
desc:"An arm balance done from a seated position, lifting the entire body off the floor. Builds serious core and arm strength.",
steps:["Sit in lotus or cross-legged position.","Place hands on floor beside hips.","Press palms down and engage core strongly.","Lift your entire lower body off the floor.","Keep legs tucked and body compact.","Hold 5-15 seconds."],
cue:"Round your lower back like a C and compress. That's the lift.",
ben:["Core","Arms","Wrists","Hip Flexors","Focus"]},

{id:"handstand",e:"🙌",n:"Handstand",s:"Adho Mukha Vrksasana",l:"advanced",c:"inversion",cpm:6.0,dur:20,
desc:"The ultimate inversion. Full body upside down on the hands requires total body strength and fearlessness.",
steps:["Face the wall. Place hands 6 inches from wall, shoulder-width.","Walk feet in close and look between your hands.","Kick one leg up strongly and follow with the other.","Engage core and press legs toward the wall.","Press floor away with your hands — active arms.","Hold 5-30 seconds."],
cue:"Press the floor away like you're trying to push the earth down. Spread your fingers.",
ben:["Full Body Strength","Balance","Wrists","Core","Confidence"]},

{id:"wild-thing",e:"🌟",n:"Wild Thing",s:"Camatkarasana",l:"advanced",c:"backbend",cpm:4.5,dur:20,
desc:"A joyful, expressive backbend that opens the chest and hip flexors from a side plank base.",
steps:["From side plank on right hand.","Flip your body open — lift hips high.","Step left foot back and down behind right leg.","Let right hip drop and back arch.","Reach left arm up and over in a backbend.","Hold 15-20 seconds, repeat other side."],
cue:"This pose is meant to feel like throwing yourself open to the world.",
ben:["Chest","Hip Flexors","Shoulder","Core","Backbend"]},

{id:"lotus",e:"💮",n:"Lotus Pose",s:"Padmasana",l:"advanced",c:"seated",cpm:1.5,dur:120,
desc:"The iconic meditation seat. Takes years of hip opening to do without strain. Never force this pose.",
steps:["Sit in easy pose. Take right foot and place on top of left thigh, sole facing up.","Take left foot and place on top of right thigh, sole facing up.","Both knees ideally touch the floor.","Hands on knees in mudra.","Spine long and tall.","Hold as long as comfortable."],
cue:"Only enter lotus if your hips allow it fully. Never force the knees.",
ben:["Hip Opening","Meditation","Posture","Ankle Flexibility","Focus"]},

{id:"standing-split",e:"🤸",n:"Standing Split",s:"Urdhva Prasarita Eka Padasana",l:"advanced",c:"balance",cpm:4.0,dur:30,
desc:"A challenging single-leg balance with a forward fold. Opens the hamstrings and hip flexors deeply.",
steps:["From standing forward fold, shift weight to right foot.","Lift left leg as high as possible toward the ceiling.","Keep both hips squared toward the floor.","Hands can be on the floor, ankle, or shin.","Flex the raised foot.","Hold 20-30 seconds, repeat other side."],
cue:"Square your hips — don't let the lifting hip rotate open.",
ben:["Hamstrings","Balance","Hip Flexors","Core","Focus"]},

{id:"splits",e:"🙆",n:"Full Splits",s:"Hanumanasana",l:"advanced",c:"seated",cpm:3.0,dur:60,
desc:"The full front split. One of yoga's most demanding flexibility poses. Takes months or years to achieve safely.",
steps:["From low lunge with right foot forward, start to slide feet apart.","Keep hips squared forward.","Lower hips toward the floor using blocks for support.","Front leg is straight, back leg extends behind, top of foot on floor.","Hands at hips or extended overhead.","Hold 30-60 seconds, repeat other side."],
cue:"Use blocks. This pose cannot be forced. Let the hip flexor surrender over time.",
ben:["Hip Flexors","Hamstrings","Hip Opening","Groin","Patience"]},

{id:"chin-stand",e:"😶",n:"Chin Stand",s:"Gandha Bherundasana",l:"advanced",c:"backbend",cpm:5.0,dur:10,
desc:"An extreme backbend where the chin rests on the floor while the legs extend overhead. Requires exceptional spine flexibility.",
steps:["Start lying face down, hands under shoulders.","Press up into a deep Cobra.","Continue arching back as far as possible.","Walk feet toward head.","Lower chin to mat if your spine allows.","This is a pose for very flexible practitioners only."],
cue:"Never force this. It is years of backbend work expressing itself.",
ben:["Full Spine Flexibility","Chest","Shoulders","Hip Flexors","Back Strength"]},

// ═══════════════════════════════════════════════════
// MOBILITY FLOWS (added 2026-08-11)
// ═══════════════════════════════════════════════════
{id:"figure8",e:"➰",n:"Hip Figure 8s",s:"Ashtanga Chalanasana",l:"beginner",c:"seated",cpm:2.4,dur:60,
desc:"A fluid hip-mobility drill tracing a figure-8 pattern through the pelvis. Loosens the hips and lower back and warms up the SI joint.",
steps:["Stand with feet a bit wider than hips, soft knees, hands on hips.","Shift weight into the right hip, then trace the pelvis forward, across, and back in a figure-8 path.","Let the motion flow continuously — don't stop at the corners.","Keep the upper body relatively still; the movement stays in the hips and pelvis.","Reverse the direction of the 8 halfway through.","Continue 45-60 seconds, moving slow and controlled."],
cue:"Trace a lazy figure-8 with your hips — smooth and continuous, not choppy.",
ben:["Hip Mobility","SI Joint","Lower Back","Pelvic Control","Warm-Up"]},

{id:"spinalrot",e:"🔄",n:"Seated Spinal Rotations",s:"Parivrtta Sukhasana Flow",l:"beginner",c:"twist",cpm:2.2,dur:60,
desc:"A gentle, repeated rotational drill through the thoracic spine. Improves rotational mobility and eases tension along the back.",
steps:["Sit cross-legged or in a chair, spine tall.","Place right hand on left knee, left hand behind you on the floor/chair back.","Inhale to lengthen the spine, exhale to rotate left from the ribcage.","Lead the twist with the breath, not force — go a little further each exhale.","Return to center with control, then repeat to the other side.","Alternate sides continuously for 45-60 seconds."],
cue:"Lengthen up out of the hips first, then twist — don't collapse into the rotation.",
ben:["Thoracic Mobility","Spinal Health","Digestion","Posture","Back Tension"]},

{id:"cobraroll",e:"🐍",n:"Cobra Rolls",s:"Bhujangasana Chalanasana",l:"beginner",c:"backbend",cpm:2.6,dur:60,
desc:"A wave-like flow from Chaturanga through Cobra and back, rolling through the spine one segment at a time. Builds spinal articulation and back extensor strength.",
steps:["Lie face down, hands under shoulders, elbows hugging the ribs.","Inhale, roll up through the spine one vertebra at a time — tailbone, low back, mid back, chest, then head last.","Keep the pelvis and lower ribs light on the mat as you rise, avoiding a hard crunch into the low back.","Exhale, reverse the roll — head lowers first, then chest, then unstack down to the tailbone.","Keep the motion slow and wave-like the entire time.","Repeat for 45-60 seconds."],
cue:"Roll through the spine like a wave — one vertebra at a time, not a single hinge.",
ben:["Spinal Articulation","Back Extensors","Core Control","Posture","Mobility"]},

{id:"barrelroll",e:"🛢️",n:"Barrel Rolls",s:"Vasisthasana Chalanasana",l:"intermediate",c:"core",cpm:3.4,dur:45,
desc:"A rolling side-to-side drill through the torso, transitioning between side plank-like positions. Builds rotational core control and shoulder stability.",
steps:["Lie on your back, arms out in a T, knees bent and stacked.","Keeping shoulders grounded, let the knees roll to one side toward the floor.","Roll the knees back through center and continue to the opposite side, like a barrel rolling.","Keep the motion slow and controlled — this is mobility, not momentum.","Let the head gently counter-rotate opposite the knees for a full spinal wring.","Continue rolling side to side for 30-45 seconds."],
cue:"Move like a barrel rolling smoothly — slow, controlled, no momentum flinging you side to side.",
ben:["Rotational Core","Obliques","Spinal Mobility","Shoulder Stability","SI Joint"]},

{id:"downdogpedal",e:"🐕",n:"Downward Dog Pedals",s:"Adho Mukha Svanasana Chalanasana",l:"beginner",c:"standing",cpm:3.6,dur:60,
desc:"Downward Dog with alternating heel presses, 'pedaling' one leg at a time. Warms up calves and hamstrings and adds gentle movement to the classic hold.",
steps:["Start in Downward Dog — hips high, hands pressing firmly, spine long.","Bend the right knee and press the left heel toward the floor.","Switch, bending the left knee and pressing the right heel down.","Keep alternating in a smooth pedaling rhythm, like walking out the hamstrings.","Keep hips lifted and even the whole time — avoid rocking side to side.","Continue pedaling for 45-60 seconds."],
cue:"Pedal the feet like you're walking out your hamstrings — steady rhythm, hips stay tall.",
ben:["Hamstrings","Calves","Shoulders","Ankle Mobility","Warm-Up"]},

{id:"lizardlunge",e:"🦎",n:"Lizard Lunge",s:"Utthan Pristhasana",l:"intermediate",c:"standing",cpm:2.8,dur:60,
desc:"A deep hip-opening lunge with the front foot planted outside the hand. Targets hip flexors, groin, and hamstrings simultaneously.",
steps:["From Downward Dog, step the right foot forward outside the right hand.","Lower onto the left knee (or keep back leg lifted for more challenge).","Let the front knee track out over the pinky toe, hips sinking low and forward.","Keep the chest lifted or lower to forearms for a deeper stretch.","Breathe into the front hip and groin, letting it release with each exhale.","Hold 30-60 seconds, then switch sides."],
cue:"Sink the hips low and forward — let gravity open the front hip, don't force it.",
ben:["Hip Flexors","Groin","Hamstrings","Hip Opening","Deep Squat Prep"]},

{id:"lizardtwist",e:"🦎",n:"Lizard Twist",s:"Parivrtta Utthan Pristhasana",l:"intermediate",c:"twist",cpm:3.0,dur:45,
desc:"Lizard Lunge with an added rotation and reach, combining a deep hip opener with thoracic rotation. Great for the hips and mid-back together.",
steps:["Set up in Lizard Lunge, front foot outside the same-side hand.","Shift weight onto the outside hand, freeing the inside arm.","Rotate the chest open and reach the inside arm toward the ceiling.","Follow the reaching hand with your gaze if balance allows.","Hold the rotation for a few breaths, feeling the twist through the upper back.","Return to center, then switch sides."],
cue:"Rotate from the chest, not the low back — let the reaching arm lead the twist.",
ben:["Hip Opening","Thoracic Rotation","Balance","Groin","Obliques"]},

{id:"sidelunge",e:"🤸",n:"Side Lunge",s:"Skandasana",l:"beginner",c:"standing",cpm:3.0,dur:45,
desc:"A lateral lunge that stretches the inner thigh of the extended leg while strengthening the bent-knee side. Builds frontal-plane hip mobility often missing from forward-only training.",
steps:["Stand with feet wide, toes forward.","Shift weight into the right leg, bending the right knee and sitting the hips back.","Keep the left leg straight, foot flat, toes forward — feel the inner thigh stretch.","Keep the chest lifted and both feet grounded through the whole range.","Push through the right heel to return to center.","Repeat on the other side, alternating for 30-45 seconds."],
cue:"Sit back and down into the bent knee like a sideways squat — keep the straight leg's foot flat.",
ben:["Inner Thighs","Hip Mobility","Adductors","Groin","Frontal-Plane Strength"]},

{id:"revtable",e:"🪑",n:"Reverse Table Top",s:"Ardha Purvottanasana",l:"intermediate",c:"backbend",cpm:2.8,dur:45,
desc:"A backward-facing bridge-like pose that opens the chest and shoulders while strengthening the posterior chain and wrists.",
steps:["Sit with knees bent, feet flat, hands behind hips with fingers pointing toward feet.","Press through hands and feet to lift the hips until the torso is parallel to the floor.","Knees stack over ankles, shoulders stack over wrists — tabletop shape.","Let the head relax back gently, or keep it neutral if the neck is sensitive.","Squeeze the glutes and press the chest open.","Hold 20-45 seconds, then lower with control."],
cue:"Press the hips up like leveling a tabletop — knees and shoulders stacked over ankles and wrists.",
ben:["Shoulders","Chest","Glutes","Wrists","Posterior Chain"]},

{id:"headcircle",e:"⭕",n:"Head Circles",s:"Griva Chalanasana",l:"beginner",c:"seated",cpm:1.6,dur:60,
desc:"Slow, controlled circles of the head and neck. Releases tension in the cervical spine and upper traps — a gentle way to start or end a flow.",
steps:["Sit or stand tall, shoulders relaxed away from the ears.","Slowly drop the chin toward the chest.","Roll the head gently toward one shoulder, then back, then toward the other shoulder in a smooth circle.","Keep the movement slow and small — this is not a full aggressive neck roll.","Complete 4-5 circles one direction, then reverse.","Breathe steadily throughout, 45-60 seconds total."],
cue:"Keep it slow and small — let gravity do the work, don't force the range.",
ben:["Neck Tension","Cervical Mobility","Upper Traps","Stress Relief","Warm-Up"]},

// ═══════════════════════════════════════════════════
// CHARLIE FOLLOWS SET (added 2026-08-11)
// ═══════════════════════════════════════════════════
{id:"rev-high-lunge",e:"🤸",n:"Revolved High Lunge",s:"Parivrtta Ashta Chandrasana",l:"intermediate",c:"twist",cpm:3.2,dur:45,
desc:"High Lunge with a torso twist toward the front leg, arms extended in a T. Builds rotational control while under a hip-flexor stretch.",
steps:["Start in High Lunge, right foot forward, back heel lifted.","Square the hips forward and press the back heel toward the wall behind you.","Rotate the torso toward the front leg, sweeping arms out into a T.","Keep the front knee tracking over the ankle, back leg strong and straight.","Hold the twist for a few breaths, feeling length through the spine before rotating.","Untwist with control, then repeat on the other side."],
cue:"Lengthen the spine first, then rotate from the ribcage — the twist follows the length.",
ben:["Rotational Core","Hip Flexors","Balance","Thoracic Mobility","Leg Strength"]},

{id:"low-lunge-side",e:"🙆",n:"Low Lunge with Side Bend",s:"Anjaneyasana Variation",l:"beginner",c:"standing",cpm:2.6,dur:45,
desc:"Low Lunge with a lateral reach over the side body. Combines a hip-flexor stretch with a side-body opener.",
steps:["From Low Lunge, back knee down, front knee stacked over ankle.","Sink the hips forward and down to deepen the hip flexor stretch.","Reach the same-side arm as the back leg up and over into a side bend.","Let the opposite hand rest on the front thigh for support.","Breathe into the stretch along the ribs and hip together.","Hold 30-45 seconds, then switch sides."],
cue:"Sink the hips forward first, then reach up and over — don't shortcut the hip stretch for the side bend.",
ben:["Hip Flexors","Side Body","Obliques","Hip Opening","Posture"]},

{id:"rev-half-moon",e:"🌗",n:"Revolved Half Moon",s:"Parivrtta Ardha Chandrasana",l:"advanced",c:"balance",cpm:4.0,dur:30,
desc:"A standing balance pose combining a forward hinge, a twist, and a lifted back leg. Demands hip, hamstring, and core coordination together.",
steps:["From a forward fold, shift weight onto the right foot.","Lift the left leg straight back to hip height as the torso hinges forward.","Lower the right hand (or a block) to the floor under the shoulder.","Rotate the torso open, reaching the left arm toward the ceiling.","Keep the standing knee soft, not locked, and the lifted leg active.","Hold a few breaths, then release with control and switch sides."],
cue:"Root through the standing foot first — the twist and lift both come from a stable base, not the reverse.",
ben:["Balance","Hamstrings","Rotational Core","Hip Stability","Focus"]},

{id:"standing-fold-bound",e:"🙇",n:"Standing Forward Fold, Bound Arms",s:"Uttanasana Variation",l:"intermediate",c:"standing",cpm:2.4,dur:45,
desc:"Standing Forward Fold with the arms clasped behind the back and lifted overhead. Adds a shoulder and chest opener to the hamstring stretch.",
steps:["Stand with feet hip-width, then hinge forward from the hips into a fold.","Clasp the hands behind your back, arms straight.","Let the fold deepen as you lift the clasped arms up and over, away from your back.","Keep a slight bend in the knees if the hamstrings are tight.","Let the head hang heavy, breathing into the stretch.","Hold 30-45 seconds, then release the hands before rolling up."],
cue:"Lift the clasped hands up and away from your back — that's what opens the shoulders here.",
ben:["Hamstrings","Shoulders","Chest","Spinal Decompression","Stress Relief"]},

{id:"highplank",e:"🧍",n:"High Plank",s:"Phalakasana",l:"beginner",c:"core",cpm:3.4,dur:45,
desc:"A full-body isometric hold from hands to toes. Builds core, shoulder, and full-body stability that underlies most other poses.",
steps:["Start on hands and knees, wrists stacked under shoulders.","Step feet back one at a time into a straight line from head to heels.","Press the floor away, spreading fingers wide, engaging the shoulders.","Draw the belly in and squeeze the glutes to keep the hips level — no sagging or piking.","Keep the neck long, gaze slightly forward of the hands.","Hold 20-45 seconds, breathing steadily throughout."],
cue:"Push the floor away and zip the ribs down — a straight line from head to heels, nothing sagging.",
ben:["Core Strength","Shoulder Stability","Full-Body Strength","Posture","Wrist Strength"]},

{id:"side-plank-mod",e:"🤸",n:"Modified Side Plank (Kneeling)",s:"Supported Vasisthasana",l:"beginner",c:"core",cpm:2.6,dur:30,
desc:"A kneeling version of Side Plank that stacks a lateral side-body and neck stretch on top of the core and shoulder work.",
steps:["Kneel, then lower onto the right forearm or hand, knees stacked and bent behind you.","Lift the hips so the body forms a diagonal line from knee to shoulder.","Extend the left arm overhead, reaching long through the side body.","Optionally tilt the head away from the lifted arm for a gentle neck stretch.","Keep the hips lifted and square, not sagging toward the floor.","Hold 20-30 seconds, then switch sides."],
cue:"Lift the hips up and reach long through the top arm — think one long line from knee to fingertips.",
ben:["Obliques","Shoulder Stability","Side Body","Neck Release","Core"]},

{id:"chaturanga",e:"💪",n:"Chaturanga",s:"Chaturanga Dandasana",l:"intermediate",c:"core",cpm:4.0,dur:15,
desc:"A low push-up hold with elbows hugging the ribs. Builds the pressing strength that links plank to upward-facing dog in a vinyasa flow.",
steps:["Start in High Plank, shoulders slightly ahead of the wrists.","Shift weight forward, then bend the elbows straight back, hugging the ribs.","Lower until the upper arms are roughly parallel to the floor — no lower.","Keep the body in one straight line the entire way down, no sagging hips.","Hold briefly at the bottom or flow directly into Upward Dog or Cobra.","For a modified version, lower the knees to the floor first."],
cue:"Elbows hug the ribs like closing a door — don't let them wing out to the sides.",
ben:["Triceps","Shoulders","Core Strength","Chest","Full-Body Control"]},

{id:"prone-pec",e:"🦅",n:"Prone Pec Stretch",s:"Broken Wing Pose",l:"intermediate",c:"backbend",cpm:2.0,dur:45,
desc:"A deep chest and shoulder stretch performed lying prone with one arm extended to a T, rolling weight onto the side and hip.",
steps:["Lie face down, right arm extended straight out to the side in a T, palm down.","Bend the left knee and plant the left foot near the right knee.","Use the left foot to push, rolling the hips and chest up and over the right arm.","Let the right shoulder and chest sink toward the floor, feeling the stretch through the chest and front shoulder.","Rest the head on the mat or turn it away from the extended arm.","Hold 30-45 seconds, then roll back and switch sides."],
cue:"Let gravity roll the chest open over the extended arm — don't force the roll, sink into it.",
ben:["Chest","Front Shoulder","Rotator Cuff","Thoracic Mobility","Posture"]},

{id:"kneeling-sugarcane",e:"🏹",n:"Kneeling Sugarcane",s:"Supported Vasisthasana Variation",l:"advanced",c:"backbend",cpm:3.2,dur:30,
desc:"Modified Side Plank with a reach back to catch the top foot, adding a quad and hip-flexor stretch to the side-body and shoulder work of Side Plank.",
steps:["Set up in Modified Side Plank (Kneeling), hips lifted, top arm reaching overhead.","Bend the top knee, reaching the top hand back to catch the top foot.","Draw the heel toward the glute, feeling the stretch through the quad and hip flexor.","Keep the hips lifted and square — don't let them sag as you reach back.","Press the foot into the hand slightly to deepen the bow shape.","Hold 20-30 seconds, then release and switch sides."],
cue:"Keep the hips lifted first, then reach back for the foot — the bow shape comes after the hips are set.",
ben:["Quads","Hip Flexors","Obliques","Shoulder Stability","Balance"]},

{id:"banana",e:"🍌",n:"Banana Pose",s:"Bananasana",l:"beginner",c:"restorative",cpm:1.6,dur:60,
desc:"A reclined crescent-shaped side stretch with the ankles crossed. A gentle, passive way to lengthen the entire side body.",
steps:["Lie on your back, then walk both feet and hips a few inches to the right.","Cross the right ankle over the left, staying in that shifted crescent shape.","Reach both arms overhead and shift them slightly to the right as well, creating a full-body banana curve.","Relax completely into the stretch along the left side body.","Breathe slowly, letting the stretch deepen with each exhale.","Hold 45-60 seconds, then switch to curve the other direction."],
cue:"Let the whole body curve like a banana — hips, ribs, and arms all shift the same direction.",
ben:["Side Body","Obliques","Lats","Relaxation","Spinal Decompression"]},

{id:"windshield-wipers",e:"🚗",n:"Reclined Windshield Wipers",s:"Jathara Parivartanasana Variation",l:"beginner",c:"twist",cpm:2.2,dur:45,
desc:"Bent knees sweeping side to side while lying on the back (or belly), gently massaging and mobilizing the lower spine.",
steps:["Lie on your back, knees bent and stacked, feet flat, arms out in a T.","Keeping the knees together, let them fall slowly to the right toward the floor.","Keep both shoulders grounded as the knees lower.","Sweep the knees back through center and continue to the left side.","Keep the movement slow and controlled, breathing with each sweep.","Continue side to side for 30-45 seconds."],
cue:"Keep both shoulders glued to the floor — the twist happens below the ribs, not through the upper back.",
ben:["Lower Back","SI Joint","Spinal Mobility","Obliques","Relaxation"]},

{id:"side-leg-ext",e:"🦵",n:"Side-Lying Leg Extensions",s:"Anantasana Variation",l:"beginner",c:"core",cpm:2.4,dur:45,
desc:"Lying on the side, drawing the top knee to the chest and then extending the leg skyward. Builds hip flexibility and hamstring control together.",
steps:["Lie on your right side, head resting on the right arm or a block.","Draw the left knee in toward the chest, hugging it with the left hand.","Straighten the left leg up toward the ceiling, holding the foot, calf, or a strap.","Keep the leg as straight as comfortable without rounding the low back.","Lower back to the bent-knee hug, then extend again.","Repeat 6-8 times, then switch sides."],
cue:"Hug the knee in fully before you extend — don't rush straight to the straight-leg reach.",
ben:["Hamstrings","Hip Flexibility","Core Control","Balance","Leg Strength"]},

{id:"knees-chest",e:"🤰",n:"Knees-to-Chest",s:"Apanasana",l:"beginner",c:"restorative",cpm:1.6,dur:60,
desc:"A simple reclined pose hugging both knees to the chest. Gently massages the lower back and relieves tension after backbend or twist-heavy work.",
steps:["Lie on your back, then draw both knees in toward the chest.","Wrap the arms around the shins or behind the thighs.","Gently rock side to side or in small circles if it feels good on the low back.","Keep the head and shoulders relaxed on the mat.","Breathe slowly, letting the low back release with each exhale.","Hold 45-60 seconds, or longer as a resting pose."],
cue:"Let the knees pull gently toward the chest with each exhale — don't grip, just breathe into it.",
ben:["Lower Back","SI Joint","Digestion","Relaxation","Recovery"]},

{id:"wrist-rolls",e:"🤲",n:"Wrist Rolls",s:"Standing/Seated Wrist Mobility",l:"beginner",c:"seated",cpm:1.4,dur:45,
desc:"Simple circular wrist mobilization, done standing or seated. A quick warm-up before any weight-bearing hand work like Plank or Downward Dog.",
steps:["Extend both arms forward or clasp the hands together at chest height.","Slowly circle both wrists in one direction, going through the full range of motion.","Complete 8-10 slow circles, then reverse direction for another 8-10.","Keep the shoulders relaxed and the motion isolated to the wrists.","If seated, you can also press palms together and circle at the wrist joint.","Finish by gently shaking out the hands."],
cue:"Keep the circles slow and full — this is about range, not speed.",
ben:["Wrist Mobility","Forearms","Injury Prevention","Warm-Up","Circulation"]},

{id:"wrist-figure8",e:"➰",n:"Tabletop Wrist Figure 8s",s:"Tabletop Wrist Chalanasana",l:"beginner",c:"core",cpm:2.0,dur:45,
desc:"Weighted figure-8 circles through the wrist while in tabletop position. Builds wrist resilience and stability for load-bearing poses.",
steps:["Come to tabletop, hands under shoulders, knees under hips.","Keeping the palm planted, rock the weight in a figure-8 pattern through the wrist — forward-diagonal, back-diagonal, repeat.","Move slowly, exploring the full range without pain.","Complete 30 seconds on one hand, then switch.","Keep the shoulder stacked over the wrist as you rock, avoiding collapsing into the joint.","Breathe steadily throughout."],
cue:"Trace a slow figure-8 through the palm and wrist — small range, full control.",
ben:["Wrist Resilience","Forearm Strength","Injury Prevention","Grip Stability","Warm-Up"]},

{id:"neck-shoulder-release",e:"🙆",n:"Seated Neck & Shoulder Release",s:"Kneeling Griva Chalanasana",l:"beginner",c:"seated",cpm:1.6,dur:60,
desc:"A lateral ear-to-shoulder stretch with the hands clasped behind the lower back or gently guiding the head. Releases the upper traps and side of the neck.",
steps:["Sit or kneel tall, clasp the hands behind the lower back (or let one arm hang if that's more accessible).","Gently tilt the right ear toward the right shoulder, feeling the stretch along the left side of the neck.","Optionally use the right hand to add slight, gentle overpressure — never pull hard.","Keep the shoulders down and away from the ears throughout.","Hold 20-30 seconds, breathing slowly, then return to center.","Switch sides and repeat."],
cue:"Let the ear drift toward the shoulder — any hand pressure should be a whisper, not a pull.",
ben:["Neck Tension","Upper Traps","Stress Relief","Posture","Shoulder Release"]}

]; // end POSES

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
var filter = "all";
var routine = [];
var sessIdx = 0;
var timerInt = null;
var timerSecs = 0;
var CIRC = 301.6;
var collapsed = {beginner:false, intermediate:false, advanced:false};

// ═══════════════════════════════════════════════════
// CALORIE CALC
// ═══════════════════════════════════════════════════
function cal(cpm, secs) {
  var w = (typeof getLatestWeight==="function" && getLatestWeight()) ||
          (typeof START_WEIGHT!=="undefined" && START_WEIGHT) || WEIGHT || 200;
  return Math.round(cpm * (secs/60) * (w/150));
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════
function yogaSwitchTab(id) {
  document.querySelectorAll(".yg-tab-btn").forEach(function(b){ b.classList.remove("active"); });
  document.querySelectorAll(".yg-panel").forEach(function(p){ p.classList.remove("active"); });
  var btn = document.querySelector(".yg-tab-btn[data-ytab=\""+id+"\"]");
  if (btn) btn.classList.add("active");
  var panel = document.getElementById("yg-panel-"+id);
  if (panel) panel.classList.add("active");
  if (id==="routine") renderRoutine();
  if (id==="presets") renderPresets();
  if (id==="poses") renderPoses();
  if (id==="saved") renderSaved();
}
document.querySelectorAll(".yg-tab-btn").forEach(function(btn){
  btn.addEventListener("click", function(){ yogaSwitchTab(btn.dataset.ytab); });
});

// ── Yoga stats bar: minutes this month, sessions this month, current daily streak ──
function ygYogaDays() {
  // Returns sorted array of date keys (ascending) that have at least one type:"yoga" exercise logged
  var days = [];
  Object.keys(appData).forEach(function(k){
    var d = appData[k];
    if (d && d.exercises && d.exercises.some(function(e){ return e.type==="yoga"; })) days.push(k);
  });
  return days.sort();
}
function ygComputeStats() {
  var todayK = todayKey();
  var monthPrefix = todayK.slice(0,7); // "YYYY-MM"
  var totalMin = 0, sessions = 0;
  Object.keys(appData).forEach(function(k){
    if (k.slice(0,7)!==monthPrefix) return;
    var d = appData[k]; if (!d || !d.exercises) return;
    d.exercises.forEach(function(e){
      if (e.type!=="yoga") return;
      sessions++;
      var m = /\((\d+)(?:-(\d+))?\s*min/.exec(e.name||"");
      if (m) totalMin += m[2] ? Math.round((parseInt(m[1],10)+parseInt(m[2],10))/2) : parseInt(m[1],10);
    });
  });
  // Streak: consecutive days up to and including today (or yesterday, if today not logged yet)
  var days = ygYogaDays();
  var daySet = {}; days.forEach(function(k){ daySet[k]=true; });
  var streak = 0;
  var cursor = new Date(keyToDate(todayK));
  if (!daySet[todayK]) cursor.setDate(cursor.getDate()-1); // allow streak to still show if today just hasn't happened yet
  while (true) {
    var k = localDateKey(cursor);
    if (daySet[k]) { streak++; cursor.setDate(cursor.getDate()-1); }
    else break;
  }
  return {totalMin:totalMin, sessions:sessions, streak:streak};
}
function ygRenderStatsBar() {
  var el = document.getElementById("yoga-stats-bar"); if (!el) return;
  var s = ygComputeStats();
  el.innerHTML =
    '<div class="yoga-stat"><div class="yoga-stat-val">'+s.streak+'</div><div class="yoga-stat-lbl">Day streak</div></div>'+
    '<div class="yoga-stat"><div class="yoga-stat-val">'+s.totalMin+'</div><div class="yoga-stat-lbl">Min this month</div></div>'+
    '<div class="yoga-stat"><div class="yoga-stat-val">'+s.sessions+'</div><div class="yoga-stat-lbl">Sessions this month</div></div>';
}
try { ygRenderStatsBar(); } catch(e) {}

// ═══════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════
function setFilter(f, el) {
  filter = f;
  document.querySelectorAll(".fbtn").forEach(function(b){ b.classList.remove("active"); });
  el.classList.add("active");
  renderPoses();
}

// ═══════════════════════════════════════════════════
// RENDER POSES
// ═══════════════════════════════════════════════════
function renderPoses() {
  var q = document.getElementById("pose-search").value.toLowerCase();
  var levels = ["beginner","intermediate","advanced"];
  var html = "";

  levels.forEach(function(level) {
    var poses = POSES.filter(function(p){
      var mSearch = !q || p.n.toLowerCase().indexOf(q)>=0 || p.s.toLowerCase().indexOf(q)>=0 || p.ben.join(" ").toLowerCase().indexOf(q)>=0 || p.c.indexOf(q)>=0;
      var mFilter = filter==="all" || filter===level || filter===p.c;
      return p.l===level && mSearch && mFilter;
    });
    if (!poses.length) return;

    var lcolor = level==="beginner"?"var(--sage)":level==="intermediate"?"var(--gold)":"var(--rose)";
    var isCollapsed = collapsed[level] && !q;

    html += '<div class="diff-section">';
    html += '<div class="diff-header" onclick="toggleSection(\''+level+'\')">';
    html += '<div class="diff-title" style="color:'+lcolor+'">'+level.charAt(0).toUpperCase()+level.slice(1)+'</div>';
    html += '<div class="diff-count">'+poses.length+' poses</div>';
    html += '<div class="diff-toggle'+(isCollapsed?" collapsed":"")+'">&#9660;</div>';
    html += '</div>';
    html += '<div class="diff-poses'+(isCollapsed?" collapsed":"") +'" id="sec-'+level+'">';

    poses.forEach(function(p){
      var inR = routine.some(function(r){ return r.pose.id===p.id; });
      var c = cal(p.cpm, p.dur);
      var tagCls = p.l==="beginner"?"tag-b":p.l==="intermediate"?"tag-i":"tag-a";
      var demoHtml = (typeof YOGA_DEMOS!=="undefined" && YOGA_DEMOS[p.id]) ? YOGA_DEMOS[p.id]() : p.e;
      html += '<div class="pose-card'+(inR?" selected":"") +'" id="card-'+p.id+'">';
      html += '<div class="pose-header" onclick="toggleDetail(\''+p.id+'\')">';
      html += '<div class="pose-emoji">'+demoHtml+'</div>';
      html += '<div class="pose-info">';
      html += '<div class="pose-name">'+p.n+'</div>';
      html += '<span class="pose-sanskrit">'+p.s+'</span>';
      html += '<div class="pose-tags"><span class="tag '+tagCls+'">'+p.l+'</span><span class="tag tag-c">'+p.c+'</span></div>';
      html += '</div>';
      html += '<div class="pose-right">';
      html += '<button class="add-btn'+(inR?" added":"") +'" onclick="event.stopPropagation();toggleRoutine(\''+p.id+'\')">'+(inR?"✓":"+")+'</button>';
      html += '<div class="cal-badge">~'+c+' cal</div>';
      html += '</div></div>';
      // Detail panel
      html += '<div class="pose-detail" id="det-'+p.id+'">';
      html += '<div class="pose-demo-large">'+demoHtml+'</div>';
      html += '<div class="det-sec"><div class="det-lbl">About</div><div class="det-txt">'+p.desc+'</div></div>';
      html += '<div class="det-sec"><div class="det-lbl">How To</div><ol class="steps-list">';
      p.steps.forEach(function(step,i){
        html += '<li><span class="snum">'+(i+1)+'</span><span>'+step+'</span></li>';
      });
      html += '</ol></div>';
      html += '<div class="det-sec"><div class="det-lbl">Coaching Cue</div><div class="det-txt" style="color:var(--gold);font-style:italic">'+p.cue+'</div></div>';
      html += '<div class="det-sec"><div class="det-lbl">Benefits</div><div class="benefits">';
      p.ben.forEach(function(b){ html += '<span class="bchip">'+b+'</span>'; });
      html += '</div></div>';
      html += '<div class="det-sec"><div class="det-lbl">Duration for Routine</div><div class="dur-row">';
      [30,45,60,90,120,180].forEach(function(s){
        var lbl = s<60?s+"s":(s===60?"1m":(s===90?"90s":(s===120?"2m":"3m")));
        html += '<div class="dur-opt'+(p.dur===s?" sel":"") +'" onclick="setDur(\''+p.id+'\','+s+',this)">';
        html += '<div class="dur-val">'+lbl+'</div></div>';
      });
      html += '</div></div></div>';
      html += '</div>'; // pose-card
    });

    html += '</div></div>'; // diff-poses + diff-section
  });

  document.getElementById("poses-container").innerHTML = html;
}

function toggleSection(level) {
  collapsed[level] = !collapsed[level];
  renderPoses();
}

function toggleDetail(id) {
  var el = document.getElementById("det-"+id);
  if (el) el.classList.toggle("open");
}

function setDur(poseId, secs, el) {
  var pose = POSES.find(function(p){ return p.id===poseId; });
  if (!pose) return;
  pose.dur = secs;
  el.closest(".dur-row").querySelectorAll(".dur-opt").forEach(function(d){ d.classList.remove("sel"); });
  el.classList.add("sel");
  var badge = document.querySelector("#card-"+poseId+" .cal-badge");
  if (badge) badge.textContent = "~"+cal(pose.cpm,secs)+" cal";
  var ri = routine.findIndex(function(r){ return r.pose.id===poseId; });
  if (ri>=0) { routine[ri].dur = secs; }
}

// ═══════════════════════════════════════════════════
// ROUTINE
// ═══════════════════════════════════════════════════
function toggleRoutine(poseId) {
  var pose = POSES.find(function(p){ return p.id===poseId; });
  if (!pose) return;
  var idx = routine.findIndex(function(r){ return r.pose.id===poseId; });
  if (idx>=0) { routine.splice(idx,1); } else { routine.push({pose:pose,dur:pose.dur}); }
  updateCount();
  var btn = document.querySelector("#card-"+poseId+" .add-btn");
  var card = document.getElementById("card-"+poseId);
  var inR = routine.some(function(r){ return r.pose.id===poseId; });
  if (btn){ btn.className="add-btn"+(inR?" added":""); btn.textContent=inR?"✓":"+"; }
  if (card){ inR?card.classList.add("selected"):card.classList.remove("selected"); }
}

function updateCount() {
  document.getElementById("rp-count").textContent = routine.length;
}

function clearRoutine() {
  routine = [];
  updateCount();
  renderRoutine();
  renderPoses();
}

function removeFromRoutine(idx) {
  var poseId = routine[idx].pose.id;
  routine.splice(idx,1);
  updateCount();
  renderRoutine();
  var btn = document.querySelector("#card-"+poseId+" .add-btn");
  var card = document.getElementById("card-"+poseId);
  if (btn){ btn.className="add-btn"; btn.textContent="+"; }
  if (card) card.classList.remove("selected");
}

function setRoutineDur(idx, secs) {
  if (!routine[idx]) return;
  routine[idx].dur = secs;
  renderRoutine();
}

function renderRoutine() {
  var empty = document.getElementById("r-empty");
  var content = document.getElementById("r-content");
  if (!routine.length) { empty.style.display="block"; content.style.display="none"; return; }
  empty.style.display="none"; content.style.display="block";

  var totCal=0, totSecs=0;
  routine.forEach(function(r){ totCal+=cal(r.pose.cpm,r.dur); totSecs+=r.dur; });
  var totMins = Math.round(totSecs/60);
  var cpm = totMins>0?(totCal/totMins).toFixed(1):0;

  document.getElementById("tot-cal").textContent=totCal;
  document.getElementById("tot-poses").textContent=routine.length;
  document.getElementById("tot-mins").textContent=totMins;
  document.getElementById("tot-cpm").textContent=cpm;

  document.getElementById("r-list").innerHTML = routine.map(function(r,i){
    var c=cal(r.pose.cpm,r.dur);
    return '<div class="r-item">'+
      '<div class="r-emoji">'+r.pose.e+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div class="r-name">'+r.pose.n+'</div>'+
        '<div class="r-durs">'+
          [30,45,60,90,120].map(function(s){
            var lbl=s<60?s+"s":(s===60?"1m":(s===90?"90s":"2m"));
            return '<button class="rdb'+(r.dur===s?" sel":"") +'" onclick="setRoutineDur('+i+','+s+')">'+lbl+'</button>';
          }).join("")+
        '</div>'+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0">'+
        '<div class="r-cal">~'+c+' cal</div>'+
        '<div class="r-meta">'+(r.dur<60?r.dur+"s":(r.dur/60).toFixed(r.dur%60===0?0:1)+"m")+'</div>'+
      '</div>'+
      '<button class="r-del" onclick="removeFromRoutine('+i+')">✕</button>'+
    '</div>';
  }).join("");
}

// ═══════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════
function ygStartSession() {
  if (!routine.length) return;
  ygPaused = false;
  sessIdx=0;
  // Create + unlock AudioContext HERE — directly inside the button tap gesture
  // This is the ONLY reliable way to unlock audio on iOS Safari
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === "suspended") {
      _audioCtx.resume();
    }
    // Play a silent buffer to fully unlock audio on iOS
    var buf = _audioCtx.createBuffer(1, 1, 22050);
    var src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_audioCtx.destination);
    src.start(0);
  } catch(e) {}
  document.getElementById("sess-ov").classList.add("open");
  ygBreathStart();
  ygLoadPose();
}

// ── Breath-sync ring: 4s inhale, 6s exhale, matches the breathPulse CSS keyframe ──
var ygBreathInt=null;
function ygBreathStart(){
  var ring=document.getElementById("breath-ring"); if(ring)ring.classList.add("on");
  ygBreathTick(); clearInterval(ygBreathInt);
  ygBreathInt=setInterval(ygBreathTick, 100);
}
function ygBreathTick(){
  if(ygPaused)return;
  var lbl=document.getElementById("breath-lbl"); if(!lbl)return;
  var t=(Date.now()/1000)%10;
  var phase=t<4?"Inhale":"Exhale";
  if(lbl.textContent!==phase){ lbl.textContent=phase; lbl.style.opacity=0; setTimeout(function(){lbl.style.opacity=1;},50); }
}
function ygBreathPause(on){
  var ring=document.getElementById("breath-ring"); if(!ring)return;
  if(on) ring.classList.remove("on"); else ring.classList.add("on");
}
function ygBreathStop(){
  clearInterval(ygBreathInt); ygBreathInt=null;
  var ring=document.getElementById("breath-ring"); if(ring)ring.classList.remove("on");
}

var ygInfoOpen=false;
function ygToggleInfo(){
  ygInfoOpen=!ygInfoOpen;
  var panel=document.getElementById("sess-info"), tog=document.getElementById("sess-info-tog");
  if(panel) panel.classList.toggle("open", ygInfoOpen);
  if(tog) tog.textContent=(ygInfoOpen?"▴":"▾")+" Pose details";
}
function ygRenderInfo(p){
  var panel=document.getElementById("sess-info"); if(!panel||!p) return;
  var h="";
  if(p.desc){ h+='<div class="si-sec"><div class="si-lbl">About</div><div class="si-txt">'+p.desc+'</div></div>'; }
  if(p.steps&&p.steps.length){
    h+='<div class="si-sec"><div class="si-lbl">How to</div><ol>';
    p.steps.forEach(function(s){ h+='<li>'+s+'</li>'; });
    h+='</ol></div>';
  }
  if(p.ben&&p.ben.length){
    h+='<div class="si-sec"><div class="si-lbl">Benefits</div><div>';
    p.ben.forEach(function(b){ h+='<span class="si-chip">'+b+'</span>'; });
    h+='</div></div>';
  }
  panel.innerHTML=h||'<div class="si-txt">No extra detail for this pose.</div>';
  panel.classList.toggle("open", ygInfoOpen);
  var tog=document.getElementById("sess-info-tog");
  if(tog) tog.textContent=(ygInfoOpen?"▴":"▾")+" Pose details";
}

function ygLoadPose() {
  var item=routine[sessIdx];
  if (!item) return;
  var p=item.pose;
  document.getElementById("sess-prog").textContent="Pose "+(sessIdx+1)+" of "+routine.length;
  var demoEl=document.getElementById("sess-demo");
  if (demoEl) demoEl.innerHTML = (typeof YOGA_DEMOS!=="undefined" && YOGA_DEMOS[p.id]) ? YOGA_DEMOS[p.id]() : "";
  var badge=document.getElementById("sess-emoji-badge"); if(badge) badge.textContent=p.e;
  document.getElementById("sess-name").textContent=p.n;
  document.getElementById("sess-sans").textContent=p.s;
  document.getElementById("sess-cue").textContent=p.cue;
  ygRenderInfo(p);
  document.getElementById("sess-nxt").textContent=sessIdx===routine.length-1?"Finish ✓":"Next ›";
  startTimer(item.dur);
}

// ── Audio cues using Web Audio API (no files needed) ──────────────
var _audioCtx = null;
var _audioUnlocked = false;

// Unlock audio on the FIRST user interaction anywhere in the app.
// Previously the AudioContext was only unlocked inside ygStartSession()
// (yoga tab), so rest-timer beeps on the Today tab fired on a suspended
// context and were silently dropped by the browser.
function dsUnlockAudio() {
  try {
    if (!_audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      _audioCtx = new Ctx();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    var buf = _audioCtx.createBuffer(1, 1, 22050);
    var src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_audioCtx.destination);
    src.start(0);
    if (_audioCtx.state === "running") _audioUnlocked = true;
  } catch (e) {}
}
(function () {
  function onFirstTouch() {
    dsUnlockAudio();
    if (_audioUnlocked) {
      document.removeEventListener('pointerdown', onFirstTouch, true);
      document.removeEventListener('touchstart', onFirstTouch, true);
      document.removeEventListener('click', onFirstTouch, true);
    }
  }
  document.addEventListener('pointerdown', onFirstTouch, true);
  document.addEventListener('touchstart', onFirstTouch, true);
  document.addEventListener('click', onFirstTouch, true);
  // Browsers suspend the context when the app is backgrounded — re-arm on return.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && _audioCtx && _audioCtx.state === 'suspended') {
      try { _audioCtx.resume(); } catch (e) {}
    }
  });
})();

function dsTestSound() {
  var el = document.getElementById('ds-sound-status');
  function say(msg, ok) { if (el) { el.textContent = msg; el.style.color = ok ? '#5eead4' : '#f87171'; } }
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { say('This browser has no Web Audio support.', false); return; }
    dsUnlockAudio();
    var ctx = _audioCtx;
    function fire() {
      [0, 0.15, 0.3].forEach(function (delay) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.25);
      });
      say('Played 3 beeps — context: ' + ctx.state + '. If silent, check the device is not on vibrate/silent and that media volume (not ringer) is up.', true);
    }
    if (ctx.state === 'suspended') {
      ctx.resume().then(fire).catch(function () { say('Audio blocked by browser (context suspended).', false); });
    } else { fire(); }
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
  } catch (err) {
    say('Error: ' + (err && err.message ? err.message : err), false);
  }
}

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // iOS requires resume() if context was suspended
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume();
  }
  return _audioCtx;
}

function yogaBeep(freq, dur, vol) {
  try {
    var ctx = getAudioCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(vol || 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.3));
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (dur || 0.3));
  } catch(e) {}
}

function yogaBeepWarning() {
  // 5-second warning: two soft mid beeps
  yogaBeep(660, 0.15, 0.3);
  setTimeout(function(){ yogaBeep(660, 0.15, 0.3); }, 200);
}

function yogaBeepEnd() {
  // Pose ends: three descending tones
  yogaBeep(880, 0.2, 0.5);
  setTimeout(function(){ yogaBeep(660, 0.2, 0.5); }, 250);
  setTimeout(function(){ yogaBeep(440, 0.3, 0.5); }, 500);
}

function yogaBeepStart() {
  // New pose starts: two ascending tones
  yogaBeep(440, 0.15, 0.4);
  setTimeout(function(){ yogaBeep(660, 0.25, 0.5); }, 200);
}

var ygPaused = false;
function ygTogglePause() {
  ygPaused = !ygPaused;
  var btn = document.getElementById("yg-pause-btn");
  if (btn) btn.innerHTML = ygPaused ? "&#9654; Resume" : "&#9646;&#9646; Pause";
  ygBreathPause(ygPaused);
}
function startTimer(secs) {
  clearInterval(timerInt);
  timerSecs=secs;
  var total=secs;
  ygHideUpNext();
  tick(secs,total);
  if (secs<=5) ygShowUpNext(); // short pose — preview immediately, there's no later 5s mark to catch
  timerInt=setInterval(function(){
    if (ygPaused) return;
    timerSecs--;
    tick(timerSecs,total);
    if (timerSecs===5) {
      yogaBeepWarning(); // warn at 5 seconds left
      ygShowUpNext(); // preview the next pose so there's time to get ready
    }
    if (timerSecs<=0){
      clearInterval(timerInt);
      yogaBeepEnd(); // end of pose
      if (sessIdx<routine.length-1) {
        // Show rest countdown for 5 seconds
        var restCount = 5;
        document.getElementById("sess-cue").textContent = "Rest... next pose in " + restCount + "s";
        document.getElementById("t-num").textContent = restCount + "s";
        var restInt = setInterval(function(){
          restCount--;
          document.getElementById("sess-cue").textContent = restCount > 0
            ? "Rest... next pose in " + restCount + "s"
            : "Get ready...";
          document.getElementById("t-num").textContent = restCount > 0 ? restCount + "s" : "Go!";
          if (restCount <= 0) {
            clearInterval(restInt);
            sessIdx++;
            ygLoadPoseWithStartBeep();
          }
        }, 1000);
      }
    }
  },1000);
}

function ygShowUpNext() {
  if (sessIdx>=routine.length-1) return; // last pose, nothing to preview
  var next=routine[sessIdx+1]; if(!next) return;
  var p=next.pose;
  var demoEl=document.getElementById("sess-upnext-demo");
  if (demoEl) demoEl.innerHTML = (typeof YOGA_DEMOS!=="undefined" && YOGA_DEMOS[p.id]) ? YOGA_DEMOS[p.id]() : p.e;
  var nameEl=document.getElementById("sess-upnext-name"); if(nameEl) nameEl.textContent=p.n;
  var strip=document.getElementById("sess-upnext"); if(strip) strip.classList.add("show");
}
function ygHideUpNext() {
  var strip=document.getElementById("sess-upnext"); if(strip) strip.classList.remove("show");
}

function ygLoadPoseWithStartBeep() {
  ygLoadPose();
  setTimeout(function(){ yogaBeepStart(); }, 300); // slight delay so display updates first
}

function tick(rem,total) {
  var m=Math.floor(rem/60), s=rem%60;
  document.getElementById("t-num").textContent=m+":"+(s<10?"0":"")+s;
  var offset=CIRC*(1-(rem/total));
  document.getElementById("t-arc").style.strokeDashoffset=offset;
}

function ygNextPose() {
  clearInterval(timerInt);
  if (sessIdx>=routine.length-1){ ygEndSession(); ygShowDone(); return; }
  // Manual next - no rest period, go immediately with start beep
  sessIdx++;
  ygLoadPoseWithStartBeep();
}

function ygPrevPose() {
  clearInterval(timerInt);
  if (sessIdx<=0) return;
  sessIdx--;
  ygLoadPose();
}

function ygEndSession() {
  clearInterval(timerInt);
  ygBreathStop();
  document.getElementById("sess-ov").classList.remove("open");
}

function ygShowDone() {
  var totCal=0;
  var totMins=0;
  routine.forEach(function(r){ totCal+=cal(r.pose.cpm,r.dur); totMins+=Math.round(r.dur/60); });
  document.getElementById("done-cal").textContent=totCal;
  document.getElementById("done-ov").classList.add("open");
  // Cross-log to fitness tracker
  try {
    var d=new Date();
    var dk=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    var ftData = JSON.parse(store.get("ft_data")||"{}");
    if (!ftData[dk]) ftData[dk]={foods:[],exercises:[],weight:null,waterOz:0,wellness:{},supplements:{}};
    if (!ftData[dk].exercises) ftData[dk].exercises=[];
    var label="Yoga ("+totMins+" min)";
    var already=ftData[dk].exercises.some(function(x){return x.name===label;});
    if (!already) {
      ftData[dk].exercises.push({name:label,calories:calAdj(totCal),type:"yoga",id:Date.now().toString()});
      store.set("ft_data",JSON.stringify(ftData));
      if(typeof appData!=="undefined") appData=ftData;
      if(typeof renderAll==="function") renderAll();
      if(typeof pushToSheets==="function") pushToSheets();
    }
  } catch(e){}
  try { ygRenderStatsBar(); } catch(e) {}
}

function ygCloseDone() {
  document.getElementById("done-ov").classList.remove("open");
}


// ═══════════════════════════════════════════════════
// PRESET ROUTINES
// ═══════════════════════════════════════════════════
var PRESETS = [
  {
    id:"hamstring-length",
    icon:"🦵",
    name:"Hamstring Length & Strength",
    desc:"Builds real, retained hamstring range — not just temporary looseness. Standing work first while you're warm, then long loaded holds. Best on Wednesday or a rest day, NOT before a lower session.",
    level:"intermediate",
    duration:"~25 min",
    focus:"Hamstring Extensibility",
    poses:[
      {id:"easy-pose",       dur:60},
      {id:"catcow",          dur:60},
      {id:"downdog",         dur:60},
      {id:"standing-forward",dur:75},
      {id:"pyramid",         dur:75},
      {id:"pyramid",         dur:75},
      {id:"wide-fold",       dur:90},
      {id:"triangle",        dur:60},
      {id:"triangle",        dur:60},
      {id:"standing-split",  dur:60},
      {id:"standing-split",  dur:60},
      {id:"staff",           dur:45},
      {id:"seated-forward",  dur:150},
      {id:"half-lord",       dur:60},
      {id:"half-lord",       dur:60},
      {id:"bridge",          dur:60},
      {id:"supine-twist",    dur:60},
      {id:"supine-twist",    dur:60},
      {id:"legs-up",         dur:180},
      {id:"corpse",          dur:120}
    ]
  },
  {
    id:"post-ride-hamstring",
    icon:"🚴",
    name:"Post-Ride Hamstring Reset",
    desc:"Short Saturday option for straight after the bike. Hamstrings are warm and shortened from the saddle — this is passive, no forcing. Pairs with or replaces Post-Ride Recovery.",
    level:"beginner",
    duration:"~15 min",
    focus:"Post-Ride Hamstrings",
    poses:[
      {id:"childs",          dur:60},
      {id:"downdog",         dur:60},
      {id:"standing-forward",dur:75},
      {id:"pyramid",         dur:60},
      {id:"pyramid",         dur:60},
      {id:"low-lunge",       dur:60},
      {id:"low-lunge",       dur:60},
      {id:"staff",           dur:45},
      {id:"seated-forward",  dur:120},
      {id:"happy-baby",      dur:60},
      {id:"supine-twist",    dur:45},
      {id:"supine-twist",    dur:45},
      {id:"legs-up",         dur:180}
    ]
  },
  {
    id:"morning-wake",
    icon:"🌅",
    name:"Morning Wake-Up",
    desc:"A gentle 15-minute flow to ease into the day. Opens the spine, hips, and chest. Perfect before coffee.",
    level:"beginner",
    duration:"~15 min",
    focus:"Energizing",
    poses:[
      {id:"easy-pose",    dur:60},
      {id:"catcow",       dur:60},
      {id:"puppy",        dur:45},
      {id:"downdog",      dur:45},
      {id:"low-lunge",    dur:45},
      {id:"low-lunge",    dur:45},
      {id:"standing-forward",dur:45},
      {id:"mountain",     dur:30},
      {id:"cobra",        dur:30},
      {id:"childs",       dur:60},
      {id:"supine-twist", dur:45},
      {id:"supine-twist", dur:45},
      {id:"corpse",       dur:120}
    ]
  },
  {
    id:"hip-opener",
    icon:"🦋",
    name:"Deep Hip Release",
    desc:"Targets the hips, hip flexors, and glutes. Essential after long bike rides or sitting all day. Go slow.",
    level:"beginner",
    duration:"~25 min",
    focus:"Hip Flexibility",
    poses:[
      {id:"easy-pose",       dur:60},
      {id:"butterfly",       dur:90},
      {id:"low-lunge",       dur:60},
      {id:"low-lunge",       dur:60},
      {id:"pigeon",          dur:120},
      {id:"pigeon",          dur:120},
      {id:"half-pigeon",     dur:90},
      {id:"half-pigeon",     dur:90},
      {id:"supine-twist",    dur:60},
      {id:"supine-twist",    dur:60},
      {id:"happy-baby",      dur:90},
      {id:"reclined-butterfly",dur:180},
      {id:"legs-up",         dur:180}
    ]
  },
  {
    id:"post-ride",
    icon:"🚵",
    name:"Post-Ride Recovery",
    desc:"Built specifically for after your Saturday mountain bike rides. Targets quads, hamstrings, IT band, and lower back.",
    level:"beginner",
    duration:"~20 min",
    focus:"Recovery",
    poses:[
      {id:"standing-forward",dur:60},
      {id:"low-lunge",       dur:60},
      {id:"low-lunge",       dur:60},
      {id:"pyramid",         dur:45},
      {id:"pyramid",         dur:45},
      {id:"pigeon",          dur:120},
      {id:"pigeon",          dur:120},
      {id:"supine-twist",    dur:60},
      {id:"supine-twist",    dur:60},
      {id:"legs-up",         dur:300}
    ]
  },
  {
    id:"core-strength",
    icon:"💪",
    name:"Core & Strength",
    desc:"A challenging core-focused flow. Burns serious calories and builds the functional strength that carries over to everything else.",
    level:"intermediate",
    duration:"~25 min",
    focus:"Strength & Calorie Burn",
    poses:[
      {id:"mountain",       dur:30},
      {id:"chair",          dur:45},
      {id:"warrior1",       dur:45},
      {id:"warrior1",       dur:45},
      {id:"warrior2",       dur:45},
      {id:"warrior2",       dur:45},
      {id:"warrior3",       dur:30},
      {id:"warrior3",       dur:30},
      {id:"boat",           dur:30},
      {id:"boat",           dur:30},
      {id:"side-plank",     dur:30},
      {id:"side-plank",     dur:30},
      {id:"locust",         dur:30},
      {id:"bridge",         dur:45},
      {id:"childs",         dur:60}
    ]
  },
  {
    id:"stress-relief",
    icon:"🧘",
    name:"Stress & Anxiety Relief",
    desc:"A slow, restorative practice focused on calming the nervous system. Ideal for evenings or high-stress days.",
    level:"beginner",
    duration:"~30 min",
    focus:"Calming",
    poses:[
      {id:"easy-pose",        dur:120},
      {id:"catcow",           dur:90},
      {id:"childs",           dur:120},
      {id:"thread-needle",    dur:60},
      {id:"thread-needle",    dur:60},
      {id:"puppy",            dur:90},
      {id:"seated-forward",   dur:90},
      {id:"butterfly",        dur:90},
      {id:"supine-twist",     dur:60},
      {id:"supine-twist",     dur:60},
      {id:"happy-baby",       dur:90},
      {id:"reclined-butterfly",dur:180},
      {id:"legs-up",          dur:300},
      {id:"corpse",           dur:300}
    ]
  },
  {
    id:"sun-salutation",
    icon:"☀️",
    name:"Sun Salutation Flow",
    desc:"The classic yoga sequence done as a flowing practice. Each breath links to a movement. Energizing and complete.",
    level:"intermediate",
    duration:"~20 min",
    focus:"Flow & Energy",
    poses:[
      {id:"mountain",         dur:20},
      {id:"standing-forward", dur:20},
      {id:"low-lunge",        dur:30},
      {id:"downdog",          dur:30},
      {id:"cobra",            dur:20},
      {id:"downdog",          dur:30},
      {id:"low-lunge",        dur:30},
      {id:"standing-forward", dur:20},
      {id:"mountain",         dur:20},
      {id:"chair",            dur:30},
      {id:"warrior1",         dur:30},
      {id:"warrior2",         dur:30},
      {id:"reverse-warrior",  dur:20},
      {id:"ext-side-angle",   dur:30},
      {id:"triangle",         dur:30},
      {id:"childs",           dur:60},
      {id:"corpse",           dur:120}
    ]
  },
  {
    id:"balance-focus",
    icon:"🌿",
    name:"Balance & Focus",
    desc:"A balance-heavy sequence that builds single-leg strength, ankle stability, and laser focus. Great before a big day.",
    level:"intermediate",
    duration:"~20 min",
    focus:"Balance & Mental Clarity",
    poses:[
      {id:"mountain",    dur:45},
      {id:"tree",        dur:45},
      {id:"tree",        dur:45},
      {id:"warrior3",    dur:30},
      {id:"warrior3",    dur:30},
      {id:"half-moon",   dur:30},
      {id:"half-moon",   dur:30},
      {id:"eagle",       dur:30},
      {id:"eagle",       dur:30},
      {id:"king-dancer", dur:20},
      {id:"king-dancer", dur:20},
      {id:"standing-split",dur:30},
      {id:"standing-split",dur:30},
      {id:"childs",      dur:60},
      {id:"corpse",      dur:120}
    ]
  },
  {
    id:"back-pain",
    icon:"🔙",
    name:"Lower Back Relief",
    desc:"Specifically designed to relieve lower back tension. A combination of gentle stretches and strengthening moves.",
    level:"beginner",
    duration:"~20 min",
    focus:"Back Pain Relief",
    poses:[
      {id:"catcow",        dur:90},
      {id:"childs",        dur:90},
      {id:"sphinx",        dur:60},
      {id:"cobra",         dur:30},
      {id:"bridge",        dur:45},
      {id:"bridge",        dur:45},
      {id:"supine-twist",  dur:60},
      {id:"supine-twist",  dur:60},
      {id:"happy-baby",    dur:90},
      {id:"knee-to-chest", dur:60},
      {id:"legs-up",       dur:180},
      {id:"corpse",        dur:120}
    ]
  },
  {
    id:"power-yoga",
    icon:"🔥",
    name:"Power Yoga Burn",
    desc:"A high-intensity, calorie-torching sequence for those days when you want your yoga to feel like a real workout.",
    level:"advanced",
    duration:"~30 min",
    focus:"Maximum Calorie Burn",
    poses:[
      {id:"chair",         dur:45},
      {id:"warrior1",      dur:45},
      {id:"warrior2",      dur:45},
      {id:"warrior3",      dur:30},
      {id:"half-moon",     dur:30},
      {id:"crescent-lunge",dur:45},
      {id:"boat",          dur:30},
      {id:"boat",          dur:30},
      {id:"side-plank",    dur:30},
      {id:"side-plank",    dur:30},
      {id:"crow",          dur:20},
      {id:"wheel",         dur:20},
      {id:"locust",        dur:30},
      {id:"bow",           dur:30},
      {id:"camel",         dur:30},
      {id:"childs",        dur:60},
      {id:"corpse",        dur:120}
    ]
  },
  {
    id:"evening-unwind",
    icon:"🌙",
    name:"Evening Unwind",
    desc:"A 20-minute pre-bed sequence to decompress the body and calm the mind. Better sleep guaranteed.",
    level:"beginner",
    duration:"~20 min",
    focus:"Sleep & Recovery",
    poses:[
      {id:"easy-pose",        dur:90},
      {id:"seated-twist",     dur:60},
      {id:"seated-twist",     dur:60},
      {id:"butterfly",        dur:90},
      {id:"seated-forward",   dur:90},
      {id:"supine-twist",     dur:60},
      {id:"supine-twist",     dur:60},
      {id:"happy-baby",       dur:90},
      {id:"reclined-butterfly",dur:120},
      {id:"legs-up",          dur:300},
      {id:"corpse",           dur:300}
    ]
  },
  {
    id:"chest-shoulders",
    icon:"🏋️",
    name:"Chest & Shoulder Opener",
    desc:"Counteracts the forward hunch from cycling and screen time. Opens the chest and releases tight shoulders.",
    level:"intermediate",
    duration:"~20 min",
    focus:"Posture",
    poses:[
      {id:"puppy",       dur:60},
      {id:"thread-needle",dur:60},
      {id:"thread-needle",dur:60},
      {id:"cobra",       dur:30},
      {id:"sphinx",      dur:60},
      {id:"upward-dog",  dur:20},
      {id:"camel",       dur:30},
      {id:"bow",         dur:30},
      {id:"fish",        dur:30},
      {id:"bridge",      dur:45},
      {id:"wheel",       dur:20},
      {id:"childs",      dur:90},
      {id:"corpse",      dur:120}
    ]
  },
  {
    id:"arm-balance-intro",
    icon:"✈️",
    name:"Arm Balance Introduction",
    desc:"A progressive sequence building toward your first arm balance. Develops wrist strength, core, and confidence.",
    level:"advanced",
    duration:"~25 min",
    focus:"Arm Balances",
    poses:[
      {id:"downdog",      dur:45},
      {id:"dolphin",      dur:30},
      {id:"dolphin",      dur:30},
      {id:"boat",         dur:30},
      {id:"boat",         dur:30},
      {id:"side-plank",   dur:30},
      {id:"side-plank",   dur:30},
      {id:"crow",         dur:20},
      {id:"crow",         dur:20},
      {id:"side-crow",    dur:15},
      {id:"side-crow",    dur:15},
      {id:"scale",        dur:15},
      {id:"childs",       dur:90},
      {id:"corpse",       dur:120}
    ]
  }
];

var loadedPresetId = null;

function renderPresets() {
  var html = "";
  var log = ygPresetLog();
  var today = new Date().toISOString().slice(0,10);
  var ordered = PRESETS.slice().sort(function(a,b){
    var la=log[a.id], lb=log[b.id];
    var ta=la&&la.last?la.last:"", tb=lb&&lb.last?lb.last:"";
    if(ta!==tb) return ta<tb?1:-1; // most recent last-used first
    var ca=la&&la.count||0, cb=lb&&lb.count||0;
    if(ca!==cb) return cb-ca; // then most used
    return 0; // stable, preserves original order otherwise
  });
  ordered.forEach(function(pr) {
    // Calculate total cal and duration
    var totSecs = 0, totCal = 0, poseCount = 0;
    var validPoses = [];
    pr.poses.forEach(function(pp){
      var pose = POSES.find(function(p){ return p.id===pp.id; });
      if (pose) { totSecs+=pp.dur; totCal+=cal(pose.cpm,pp.dur); poseCount++; validPoses.push({pose:pose,dur:pp.dur}); }
    });
    var mins = Math.round(totSecs/60);
    var lvlCls = pr.level==="beginner"?"tag-b":pr.level==="intermediate"?"tag-i":"tag-a";
    var isLoaded = loadedPresetId===pr.id;
    var usage = log[pr.id];
    var usageBadge = "";
    if (usage && usage.last) {
      var daysAgo = Math.round((new Date(today)-new Date(usage.last))/86400000);
      var whenLbl = daysAgo<=0?"Today":daysAgo===1?"Yesterday":daysAgo+"d ago";
      usageBadge = '<span class="tag tag-usage">'+(usage.count>1?usage.count+'x \u00b7 ':'')+whenLbl+'</span>';
    }

    html += '<div class="preset-card" id="pc-'+pr.id+'">';
    html += '<div class="preset-top">';
    html += '<div class="preset-icon">'+pr.icon+'</div>';
    html += '<div class="preset-info">';
    html += '<div class="preset-name">'+pr.name+'</div>';
    html += '<div class="preset-meta">'+pr.duration+' &nbsp;\u00b7&nbsp; '+poseCount+' poses</div>';
    html += '<div class="preset-desc">'+pr.desc+'</div>';
    html += '<div class="preset-tags"><span class="tag '+lvlCls+'">'+pr.level+'</span><span class="tag tag-c">'+pr.focus+'</span>'+usageBadge+'</div>';
    html += '</div></div>';
    html += '<div class="preset-stats">';
    html += '<div class="pstat"><div class="pstat-val">'+poseCount+'</div><div class="pstat-lbl">Poses</div></div>';
    html += '<div class="pstat"><div class="pstat-val">'+mins+'</div><div class="pstat-lbl">Minutes</div></div>';
    html += '<div class="pstat"><div class="pstat-val">~'+totCal+'</div><div class="pstat-lbl">Calories</div></div>';
    html += '</div>';
    html += '<button class="preset-load-btn" data-pid="'+pr.id+'" onclick="loadPreset(this.dataset.pid)">'+
      (isLoaded ? '\u2713 Loaded \u2014 Go to My Routine' : '\u25B6 Load This Routine')+'</button>';
    html += '<div class="loaded-badge" id="lb-'+pr.id+'" style="'+(isLoaded?'display:block':'')+'">\u2713 Currently loaded in My Routine</div>';
    html += '<button class="toggle-poses-btn" data-pid="'+pr.id+'" onclick="togglePresetPoses(this.dataset.pid)">See poses \u25BE</button>';
    html += '<div class="preset-pose-list" id="ppl-'+pr.id+'">';
    validPoses.forEach(function(vp,i){
      var durLbl = vp.dur<60?vp.dur+"s":(vp.dur/60).toFixed(vp.dur%60===0?0:1)+"m";
      html += '<div class="ppl-item">';
      html += '<span class="ppl-num">'+(i+1)+'</span>';
      html += '<span class="ppl-emoji">'+vp.pose.e+'</span>';
      html += '<span class="ppl-name">'+vp.pose.n+'</span>';
      html += '<span class="ppl-dur">'+durLbl+'</span>';
      html += '</div>';
    });
    html += '</div></div>';
  });
  document.getElementById("presets-grid").innerHTML = html;
}

function togglePresetPoses(id) {
  var el = document.getElementById("ppl-"+id);
  if (el) el.classList.toggle("open");
}

// ── Preset usage tracking: powers "Last practiced" / "Most used" badges ──
function ygPresetLog() { try{ return JSON.parse(store.get("yoga_preset_log")||"{}"); }catch(e){ return {}; } }
function ygPresetLogSave(log) { try{ store.set("yoga_preset_log", JSON.stringify(log)); }catch(e){} }
function ygPresetMarkUsed(presetId) {
  var log = ygPresetLog();
  var entry = log[presetId] || {count:0, last:null};
  entry.count = (entry.count||0)+1;
  entry.last = new Date().toISOString().slice(0,10);
  log[presetId] = entry;
  ygPresetLogSave(log);
}

function loadPreset(presetId) {
  if (loadedPresetId === presetId) {
    // Already loaded — navigate to routine tab
    yogaSwitchTab("routine");
    return;
  }
  var pr = PRESETS.find(function(p){ return p.id===presetId; });
  if (!pr) return;

  var newRoutine = [];
  pr.poses.forEach(function(pp){
    var pose = POSES.find(function(p){ return p.id===pp.id; });
    if (pose) newRoutine.push({pose:pose, dur:pp.dur});
  });

  routine = newRoutine;
  loadedPresetId = presetId;
  ygPresetMarkUsed(presetId);
  updateCount();
  renderPresets();
  renderPoses(); // update + buttons

  // Brief confirmation then switch to routine
  setTimeout(function(){
    yogaSwitchTab("routine");
    renderRoutine();
  }, 400);
}


// ═══════════════════════════════════════════════════
// SAVED ROUTINES
// ═══════════════════════════════════════════════════
function getSaved() {
  try { return JSON.parse(store.get("yoga_saved") || "[]"); } catch(e) { return []; }
}
function putSaved(arr) {
  try { store.set("yoga_saved", JSON.stringify(arr)); } catch(e) {}
}

function saveRoutine() {
  if (!routine.length) return;
  var name = document.getElementById("routine-name").value.trim();
  if (!name) { name = "My Routine " + new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
  var saved = getSaved();
  var entry = {
    id: Date.now().toString(),
    name: name,
    date: new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}),
    poses: routine.map(function(r){ return {id:r.pose.id, dur:r.dur}; })
  };
  saved.unshift(entry);
  putSaved(saved);
  document.getElementById("routine-name").value = "";
  var msg = document.getElementById("save-msg");
  msg.textContent = 'Saved: ' + entry.name;
  setTimeout(function(){ msg.textContent=""; }, 3000);
  renderSaved();
}

function renderSaved() {
  var saved = getSaved();
  var el = document.getElementById("saved-list");
  var emptyEl = document.getElementById("saved-empty");
  if (!saved.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--dim);font-size:12px;font-family:var(--font-mono)">No saved routines yet.<br><br>Build a routine and tap Save.</div>';
    return;
  }
  el.innerHTML = saved.map(function(entry) {
    // Resolve poses
    var resolved = [];
    var totSecs=0, totCal=0;
    entry.poses.forEach(function(pp){
      var pose = POSES.find(function(p){ return p.id===pp.id; });
      if (pose){ resolved.push({pose:pose,dur:pp.dur}); totSecs+=pp.dur; totCal+=cal(pose.cpm,pp.dur); }
    });
    var mins = Math.round(totSecs/60);
    var preview = resolved.slice(0,6).map(function(r){ return r.pose.e; }).join(" ") + (resolved.length>6?" ...":"");

    return '<div class="saved-item">' +
      '<div class="saved-item-top">' +
        '<div class="saved-item-name">'+entry.name+'</div>' +
        '<div class="saved-item-date">'+entry.date+'</div>' +
      '</div>' +
      '<div class="saved-poses-preview">'+preview+'</div>' +
      '<div class="saved-item-meta">'+resolved.length+' poses &nbsp;·&nbsp; '+mins+' min &nbsp;·&nbsp; ~'+totCal+' cal</div>' +
      '<div class="saved-item-btns">' +
        '<button class="sib-load" data-id="'+entry.id+'" onclick="loadSaved(this.dataset.id)">▶ Load</button>' +
        '<button class="sib-del" data-id="'+entry.id+'" onclick="deleteSaved(this.dataset.id)">Delete</button>' +
      '</div>' +
    '</div>';
  }).join("");
}

function loadSaved(id) {
  var saved = getSaved();
  var entry = saved.find(function(e){ return e.id===id; });
  if (!entry) return;
  var newRoutine = [];
  entry.poses.forEach(function(pp){
    var pose = POSES.find(function(p){ return p.id===pp.id; });
    if (pose) newRoutine.push({pose:pose,dur:pp.dur});
  });
  routine = newRoutine;
  loadedPresetId = null;
  updateCount();
  renderPoses();
  yogaSwitchTab("routine");
  renderRoutine();
}

function deleteSaved(id) {
  var saved = getSaved().filter(function(e){ return e.id!==id; });
  putSaved(saved);
  renderSaved();
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
renderPoses();;
