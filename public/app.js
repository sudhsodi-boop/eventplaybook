/* EventPlaybook SPA — vanilla JS */
'use strict';
const State = {
  token: localStorage.getItem('ep_token') || null,
  user: null,
  events: [],
  currentEventId: Number(localStorage.getItem('ep_event')) || null,
  route: 'dashboard',
};
const ROLE_LEVEL = { Viewer:1, Contributor:2, Coordinator:3, Approver:3.5, 'Event Manager':4, Administrator:5 };
function can(min){ return State.user && (ROLE_LEVEL[State.user.role]||0) >= ROLE_LEVEL[min]; }

/* ---------- API ---------- */
let __busy=0;
function __setBusy(on){
  __busy+=on?1:-1; if(__busy<0)__busy=0;
  let bar=document.getElementById('busybar');
  if(__busy>0){
    if(!bar){ bar=document.createElement('div'); bar.id='busybar';
      bar.style.cssText='position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#5b8cff,#2fbf71);z-index:9999;animation:busypulse 1s ease-in-out infinite';
      bar.innerHTML='<div style="position:absolute;top:6px;right:12px;background:#111;color:#fff;font-size:11px;padding:3px 10px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.3)">Saving…</div>';
      if(!document.getElementById('busycss')){const s=document.createElement('style');s.id='busycss';s.textContent='@keyframes busypulse{0%,100%{opacity:.55}50%{opacity:1}}';document.head.appendChild(s);}
      document.body.appendChild(bar);
    }
  } else if(bar){ bar.remove(); }
}
async function api(path, opts={}){
  const headers = opts.headers || {};
  if(!(opts.body instanceof FormData)) headers['Content-Type']='application/json';
  if(State.token) headers['Authorization']='Bearer '+State.token;
  const isWrite = (opts.method && opts.method!=='GET');
  if(isWrite) __setBusy(true);
  try{
    const res = await fetch('/api'+path, {
      method: opts.method||'GET', headers,
      body: opts.body ? (opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    let data=null;
    const ct=res.headers.get('content-type')||'';
    if(ct.includes('application/json')) data=await res.json();
    else data=await res.text();
    if(!res.ok){ const msg=(data&&data.error)||('Error '+res.status); const e=new Error(msg); e.status=res.status; throw e; }
    return data;
  } finally { if(isWrite) __setBusy(false); }
}

/* ---------- utils ---------- */
const $=(s,el=document)=>el.querySelector(s);
const h=(tag,attrs={},...kids)=>{
  const e=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs||{})){
    if(k==='class')e.className=v;
    else if(k==='html')e.innerHTML=v;
    else if(k.startsWith('on')&&typeof v==='function')e.addEventListener(k.slice(2),v);
    else if(v!==null&&v!==undefined&&v!==false)e.setAttribute(k,v);
  }
  for(let kid of kids.flat()){ if(kid==null||kid===false)continue; e.appendChild(typeof kid==='object'?kid:document.createTextNode(String(kid))); }
  return e;
};
function toast(msg,type=''){
  let box=$('.toasts'); if(!box){box=h('div',{class:'toasts'});document.body.appendChild(box);}
  const t=h('div',{class:'toast '+type},msg); box.appendChild(t);
  setTimeout(()=>t.remove(),4200);
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function fmtDate(d){ if(!d)return '—'; const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function statusBadge(s){
  const map={Completed:'b-green',Active:'b-green',Approved:'b-green',Published:'b-green','In Progress':'b-blue',Review:'b-amber',Planning:'b-blue',Scheduled:'b-blue','Not Started':'b-gray',Draft:'b-gray',Blocked:'b-red',Cancelled:'b-red',Archived:'b-gray','Not Published':'b-gray'};
  return `<span class="badge ${map[s]||'b-gray'}">${esc(s)}</span>`;
}
function prioBadge(p){const m={Critical:'b-red',High:'b-amber',Medium:'b-blue',Low:'b-gray'};return `<span class="badge ${m[p]||'b-gray'}">${esc(p)}</span>`;}
function currentEvent(){ return State.events.find(e=>e.id===State.currentEventId); }

/* ---------- Modal ---------- */
function modal({title,body,footer,size=''}){
  const bg=h('div',{class:'modal-bg',onclick:e=>{if(e.target===bg)close();}});
  function close(){bg.remove();}
  const m=h('div',{class:'modal '+size});
  m.appendChild(h('div',{class:'modal-head'},h('h2',{style:'margin:0'},title),h('button',{class:'x',onclick:close},'×')));
  const b=h('div',{class:'modal-body'}); if(typeof body==='string')b.innerHTML=body; else b.appendChild(body); m.appendChild(b);
  if(footer){const f=h('div',{class:'modal-foot'});footer(f,close);m.appendChild(f);}
  bg.appendChild(m); document.body.appendChild(bg);
  return {close, body:b};
}
function formModal(title,fields,onSubmit,initial={}){
  const form=h('form',{onsubmit:async e=>{
    e.preventDefault();
    const data={};
    for(const f of fields){ if(f.type==='checkbox')data[f.name]=form[f.name].checked?1:0; else data[f.name]=form[f.name]?form[f.name].value:''; }
    try{ await onSubmit(data); m.close(); }catch(err){ toast(err.message,'err'); }
  }});
  for(const f of fields){
    const wrap=h('div',{class:'field'});
    if(f.type!=='checkbox') wrap.appendChild(h('label',{},f.label||f.name));
    let input;
    const val=initial[f.name]!==undefined?initial[f.name]:(f.default||'');
    if(f.type==='select'){ input=h('select',{name:f.name}); for(const o of f.options){const opt=h('option',{value:typeof o==='object'?o.value:o},typeof o==='object'?o.label:o); if(String(val)===String(typeof o==='object'?o.value:o))opt.selected=true; input.appendChild(opt);} }
    else if(f.type==='textarea'){ input=h('textarea',{name:f.name,rows:f.rows||4},val); }
    else if(f.type==='checkbox'){ input=h('label',{class:'chk'},h('input',{type:'checkbox',name:f.name}),f.label); if(val)input.querySelector('input').checked=true; }
    else { input=h('input',{name:f.name,type:f.type||'text',value:val,placeholder:f.placeholder||''}); }
    wrap.appendChild(input); form.appendChild(wrap);
  }
  const m=modal({title,body:form,footer:(f,close)=>{ f.appendChild(h('button',{class:'btn',type:'button',onclick:close},'Cancel')); f.appendChild(h('button',{class:'btn primary',type:'button',onclick:()=>form.requestSubmit()},'Save')); }});
  return m;
}
function confirmModal(title,msg,onYes){
  modal({title,body:`<p>${esc(msg)}</p>`,footer:(f,close)=>{
    f.appendChild(h('button',{class:'btn',onclick:close},'Cancel'));
    f.appendChild(h('button',{class:'btn danger',onclick:async()=>{try{await onYes();close();}catch(e){toast(e.message,'err');}}},'Confirm'));
  }});
}

/* ---------- Auth screen ---------- */
function renderAuth(){
  const app=$('#app'); app.innerHTML='';
  let mode='login';
  const wrap=h('div',{class:'auth'});
  const card=h('div',{class:'card'});
  function draw(){
    card.innerHTML='';
    card.appendChild(h('div',{class:'brand',style:'padding:0 0 14px'},h('span',{class:'logo'}),'EventPlaybook'));
    card.appendChild(h('p',{class:'muted',style:'margin-top:-8px'},'Event Management, Communication & Lessons-Learned System'));
    const tabs=h('div',{class:'tabs'},
      h('button',{class:mode==='login'?'active':'',onclick:()=>{mode='login';draw();}},'Sign In'),
      h('button',{class:mode==='register'?'active':'',onclick:()=>{mode='register';draw();}},'Register'));
    card.appendChild(tabs);
    const form=h('form',{onsubmit:async e=>{
      e.preventDefault();
      try{
        const body={email:form.email.value,password:form.password.value};
        let data;
        if(mode==='register'){ body.name=form.name.value; data=await api('/auth/register',{method:'POST',body}); }
        else data=await api('/auth/login',{method:'POST',body});
        State.token=data.token; State.user=data.user; localStorage.setItem('ep_token',data.token);
        await boot();
      }catch(err){ toast(err.message,'err'); }
    }});
    if(mode==='register') form.appendChild(field('Name','name','text'));
    form.appendChild(field('Email','email','email','admin@example.com'));
    form.appendChild(field('Password','password','password','password'));
    form.appendChild(h('button',{class:'btn primary',style:'width:100%;margin-top:6px'},mode==='login'?'Sign In':'Create Account'));
    card.appendChild(form);
    card.appendChild(h('div',{class:'card',style:'margin-top:14px;background:var(--surface2);font-size:12px'},
      h('strong',{},'Demo accounts (password: '),h('code',{},'password'),h('strong',{},')'),
      h('div',{class:'muted',style:'margin-top:6px'},'admin@example.com · manager@example.com · coord@example.com · contrib@example.com · viewer@example.com')));
  }
  function field(label,name,type,ph){const w=h('div',{class:'field'});w.appendChild(h('label',{},label));w.appendChild(h('input',{name,type,placeholder:ph||'',required:true}));return w;}
  draw(); wrap.appendChild(card); app.appendChild(wrap);
}

/* ---------- Shell ---------- */
const NAV=[
  ['dashboard','Dashboard','◧'],['events','Events','▦'],
  ['setup','Planning Setup','⚑'],['coreteam','Core Team','👥'],['departments','Departments','▤'],
  ['venues','Venues','🏛'],['caterers','Caterers','🍽'],['registration','Registration','📝'],
  ['calendar','Calendar','▤'],['timeline','Timeline','▬'],['tasks','Tasks','☑'],
  ['announcements','Announcements','📣'],['communication','Communication Plan','✉'],
  ['checklists','Checklists','✓'],['people','People & Roles','☺'],['lessons','Lessons Learned','◆'],
  ['knowledge','Knowledge Base','⌕'],['templates','Templates','▣'],['reports','Reports','▣'],
  ['eventday','Event Day Mode','★'],['analytics','Analytics','◈'],['audit','Audit Log','☰'],['settings','Settings','⚙'],
];
function renderShell(){
  const app=$('#app'); app.innerHTML='';
  const layout=h('div',{class:'layout'});
  const side=h('aside',{class:'sidebar',id:'sidebar'});
  side.appendChild(h('div',{class:'brand'},h('span',{class:'logo'}),'EventPlaybook'));
  const nav=h('nav',{class:'nav'});
  for(const[r,label,ico]of NAV){
    if((r==='audit')&&!can('Event Manager'))continue;
    nav.appendChild(h('a',{href:'#'+r,class:State.route===r?'active':'',onclick:e=>{e.preventDefault();go(r);$('#sidebar').classList.remove('open');}},h('span',{class:'ico'},ico),label));
  }
  side.appendChild(nav);
  side.appendChild(h('div',{class:'sidefoot'},h('div',{},State.user.name),h('div',{class:'muted'},State.user.role),
    h('button',{class:'btn sm',style:'margin-top:8px;width:100%',onclick:logout},'Sign Out')));
  layout.appendChild(side);

  const main=h('div',{class:'main'});
  const top=h('div',{class:'topbar'});
  top.appendChild(h('button',{class:'hamburger',onclick:()=>$('#sidebar').classList.toggle('open')},'☰'));
  // event selector
  const sel=h('select',{style:'max-width:260px',onchange:e=>{State.currentEventId=Number(e.target.value);localStorage.setItem('ep_event',e.target.value);go(State.route);}});
  for(const ev of State.events) { const o=h('option',{value:ev.id},`${ev.name}`); if(ev.id===State.currentEventId)o.selected=true; sel.appendChild(o);}
  if(!State.events.length) sel.appendChild(h('option',{},'No events yet'));
  top.appendChild(sel);
  const search=h('input',{placeholder:'Global search…',style:'max-width:280px',onkeydown:e=>{if(e.key==='Enter'){go('knowledge');setTimeout(()=>{const i=$('#kb-q');if(i){i.value=e.target.value;i.dispatchEvent(new Event('input'));}},50);}}});
  top.appendChild(search);
  top.appendChild(h('div',{style:'flex:1'}));
  const bell=h('button',{class:'btn',id:'bell',onclick:openNotifications},'🔔');
  top.appendChild(bell);
  main.appendChild(top);
  const content=h('div',{class:'content',id:'view'});
  main.appendChild(content);
  layout.appendChild(main);
  app.appendChild(layout);
  loadNotifCount();
}
function go(route){ State.route=route; location.hash=route; renderShell(); renderView(); }
function logout(){ State.token=null;State.user=null;localStorage.removeItem('ep_token');renderAuth(); }

async function loadNotifCount(){
  try{ const n=await api('/notifications'); const unread=n.filter(x=>!x.read).length;
    const bell=$('#bell'); if(bell&&unread)bell.innerHTML='🔔 <span class="badge b-red">'+unread+'</span>';
  }catch(e){}
}
async function openNotifications(){
  const list=await api('/notifications');
  const body=h('div',{});
  if(!list.length)body.appendChild(h('div',{class:'list-empty'},'No notifications'));
  for(const n of list){
    body.appendChild(h('div',{class:'card',style:'margin-bottom:8px;'+(n.read?'opacity:.6':'')},
      h('div',{style:'display:flex;justify-content:space-between;gap:8px'},
        h('div',{},h('span',{class:'badge b-blue'},n.type),' ',h('span',{},n.message)),
        !n.read&&h('button',{class:'btn sm',onclick:async(e)=>{await api('/notifications/'+n.id+'/read',{method:'POST'});e.target.closest('.card').style.opacity=.6;loadNotifCount();}},'Mark read')),
      h('div',{class:'muted',style:'font-size:11px;margin-top:4px'},new Date(n.created_at+'Z').toLocaleString())));
  }
  modal({title:'Notifications',body,footer:(f,close)=>{
    f.appendChild(h('button',{class:'btn',onclick:async()=>{await api('/notifications/read-all',{method:'POST'});loadNotifCount();close();}},'Mark all read'));
    f.appendChild(h('button',{class:'btn primary',onclick:close},'Close'));
  }});
}

/* ---------- Router ---------- */
function renderView(){
  const v=$('#view'); if(!v)return; v.innerHTML='';
  const r=State.route;
  const map={dashboard:viewDashboard,events:viewEvents,calendar:viewCalendar,timeline:viewTimeline,tasks:viewTasks,
    announcements:viewAnnouncements,communication:viewCommunication,checklists:viewChecklists,people:viewPeople,
    lessons:viewLessons,knowledge:viewKnowledge,templates:viewTemplates,reports:viewReports,eventday:viewEventDay,
    analytics:viewAnalytics,audit:viewAudit,settings:viewSettings,
    setup:viewSetup,coreteam:viewCoreTeam,departments:viewDepartments,venues:viewVenues,caterers:viewCaterers,registration:viewRegistration};
  (map[r]||viewDashboard)(v);
}
function needEvent(v){
  if(!State.currentEventId){ v.appendChild(h('div',{class:'card list-empty'},'No event selected. Create one in the Events section.',h('div',{style:'margin-top:12px'},h('button',{class:'btn primary',onclick:()=>go('events')},'Go to Events')))); return false; }
  return true;
}

/* ---------- DASHBOARD ---------- */
async function viewDashboard(v){
  v.appendChild(h('div',{class:'page-head'},h('div',{},h('h1',{},'Dashboard')),
    can('Event Manager')&&h('div',{style:'display:flex;gap:8px'},
      h('button',{class:'btn green',onclick:openCloneWizard},'⟳ Create Next Event From Previous'),
      h('button',{class:'btn primary',onclick:()=>openEventForm()},'+ New Event'))));
  if(!needEvent(v))return;
  let d;
  try{ d=await api('/dashboard/'+State.currentEventId); }catch(e){ v.appendChild(h('div',{class:'card'},e.message)); return; }
  const ev=d.event;
  // top summary
  v.appendChild(h('div',{class:'card',style:'margin-bottom:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center'},
    h('div',{},h('h2',{style:'margin:0'},ev.name),
      h('div',{class:'muted'},`${ev.event_type||'Event'} · ${fmtDate(ev.start_date)}${ev.end_date&&ev.end_date!==ev.start_date?' – '+fmtDate(ev.end_date):''} · ${ev.location||'—'}`),
      h('div',{style:'margin-top:6px'},statusBadge(ev.status),' ',h('span',{class:'badge b-purple'},d.currentPhase))),
    h('div',{style:'text-align:right'},
      d.daysUntil!=null&&d.daysUntil>=0?h('div',{},h('div',{class:'n',style:'font-size:30px;font-weight:800'},d.daysUntil),h('div',{class:'muted'},'days until event')):
      (d.daysSince!=null?h('div',{},h('div',{style:'font-size:30px;font-weight:800'},d.daysSince),h('div',{class:'muted'},'days since event')):null))
  ));
  // stats
  const stats=h('div',{class:'grid cols-4',style:'margin-bottom:14px'});
  const cards=[['Completion',d.completion+'%'],['Tasks Completed',d.tasksCompleted],['Tasks Remaining',d.tasksRemaining],['Overdue',d.overdue]];
  for(const[l,n]of cards)stats.appendChild(h('div',{class:'stat'},h('div',{class:'n'},n),h('div',{class:'l'},l)));
  v.appendChild(stats);
  v.appendChild(h('div',{class:'card',style:'margin-bottom:14px'},h('h3',{},'Overall Completion'),h('div',{class:'progress'},h('span',{style:'width:'+d.completion+'%'}))));

  // timeline flow
  const flow=h('div',{class:'tl-flow'});
  const labels={'-120':'4 Months Before','-60':'2 Months Before','-30':'1 Month Before','-14':'2 Weeks Before','-2':'2 Days Before','0':'Event Day','7':'Post Event'};
  d.timeline.forEach((t,i)=>{
    flow.appendChild(h('div',{class:'step'+(t.isPast?' past':'')},labels[String(t.offset)]||t.label,h('span',{class:'d'},fmtDate(t.date))));
    if(i<d.timeline.length-1)flow.appendChild(h('span',{class:'arrow'},'→'));
  });
  v.appendChild(h('div',{class:'card',style:'margin-bottom:14px'},h('h3',{},'Timeline Summary'),flow));

  const grid=h('div',{class:'grid cols-2'});
  grid.appendChild(listCard('Upcoming Milestones',d.milestones,m=>`${esc(m.name)} <span class="badge rel">${m.relative}</span> <span class="muted">${fmtDate(m.computed_date)}</span>`));
  grid.appendChild(listCard('Upcoming Announcements',d.announcements,a=>`${esc(a.title)} <span class="badge rel">${a.relative}</span> <span class="muted">${fmtDate(a.computed_date)}</span>`));
  grid.appendChild(listCard('Pending Approvals',d.pendingApprovals,a=>`${esc(a.title)} — ${statusBadge(a.approval_status)}`));
  grid.appendChild(listCard('Overdue Tasks',d.overdueTasks,t=>`${esc(t.title)} ${prioBadge(t.priority)}`));
  v.appendChild(grid);
  if(d.criticalIssues.length)v.appendChild(h('div',{class:'card',style:'margin-top:14px;border-color:var(--red)'},h('h3',{style:'color:var(--red)'},'Critical Issues'),...d.criticalIssues.map(c=>h('div',{},'⚠ '+c.title))));
}
function listCard(title,items,fmt){
  const c=h('div',{class:'card'});c.appendChild(h('h3',{},title));
  if(!items.length)c.appendChild(h('div',{class:'muted'},'Nothing pending.'));
  else for(const it of items)c.appendChild(h('div',{style:'padding:6px 0;border-bottom:1px solid var(--line)',html:fmt(it)}));
  return c;
}

/* ---------- EVENTS ---------- */
async function viewEvents(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Events'),
    can('Event Manager')&&h('div',{style:'display:flex;gap:8px'},
      h('button',{class:'btn green',onclick:openCloneWizard},'⟳ Create From Previous'),
      h('button',{class:'btn primary',onclick:()=>openEventForm()},'+ New Event'))));
  const series=await api('/series');
  const events=await api('/events');
  State.events=events;
  if(!events.length){v.appendChild(h('div',{class:'card list-empty'},'No events yet. Create your first event.'));return;}
  // group by series
  for(const s of series){
    if(!s.events.length)continue;
    v.appendChild(h('div',{class:'section-title'},'📚 '+s.name,h('span',{class:'badge b-gray'},s.events.length+' events')));
    const grid=h('div',{class:'grid cols-3'});
    for(const es of s.events){ const ev=events.find(e=>e.id===es.id); if(ev)grid.appendChild(eventCard(ev)); }
    v.appendChild(grid);
  }
  const noSeries=events.filter(e=>!e.series_id);
  if(noSeries.length){ v.appendChild(h('div',{class:'section-title'},'Ungrouped')); const g=h('div',{class:'grid cols-3'}); noSeries.forEach(e=>g.appendChild(eventCard(e))); v.appendChild(g); }
}
function eventCard(ev){
  const c=h('div',{class:'card',style:'cursor:pointer',onclick:()=>{State.currentEventId=ev.id;localStorage.setItem('ep_event',ev.id);openEventDetail(ev.id);}});
  c.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:start'},h('h2',{style:'margin:0;font-size:15px'},ev.name),statusBadgeEl(ev.status)));
  c.appendChild(h('div',{class:'muted',style:'margin:6px 0'},`${ev.event_type||'—'} · ${ev.event_year||''}`));
  c.appendChild(h('div',{class:'muted',style:'font-size:12px'},'📅 '+fmtDate(ev.start_date)));
  c.appendChild(h('div',{class:'muted',style:'font-size:12px'},'📍 '+(ev.location||'—')));
  c.appendChild(h('div',{style:'font-size:12px;margin-top:6px'},'👥 '+(ev.participants||0)+' participants'));
  if(ev.locked)c.appendChild(h('div',{style:'margin-top:6px'},h('span',{class:'badge b-purple'},'🔒 Locked (historical)')));
  return c;
}
function statusBadgeEl(s){const d=h('div',{});d.innerHTML=statusBadge(s);return d.firstChild;}

function openEventForm(initial){
  const isEdit=initial&&initial.id;
  formModal(isEdit?'Edit Event':'New Event',[
    {name:'name',label:'Event Name',placeholder:'Annual Community Event 2027'},
    {name:'event_type',label:'Event Type',placeholder:'Community'},
    {name:'description',label:'Description',type:'textarea'},
    {name:'start_date',label:'Start Date',type:'date'},
    {name:'end_date',label:'End Date',type:'date'},
    {name:'location',label:'Location'},
    {name:'organizer',label:'Organizer'},
    {name:'owner',label:'Event Owner'},
    {name:'participants',label:'Participants',type:'number'},
    {name:'status',label:'Status',type:'select',options:['Planning','Active','Completed','Cancelled','Archived']},
    {name:'notes',label:'Notes',type:'textarea'},
    !isEdit&&{name:'create_series',label:'Create a new recurring series for this event',type:'checkbox'},
  ].filter(Boolean),async data=>{
    if(!data.name){throw new Error('Name is required');}
    if(isEdit){ await api('/events/'+initial.id,{method:'PUT',body:data}); toast('Event updated','ok'); }
    else { const ev=await api('/events',{method:'POST',body:data}); State.currentEventId=ev.id; localStorage.setItem('ep_event',ev.id); toast('Event created','ok'); }
    await refreshEvents(); renderShell(); renderView();
  },initial||{status:'Planning'});
}

async function openEventDetail(id){
  const ev=await api('/events/'+id);
  const body=h('div',{});
  const kv=h('div',{class:'kv'});
  const rows=[['Type',ev.event_type],['Year',ev.event_year],['Status',ev.status],['Start',fmtDate(ev.start_date)],['End',fmtDate(ev.end_date)],['Location',ev.location],['Organizer',ev.organizer],['Owner',ev.owner],['Participants',ev.participants],['Series',ev.series?ev.series.name:'—'],['Previous Event',ev.previous_event?ev.previous_event.name:'—'],['Next Event',ev.next_event?ev.next_event.name:'—'],['Notes',ev.notes]];
  for(const[k,val]of rows){kv.appendChild(h('div',{},k));kv.appendChild(h('div',{},val!=null&&val!==''?String(val):'—'));}
  body.appendChild(kv);
  body.appendChild(h('div',{style:'margin-top:14px'},h('strong',{},'Attachments')));
  const attWrap=h('div',{style:'margin-top:6px'}); body.appendChild(attWrap); loadAttachments('event',ev.id,attWrap);
  modal({title:ev.name,size:'lg',body,footer:(f,close)=>{
    if(can('Administrator'))f.appendChild(h('button',{class:'btn',onclick:async()=>{const r=await api('/events/'+ev.id+'/lock',{method:'POST',body:{locked:!ev.locked}});toast(r.locked?'Event locked':'Event unlocked','ok');close();refreshEvents().then(renderView);}},ev.locked?'🔓 Unlock':'🔒 Lock as Historical'));
    if(can('Coordinator')&&!ev.locked)f.appendChild(h('button',{class:'btn',onclick:()=>{close();openEventForm(ev);}},'Edit'));
    if(can('Event Manager'))f.appendChild(h('button',{class:'btn green',onclick:()=>{close();openCloneWizard(ev.id);}},'⟳ Create Next From This'));
    f.appendChild(h('button',{class:'btn primary',onclick:()=>{State.currentEventId=ev.id;localStorage.setItem('ep_event',ev.id);close();go('dashboard');}},'Open Dashboard'));
  }});
}

/* ---------- CLONE WIZARD ---------- */
async function openCloneWizard(preId){
  const events=await api('/events');
  if(!events.length){toast('Create an event first','err');return;}
  let step=1, sourceId=preId||events[0].id, analysis=null;
  const body=h('div',{});
  const foot=h('div',{class:'modal-foot'});
  const m=modal({title:'Create Next Event From Previous',size:'lg',body,footer:(f)=>{foot.className='';f._ref=f;}});
  function render(){
    body.innerHTML='';
    if(step===1){
      body.appendChild(h('p',{class:'muted'},'Select the proven event you want to reuse as the basis for your next event.'));
      const sel=h('select',{onchange:e=>sourceId=Number(e.target.value)});
      for(const e of events){const o=h('option',{value:e.id},`${e.name} (${e.event_year||'?'}) — ${e.status}`);if(e.id===sourceId)o.selected=true;sel.appendChild(o);}
      body.appendChild(h('div',{class:'field'},h('label',{},'Previous Event'),sel));
      setFoot([['Cancel',()=>m.close(),'btn'],['Next: Analyze →',async()=>{analysis=await api('/events/'+sourceId+'/preview-clone',{method:'POST'});step=2;render();},'btn primary']]);
    } else if(step===2){
      body.appendChild(h('h3',{},'Next-Year Intelligence (based on lessons learned & dispositions)'));
      const a=analysis.analysis;
      const grid=h('div',{class:'grid cols-2'});
      grid.appendChild(dispCard('KEEP','b-green',a.keep));
      grid.appendChild(dispCard('CHANGE','b-amber',a.change));
      grid.appendChild(dispCard('REMOVE','b-red',a.remove));
      grid.appendChild(dispCard('ADD','b-purple',a.add));
      body.appendChild(grid);
      body.appendChild(h('p',{class:'muted',style:'margin-top:10px'},'Items marked REMOVE will not be copied. Lessons with next actions become new draft tasks.'));
      setFoot([['← Back',()=>{step=1;render();},'btn'],['Next: Configure →',()=>{step=3;render();},'btn primary']]);
    } else {
      body.appendChild(h('p',{class:'muted'},'Choose the new date and what to copy. All relative dates recalculate automatically. The previous event stays untouched.'));
      const form=h('div',{});
      form.appendChild(h('div',{class:'field'},h('label',{},'New Event Name (optional)'),h('input',{id:'cl-name',placeholder:'auto-generated from previous'})));
      form.appendChild(h('div',{class:'field'},h('label',{},'New Start Date *'),h('input',{id:'cl-date',type:'date'})));
      form.appendChild(h('div',{class:'field'},h('label',{},'New Location (optional)'),h('input',{id:'cl-loc'})));
      const opts=['milestones','tasks','announcements','communications','checklists','roles'];
      const ow=h('div',{});
      for(const o of opts)ow.appendChild(h('label',{class:'chk'},h('input',{type:'checkbox',id:'cl-'+o,checked:true}),'Copy '+o));
      ow.appendChild(h('label',{class:'chk'},h('input',{type:'checkbox',id:'cl-lessons',checked:true}),'Apply lessons learned as new draft tasks'));
      form.appendChild(ow);
      body.appendChild(form);
      setFoot([['← Back',()=>{step=2;render();},'btn'],['Generate Draft Event',doClone,'btn green']]);
    }
  }
  async function doClone(){
    const date=$('#cl-date').value;
    if(!date){toast('New start date required','err');return;}
    const copy={}; for(const o of ['milestones','tasks','announcements','communications','checklists','roles'])copy[o]=$('#cl-'+o).checked;
    const body2={start_date:date,name:$('#cl-name').value||undefined,location:$('#cl-loc').value||undefined,copy,apply_lessons:$('#cl-lessons').checked};
    try{
      const ev=await api('/events/'+sourceId+'/clone',{method:'POST',body:body2});
      toast('Draft event created: '+ev.name,'ok');
      State.currentEventId=ev.id; localStorage.setItem('ep_event',ev.id);
      m.close(); await refreshEvents(); renderShell(); go('timeline');
    }catch(e){toast(e.message,'err');}
  }
  function setFoot(buttons){
    const f=m.body.parentElement.querySelector('.modal-foot');
    f.innerHTML='';
    for(const[label,fn,cls]of buttons)f.appendChild(h('button',{class:cls,onclick:fn},label));
  }
  render();
}
function dispCard(title,cls,items){
  const c=h('div',{class:'card'});
  c.appendChild(h('h3',{},h('span',{class:'badge '+cls},title)));
  if(!items.length)c.appendChild(h('div',{class:'muted'},'None'));
  else items.forEach(i=>c.appendChild(h('div',{style:'padding:4px 0;font-size:12px;border-bottom:1px solid var(--line)'},i)));
  return c;
}

/* ---------- shared: disposition control ---------- */
function dispControl(entity,item,onChange){
  const cur=(item.disposition||'').toUpperCase();
  const wrap=h('div',{class:'disp'});
  for(const d of ['KEEP','MODIFY','REMOVE']){
    wrap.appendChild(h('button',{class:d+(cur===d?' on':''),title:'Mark '+d,onclick:async e=>{
      e.stopPropagation();
      const nv=cur===d?'':d;
      await api('/'+entity+'/'+item.id,{method:'PUT',body:{disposition:nv}});
      onChange&&onChange(); toast('Marked '+(nv||'cleared'),'ok');
    }},d[0]));
  }
  return wrap;
}
function inheritedTag(item){ return item.inherited_from?h('span',{class:'inherited'},'Inherited'):null; }

/* ---------- TASKS ---------- */
async function viewTasks(v){
  const headActions=h('div',{class:'task-head-actions'},
    can('Contributor')&&currentEvent()&&!currentEvent().locked&&h('button',{class:'btn primary',onclick:()=>openNewTaskForm()},'+ New Task'));
  v.appendChild(h('div',{class:'page-head'},
    h('div',{},h('h1',{},'Tasks'),h('div',{class:'muted'},'Plan, assign, and track every piece of event work.')),
    headActions));
  if(!needEvent(v))return;
  const event=currentEvent()||{};
  const canEditTasks=can('Contributor')&&!event.locked;
  let tasks=await api('/events/'+State.currentEventId+'/tasks');
  const selected=new Set(), collapsed=new Set();
  let filterStatus='',filterPriority='',filterAssignee='',filterDue='',query='',viewMode='list',sortBy='position';
  const tools=h('div',{class:'task-toolbar'});
  const search=h('input',{class:'task-search',placeholder:'Search tasks and subtasks…',oninput:e=>{query=e.target.value.trim().toLowerCase();draw();}});
  const statusFilter=h('select',{class:'task-filter',onchange:e=>{filterStatus=e.target.value;draw();}},...['','Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s||'All statuses')));
  const priorityFilter=h('select',{class:'task-filter',onchange:e=>{filterPriority=e.target.value;draw();}},...['','Critical','High','Medium','Low'].map(s=>h('option',{value:s},s||'All priorities')));
  const assigneeFilter=h('select',{class:'task-filter',onchange:e=>{filterAssignee=e.target.value;draw();}});
  const dueFilter=h('select',{class:'task-filter',onchange:e=>{filterDue=e.target.value;draw();}},
    h('option',{value:''},'Any due date'),h('option',{value:'overdue'},'Overdue'),h('option',{value:'week'},'Due in 7 days'),h('option',{value:'nodate'},'No due date'));
  const sortFilter=h('select',{class:'task-filter',onchange:e=>{sortBy=e.target.value;draw();}},
    h('option',{value:'position'},'Manual order'),h('option',{value:'due'},'Sort: due date'),h('option',{value:'priority'},'Sort: priority'),h('option',{value:'title'},'Sort: title'),h('option',{value:'recent'},'Sort: recently updated'));
  const viewFilter=h('select',{class:'task-view-switch',onchange:e=>{viewMode=e.target.value;draw();}},
    h('option',{value:'list'},'☷ List'),h('option',{value:'board'},'▦ Board'));
  tools.append(search,statusFilter,priorityFilter,assigneeFilter,dueFilter,sortFilter,viewFilter);
  v.appendChild(tools);
  const stats=h('div',{class:'task-stats'}); v.appendChild(stats);
  const container=h('div',{class:'task-view-container'}); v.appendChild(container);

  function updateAssigneeOptions(){
    const current=filterAssignee;
    const names=[...new Set(tasks.map(t=>(t.assignee||t.owner||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    assigneeFilter.innerHTML='';
    assigneeFilter.appendChild(h('option',{value:''},'All assignees'));
    assigneeFilter.appendChild(h('option',{value:'__unassigned'},'Unassigned'));
    for(const name of names)assigneeFilter.appendChild(h('option',{value:name},name));
    assigneeFilter.value=names.includes(current)||current==='__unassigned'?current:'';
    filterAssignee=assigneeFilter.value;
  }
  function taskMatches(t,today){
    if(filterStatus&&t.status!==filterStatus)return false;
    if(filterPriority&&t.priority!==filterPriority)return false;
    const who=(t.assignee||t.owner||'').trim();
    if(filterAssignee==='__unassigned'&&who)return false;
    if(filterAssignee&&filterAssignee!=='__unassigned'&&who!==filterAssignee)return false;
    if(filterDue==='overdue'&&(!t.computed_date||t.computed_date>=today||['Completed','Cancelled'].includes(t.status)))return false;
    if(filterDue==='week'&&(!t.computed_date||t.computed_date<today||t.computed_date>addLocalDays(today,7)))return false;
    if(filterDue==='nodate'&&t.computed_date)return false;
    if(query){
      const hay=[t.title,t.description,t.assignee,t.owner,t.phase,t.tags].join(' ').toLowerCase();
      if(!hay.includes(query))return false;
    }
    return true;
  }
  function addLocalDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
  function visibleTasks(){
    const today=new Date().toISOString().slice(0,10);
    const byId=new Map(tasks.map(t=>[Number(t.id),t]));
    const keep=new Set(tasks.filter(t=>taskMatches(t,today)).map(t=>Number(t.id)));
    // Keep each matching descendant's ancestors visible so the hierarchy remains understandable.
    for(const id of [...keep]){
      let row=byId.get(id),guard=new Set();
      while(row&&row.parent_task_id&&byId.has(Number(row.parent_task_id))){
        const parentId=Number(row.parent_task_id);if(guard.has(parentId))break;guard.add(parentId);keep.add(parentId);row=byId.get(parentId);
      }
    }
    return tasks.filter(t=>keep.has(Number(t.id)));
  }
  function taskComparator(a,b){
    if(sortBy==='title')return (a.title||'').localeCompare(b.title||'');
    if(sortBy==='due')return (a.computed_date||'9999-99-99').localeCompare(b.computed_date||'9999-99-99')||Number(a.id)-Number(b.id);
    if(sortBy==='priority'){
      const rank={Critical:0,High:1,Medium:2,Low:3};
      return (rank[a.priority]??9)-(rank[b.priority]??9)||Number(a.id)-Number(b.id);
    }
    if(sortBy==='recent')return (b.updated_at||'').localeCompare(a.updated_at||'')||Number(a.id)-Number(b.id);
    return Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id)-Number(b.id);
  }
  function buildTree(items){
    const ids=new Set(items.map(t=>Number(t.id))),children=new Map();
    for(const t of items){
      const p=Number(t.parent_task_id||0);
      if(p&&ids.has(p)){if(!children.has(p))children.set(p,[]);children.get(p).push(t);}
    }
    for(const list of children.values())list.sort(taskComparator);
    const roots=items.filter(t=>!t.parent_task_id||!ids.has(Number(t.parent_task_id))).sort(taskComparator);
    const flat=[];const visited=new Set();
    function walk(t,depth){
      if(visited.has(Number(t.id)))return;visited.add(Number(t.id));
      flat.push({task:t,depth,children:children.get(Number(t.id))||[]});
      if(!collapsed.has(Number(t.id)))for(const child of children.get(Number(t.id))||[])walk(child,depth+1);
    }
    for(const root of roots)walk(root,0);
    // Defend against malformed orphan/cyclic rows without hiding them.
    for(const t of items)if(!visited.has(Number(t.id)))walk(t,0);
    return {flat,children};
  }
  function descendantProgress(taskId,children,allById){
    let total=0,done=0;const seen=new Set();
    function visit(id){for(const child of children.get(Number(id))||[]){const n=Number(child.id);if(seen.has(n))continue;seen.add(n);total++;if(child.status==='Completed')done++;visit(n);}}
    visit(taskId);return {total,done};
  }
  async function reloadTasks(){tasks=await api('/events/'+State.currentEventId+'/tasks');updateAssigneeOptions();draw();}
  async function saveInline(task,patch){
    try{await api('/tasks/'+task.id,{method:'PUT',body:patch});await reloadTasks();toast('Task updated','ok');}
    catch(err){toast(err.message,'err');}
  }
  function drawStats(){
    const open=tasks.filter(t=>!['Completed','Cancelled'].includes(t.status)).length;
    const done=tasks.filter(t=>t.status==='Completed').length;
    const blocked=tasks.filter(t=>t.status==='Blocked').length;
    const today=new Date().toISOString().slice(0,10);
    const overdue=tasks.filter(t=>t.computed_date&&t.computed_date<today&&!['Completed','Cancelled'].includes(t.status)).length;
    stats.innerHTML='';
    for(const [label,value,kind] of [['All tasks',tasks.length,'blue'],['Open',open,'gray'],['Completed',done,'green'],['Overdue',overdue,'red'],['Blocked',blocked,'amber']])
      stats.appendChild(h('div',{class:'task-stat '+kind},h('span',{class:'task-stat-value'},value),h('span',{class:'task-stat-label'},label)));
  }
  function draw(){
    updateAssigneeOptions();drawStats();container.innerHTML='';
    const list=visibleTasks();
    if(!list.length){container.appendChild(h('div',{class:'card list-empty'},tasks.length?'No tasks match these filters.':'No tasks yet — create the first task for this event.'));return;}
    const {flat,children}=buildTree(list);
    const allById=new Map(tasks.map(t=>[Number(t.id),t]));
    if(viewMode==='board'){
      const board=h('div',{class:'task-board'});
      for(const status of ['Not Started','In Progress','Blocked','Completed','Cancelled']){
        const cards=list.filter(t=>t.status===status).sort(taskComparator);
        const col=h('div',{class:'task-board-column',ondragover:e=>{e.preventDefault();e.currentTarget.classList.add('drag-over');},ondragleave:e=>e.currentTarget.classList.remove('drag-over'),ondrop:async e=>{
          e.preventDefault();e.currentTarget.classList.remove('drag-over');const id=Number(e.dataTransfer.getData('text/task'));const row=allById.get(id);if(row&&row.status!==status)await saveInline(row,{status});
        }},h('div',{class:'task-board-heading'},h('span',{},status),h('span',{class:'badge b-gray'},cards.length)));
        for(const task of cards){
          const parent=task.parent_task_id?allById.get(Number(task.parent_task_id)):null;
          const prog=descendantProgress(task.id,children,allById);
          const card=h('div',{class:'task-board-card',draggable:canEditTasks,ondragstart:e=>{e.dataTransfer.setData('text/task',String(task.id));e.dataTransfer.effectAllowed='move';},onclick:e=>{if(e.target.closest('button'))return;openTaskDetail(task.id);}});
          card.appendChild(h('div',{class:'task-board-card-title'},task.title));
          if(parent)card.appendChild(h('div',{class:'task-parent-path'},'↳ '+parent.title));
          const meta=h('div',{class:'task-board-meta'});
          meta.appendChild(h('span',{class:'badge '+(task.priority==='Critical'?'b-red':task.priority==='High'?'b-amber':task.priority==='Low'?'b-gray':'b-blue')},task.priority||'Medium'));
          if(task.relative)meta.appendChild(h('span',{class:'badge rel'},task.relative));
          card.appendChild(meta);
          card.appendChild(h('div',{class:'task-board-footer'},h('span',{},'◉ '+(task.assignee||task.owner||'Unassigned')),h('span',{},task.computed_date?fmtDate(task.computed_date):'No due date')));
          if(prog.total)card.appendChild(h('div',{class:'task-subtask-progress'},`${prog.done}/${prog.total} subtasks complete`));
          if(canEditTasks)card.appendChild(h('button',{class:'btn sm task-board-add-subtask',onclick:()=>openSubtaskForm(task)},'+ Subtask'));
          col.appendChild(card);
        }
        if(!cards.length)col.appendChild(h('div',{class:'task-board-empty'},'Drop a task here'));
        board.appendChild(col);
      }
      container.appendChild(board);return;
    }
    const bulk=h('div',{class:'task-bulkbar'});
    const count=h('span',{class:'muted'},selected.size+' selected');
    const bulkStatus=h('select',{class:'task-filter'},...['Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s)));
    const apply=h('button',{class:'btn sm',disabled:!selected.size||!canEditTasks,onclick:async()=>{
      try{await api('/tasks/bulk-status',{method:'POST',body:{ids:[...selected],status:bulkStatus.value}});selected.clear();await reloadTasks();toast('Selected tasks updated','ok');}
      catch(err){toast(err.message,'err');}
    }},'Set status');
    const clear=h('button',{class:'btn sm',disabled:!selected.size,onclick:()=>{selected.clear();draw();}},'Clear');
    bulk.append(count,bulkStatus,apply,clear);
    container.appendChild(bulk);
    const table=h('table',{class:'task-table'});
    table.appendChild(h('thead',{},h('tr',{},h('th',{},''),h('th',{},'Task'),h('th',{},'Assignee'),h('th',{},'Due date'),h('th',{},'Priority'),h('th',{},'Status'),h('th',{},'Subtasks'),h('th',{},''))));
    const tb=h('tbody');
    for(const entry of flat){
      const task=entry.task,prog=descendantProgress(task.id,children,allById),row=h('tr',{class:'task-row'+(entry.depth?' task-child-row':'')});
      if(selected.has(Number(task.id)))row.classList.add('row-selected');
      const cb=h('input',{type:'checkbox',class:'task-select',checked:selected.has(Number(task.id)),disabled:!canEditTasks,onchange:e=>{
        if(e.target.checked){selected.add(Number(task.id));row.classList.add('row-selected');}
        else{selected.delete(Number(task.id));row.classList.remove('row-selected');}
        count.textContent=selected.size+' selected';apply.disabled=!selected.size||!canEditTasks;clear.disabled=!selected.size;
      }});
      const titleCell=h('div',{class:'task-title-cell',style:`padding-left:${Math.min(entry.depth,8)*20}px`});
      if(entry.children.length){
        const toggle=h('button',{class:'task-tree-toggle','aria-label':collapsed.has(Number(task.id))?'Expand subtasks':'Collapse subtasks',onclick:()=>{collapsed.has(Number(task.id))?collapsed.delete(Number(task.id)):collapsed.add(Number(task.id));draw();}},collapsed.has(Number(task.id))?'▸':'▾');
        titleCell.appendChild(toggle);
      }else titleCell.appendChild(h('span',{class:'task-tree-spacer'},''));
      titleCell.appendChild(h('button',{class:'task-open-title',onclick:()=>openTaskDetail(task.id)},task.title));
      if(task.type&&task.type!=='Task')titleCell.appendChild(h('span',{class:'task-type-chip'},task.type));
      if(task.inherited_from)titleCell.appendChild(h('span',{class:'inherited'},'Inherited'));
      const desc=task.description||'';if(desc)titleCell.appendChild(h('div',{class:'task-row-desc'},desc.slice(0,100)));
      const assignee=h('input',{class:'task-assignee-input',type:'text',value:task.assignee||'',placeholder:task.owner||'Assign…',disabled:!canEditTasks,title:'Assignee (save on leaving field)',onchange:e=>saveInline(task,{assignee:e.target.value.trim()})});
      const due=h('input',{class:'task-date-input',type:'date',value:task.computed_date||'',disabled:!canEditTasks,title:'Set a date override; clear it in task details to return to event-relative timing',onchange:e=>saveInline(task,{date_override:e.target.value||null})});
      const priority=h('select',{class:'task-inline-select task-priority-inline',disabled:!canEditTasks,onchange:e=>saveInline(task,{priority:e.target.value})},...['Critical','High','Medium','Low'].map(s=>h('option',{value:s},s)));
      priority.value=task.priority||'Medium';
      const status=h('select',{class:'task-inline-select task-status-inline',disabled:!canEditTasks,onchange:e=>saveInline(task,{status:e.target.value})},...['Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s)));
      status.value=task.status||'Not Started';
      const subtaskCell=h('span',{class:'task-subtask-count'},prog.total?`${prog.done}/${prog.total} done`:entry.children.length?'0 subtasks':'—');
      const actions=h('div',{class:'task-row-actions'},canEditTasks&&h('button',{class:'btn sm task-add-subtask',title:'Add subtask',onclick:()=>openSubtaskForm(task)},'+ Subtask'),h('button',{class:'btn sm',onclick:()=>openTaskDetail(task.id)},'Open'));
      row.append(h('td',{},cb),h('td',{},titleCell),h('td',{},assignee),h('td',{},due),h('td',{},priority),h('td',{},status),h('td',{},subtaskCell),h('td',{},actions));
      tb.appendChild(row);
    }
    table.appendChild(tb);container.appendChild(h('div',{class:'card table-wrap task-table-wrap'},table));
  }
  async function reloadAndRedraw(){await reloadTasks();}
  function openNewTaskForm(){
    formModal('Create task',[
      {name:'title',label:'Task name'},
      {name:'description',label:'Description',type:'textarea'},
      {name:'phase',label:'Phase',type:'select',options:['','Phase 1 — Long-Term Preparation','Phase 2 — Planning','Phase 3 — Final Preparation','Phase 4 — Final Communication','Phase 5 — Final Countdown','Phase 6 — Event Execution','Phase 7 — Immediate Follow-Up','Phase 8 — Retrospective','Phase 9 — Knowledge Capture']},
      {name:'type',label:'Type',type:'select',options:['Task','Milestone','Announcement','Meeting','Deadline','Event Day Activity','Review','Follow-up']},
      {name:'offset_days',label:'Event-relative timing (days from event; e.g. -30, 0, 7)',type:'number'},
      {name:'date_override',label:'Calendar date override (optional)',type:'date'},
      {name:'owner',label:'Owner'}, {name:'assignee',label:'Assignee'},
      {name:'priority',label:'Priority',type:'select',options:['Critical','High','Medium','Low']},
      {name:'status',label:'Status',type:'select',options:['Not Started','In Progress','Blocked','Completed','Cancelled']},
      {name:'tags',label:'Tags (comma separated)'},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{
      if(!data.title.trim())throw new Error('Task name is required');
      data.offset_days=Number(data.offset_days)||0;data.date_override=data.date_override||null;
      data.tags=JSON.stringify(data.tags.split(',').map(s=>s.trim()).filter(Boolean));
      await api('/events/'+State.currentEventId+'/tasks',{method:'POST',body:data});
      await reloadAndRedraw();toast('Task created','ok');
    },{priority:'Medium',status:'Not Started',type:'Task',offset_days:0});
  }
  function openSubtaskForm(parent){
    formModal('Add subtask · '+parent.title,[
      {name:'title',label:'Subtask name'},
      {name:'description',label:'Description',type:'textarea'},
      {name:'assignee',label:'Assignee'},
      {name:'priority',label:'Priority',type:'select',options:['Critical','High','Medium','Low']},
      {name:'offset_days',label:'Event-relative timing (days from event)',type:'number'},
    ],async data=>{
      if(!data.title.trim())throw new Error('Subtask name is required');
      data.offset_days=data.offset_days===''?Number(parent.offset_days)||0:Number(data.offset_days);
      await api('/tasks/'+parent.id+'/subtasks',{method:'POST',body:data});
      collapsed.delete(Number(parent.id));await reloadAndRedraw();toast('Subtask created','ok');
    },{priority:parent.priority||'Medium',offset_days:parent.offset_days||0,assignee:parent.assignee||''});
  }
  async function openTaskDetail(taskId){
    let detail;
    try{detail=await api('/tasks/'+taskId+'/detail');}catch(err){toast(err.message,'err');return;}
    const body=h('div',{class:'task-detail-shell'});
    const modalRef=modal({title:'Task details',body,size:'task-wide',footer:(foot,close)=>{
      if(can('Coordinator')&&!detail.event_locked)foot.appendChild(h('button',{class:'btn danger',onclick:()=>confirmModal('Delete task','Delete this task? Tasks with subtasks, comments, attachments, or dependencies must be kept as Cancelled or cleared first so their history is not lost.',async()=>{
        await api('/tasks/'+taskId,{method:'DELETE'});close();await reloadAndRedraw();toast('Task deleted','ok');
      })},'Delete task'));
      foot.appendChild(h('button',{class:'btn',onclick:close},'Close'));
    }});
    async function reloadDetail(){detail=await api('/tasks/'+taskId+'/detail');renderDetail();}
    function renderDetail(){
      body.innerHTML='';const t=detail.task;const canEdit=canEditTasks&&!detail.event_locked;
      const header=h('div',{class:'task-detail-banner'},
        h('div',{},h('div',{class:'task-detail-kicker'},`TASK · #${t.id}${t.parent_task_id?' · SUBTASK':''}`),h('div',{class:'task-detail-heading'},t.title)),
        h('div',{class:'task-detail-banner-meta'},h('span',{class:'badge rel'},t.relative||'T+0'),h('span',{class:'badge'},detail.event_locked?'🔒 Historical event':'Event task')));
      body.appendChild(header);
      if(detail.event_locked)body.appendChild(h('div',{class:'task-locked-notice'},'This event is locked as a historical record. Task details are read-only until an Administrator unlocks it.'));
      const layout=h('div',{class:'task-detail-grid'});const main=h('div',{class:'task-detail-main'});const side=h('aside',{class:'task-detail-side'});layout.append(main,side);body.appendChild(layout);

      const detailsCard=h('section',{class:'task-panel'});detailsCard.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Task details'),h('span',{class:'muted'},t.updated_at?'Updated '+t.updated_at:'')));
      const titleInput=h('input',{type:'text',value:t.title||'',maxlength:500,disabled:!canEdit});
      detailsCard.appendChild(h('div',{class:'field'},h('label',{},'Task title'),titleInput));
      const description=h('textarea',{rows:4,disabled:!canEdit,placeholder:'Add context, scope, or instructions…'},t.description||'');
      detailsCard.appendChild(h('div',{class:'field'},h('label',{},'Description'),description));
      const propertyGrid=h('div',{class:'task-property-grid'});
      const statusField=h('div',{class:'field'},h('label',{},'Status'));
      const statusSelect=h('select',{disabled:!canEdit},...['Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s)));statusSelect.value=t.status||'Not Started';statusField.appendChild(statusSelect);
      const priorityField=h('div',{class:'field'},h('label',{},'Priority'));
      const prioritySelect=h('select',{disabled:!canEdit},...['Critical','High','Medium','Low'].map(s=>h('option',{value:s},s)));prioritySelect.value=t.priority||'Medium';priorityField.appendChild(prioritySelect);
      const assigneeField=h('div',{class:'field'},h('label',{},'Assignee'),h('input',{type:'text',value:t.assignee||'',placeholder:'Person responsible',disabled:!canEdit}));
      const ownerField=h('div',{class:'field'},h('label',{},'Owner / team'),h('input',{type:'text',value:t.owner||'',placeholder:'Owner or team',disabled:!canEdit}));
      const offsetField=h('div',{class:'field'},h('label',{},'Relative timing (days from event)'),h('input',{type:'number',value:Number(t.offset_days)||0,disabled:!canEdit}));
      const overrideField=h('div',{class:'field'},h('label',{},'Calendar date override'),h('input',{type:'date',value:t.date_override||'',disabled:!canEdit}));
      const typeField=h('div',{class:'field'},h('label',{},'Task type'));
      const typeSelect=h('select',{disabled:!canEdit},...['Task','Milestone','Announcement','Meeting','Deadline','Event Day Activity','Review','Follow-up'].map(s=>h('option',{value:s},s)));typeSelect.value=t.type||'Task';typeField.appendChild(typeSelect);
      let parsedTags=[];try{parsedTags=Array.isArray(t.tags)?t.tags:JSON.parse(t.tags||'[]');}catch(_){parsedTags=[];}
      const tagsField=h('div',{class:'field'},h('label',{},'Tags (comma separated)'),h('input',{type:'text',value:parsedTags.join(', '),placeholder:'venue, safety, communications',disabled:!canEdit}));
      propertyGrid.append(statusField,priorityField,assigneeField,ownerField,offsetField,overrideField,typeField,tagsField);detailsCard.appendChild(propertyGrid);
      detailsCard.appendChild(h('div',{class:'task-computed-date'},h('span',{class:'muted'},'Computed due date'),h('strong',{},t.computed_date?fmtDate(t.computed_date):'Not scheduled'),h('span',{class:'badge rel'},t.date_override?'Override':'Event-relative')));
      const detailInputs={assignee:assigneeField.querySelector('input'),owner:ownerField.querySelector('input'),offset:offsetField.querySelector('input'),override:overrideField.querySelector('input'),tags:tagsField.querySelector('input')};
      detailsCard.appendChild(h('button',{class:'btn primary',disabled:!canEdit,onclick:async()=>{
        const title=titleInput.value.trim();if(!title){toast('Task title is required','err');return;}
        try{
          await api('/tasks/'+t.id,{method:'PUT',body:{title,description:description.value,status:statusSelect.value,priority:prioritySelect.value,
            assignee:detailInputs.assignee.value.trim(),owner:detailInputs.owner.value.trim(),offset_days:Number(detailInputs.offset.value)||0,
            date_override:detailInputs.override.value||null,type:typeSelect.value,
            tags:JSON.stringify(detailInputs.tags.value.split(',').map(x=>x.trim()).filter(Boolean))}});
          await reloadTasks();await reloadDetail();toast('Task saved','ok');
        }catch(err){toast(err.message,'err');}
      }},'Save task details'));
      main.appendChild(detailsCard);

      const subSection=h('section',{class:'task-panel'});
      const subHead=h('div',{class:'task-panel-title'},h('h3',{},'Subtasks'),canEdit&&h('button',{class:'btn sm',onclick:()=>addSubtaskFromDetail(t)},'+ Add subtask'));
      subSection.appendChild(subHead);
      const subRows=h('div',{class:'task-subtask-list'});
      if(!detail.subtasks.length)subRows.appendChild(h('div',{class:'muted'},'No subtasks yet. Break this task into smaller steps.'));
      for(const child of detail.subtasks){
        const childProgress=descendantProgress(child.id,new Map(tasks.filter(x=>x.parent_task_id).reduce((acc,x)=>{const p=Number(x.parent_task_id);if(!acc.has(p))acc.set(p,[]);acc.get(p).push(x);return acc;},new Map())),new Map(tasks.map(x=>[Number(x.id),x])));
        const childRow=h('div',{class:'task-subtask-row'},h('span',{class:'task-subtask-status'},statusBadge(child.status)),
          h('button',{class:'task-subtask-open',onclick:()=>openTaskDetail(child.id)},child.title),
          childProgress.total?h('span',{class:'muted task-subtask-progress-text'},`${childProgress.done}/${childProgress.total} nested`):null,
          h('span',{class:'muted task-subtask-date'},child.computed_date?fmtDate(child.computed_date):'—'));
        subRows.appendChild(childRow);
      }
      subSection.appendChild(subRows);main.appendChild(subSection);

      const checklistSection=h('section',{class:'task-panel'});const checklistDone=detail.checklist.filter(x=>Number(x.done)).length;
      checklistSection.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Checklist'),h('span',{class:'badge b-gray'},`${checklistDone}/${detail.checklist.length}`)));
      const checklistRows=h('div',{class:'task-checklist-list'});
      for(const item of detail.checklist){
        checklistRows.appendChild(h('div',{class:'task-checklist-row'+(item.done?' checked':'')},
          h('input',{type:'checkbox',checked:!!item.done,disabled:!canEdit,onchange:async e=>{try{await api('/task-checklist-items/'+item.id,{method:'PUT',body:{done:e.target.checked}});await reloadDetail();}catch(err){toast(err.message,'err');}}}),
          h('span',{},item.text),can('Coordinator')&&!detail.event_locked&&h('button',{class:'task-remove-item',title:'Remove checklist item',onclick:()=>confirmModal('Remove checklist item','Remove this checklist item?',async()=>{await api('/task-checklist-items/'+item.id,{method:'DELETE'});await reloadDetail();})},'×')));
      }
      checklistSection.appendChild(checklistRows);
      if(canEdit){
        const newItem=h('input',{type:'text',placeholder:'Add a checklist item…'});
        const addItem=async()=>{const text=newItem.value.trim();if(!text)return;try{await api('/tasks/'+t.id+'/checklist-items',{method:'POST',body:{text}});await reloadDetail();}catch(err){toast(err.message,'err');}};
        checklistSection.appendChild(h('div',{class:'task-inline-add'},newItem,h('button',{class:'btn sm',onclick:addItem},'Add')));
        newItem.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addItem();}});
      }
      main.appendChild(checklistSection);

      const commentSection=h('section',{class:'task-panel'});commentSection.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Comments & discussion'),h('span',{class:'badge b-gray'},detail.comments.length)));
      const commentList=h('div',{class:'task-comment-list'});
      if(!detail.comments.length)commentList.appendChild(h('div',{class:'muted'},'No comments yet. Comments are kept as an append-only record.'));
      for(const comment of detail.comments)commentList.appendChild(h('article',{class:'task-comment'},h('div',{class:'task-comment-meta'},h('strong',{},comment.user_name),h('span',{class:'muted'},comment.created_at)),h('div',{class:'task-comment-body'},comment.body)));
      commentSection.appendChild(commentList);
      if(canEdit){
        const commentInput=h('textarea',{rows:3,placeholder:'Write a comment…'});
        commentSection.appendChild(h('div',{class:'field'},commentInput));
        commentSection.appendChild(h('button',{class:'btn primary',onclick:async()=>{const text=commentInput.value.trim();if(!text){toast('Write a comment first','err');return;}try{await api('/tasks/'+t.id+'/comments',{method:'POST',body:{body:text}});await reloadDetail();}catch(err){toast(err.message,'err');}}},'Post comment'));
      }
      main.appendChild(commentSection);

      const depSection=h('section',{class:'task-panel'});depSection.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Dependencies')));
      if(detail.dependencies.length)depSection.appendChild(h('div',{class:'task-link-list'},h('div',{class:'muted'},'Waiting on:'),...detail.dependencies.map(dep=>h('button',{class:'task-link-chip',onclick:()=>openTaskDetail(dep.id)},`${dep.title} · ${dep.status}`))));
      else depSection.appendChild(h('div',{class:'muted'},'No prerequisites linked.'));
      if(canEdit){
        const currentIds=new Set(detail.dependencies.map(x=>Number(x.id)));
        const depSelect=h('select',{multiple:'multiple',size:6,class:'task-dependency-select',title:'Use Ctrl or Command to select multiple prerequisite tasks'});
        for(const candidate of tasks.filter(x=>Number(x.id)!==Number(t.id)).sort((a,b)=>(a.title||'').localeCompare(b.title||''))){
          const option=h('option',{value:candidate.id},`${candidate.title} · ${candidate.status}`);option.selected=currentIds.has(Number(candidate.id));depSelect.appendChild(option);
        }
        depSection.appendChild(h('div',{class:'field'},h('label',{},'Prerequisite tasks (multiple allowed)'),depSelect));
        depSection.appendChild(h('button',{class:'btn sm',onclick:async()=>{const ids=[...depSelect.selectedOptions].map(o=>Number(o.value));try{await api('/tasks/'+t.id+'/dependencies',{method:'PUT',body:{depends_on:ids}});await reloadDetail();toast('Dependencies saved','ok');}catch(err){toast(err.message,'err');}}},'Save dependencies'));
      }
      if(detail.dependents.length)depSection.appendChild(h('div',{class:'task-link-list task-blocked-by'},h('div',{class:'muted'},'Tasks waiting on this:'),...detail.dependents.map(dep=>h('button',{class:'task-link-chip',onclick:()=>openTaskDetail(dep.id)},`${dep.title} · ${dep.status}`))));
      side.appendChild(depSection);

      const attachmentPanel=h('section',{class:'task-panel'});attachmentPanel.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Attachments')));
      const attachmentWrap=h('div',{class:'task-attachment-list'});attachmentPanel.appendChild(attachmentWrap);side.appendChild(attachmentPanel);
      loadAttachments('task',t.id,attachmentWrap,detail.event_locked).catch(err=>toast(err.message,'err'));

      const activityPanel=h('section',{class:'task-panel'});activityPanel.appendChild(h('div',{class:'task-panel-title'},h('h3',{},'Activity'),h('span',{class:'badge b-gray'},detail.activity.length)));
      if(!detail.activity.length)activityPanel.appendChild(h('div',{class:'muted'},'Task changes will appear here.'));
      for(const item of detail.activity){
        const label=item.action==='create'?'Task created':item.action==='create-subtask'?'Subtask created':item.action==='comment'?'Comment added':item.action==='dependencies-update'?'Dependencies changed':item.action.startsWith('checklist-')?'Checklist '+item.action.replace('checklist-',''):item.action==='update'?'Task updated':item.action;
        activityPanel.appendChild(h('div',{class:'task-activity-row'},h('span',{class:'task-activity-dot'}),h('div',{},h('strong',{},item.user||'User'),h('span',{},' '+label),h('div',{class:'muted task-activity-time'},item.created_at))));
      }
      side.appendChild(activityPanel);
    }
    function addSubtaskFromDetail(parent){
      const title=h('input',{type:'text',placeholder:'Name the next step…'});
      const create=async()=>{if(!title.value.trim()){title.focus();return;}try{await api('/tasks/'+parent.id+'/subtasks',{method:'POST',body:{title:title.value.trim(),offset_days:parent.offset_days||0}});collapsed.delete(Number(parent.id));await reloadTasks();await reloadDetail();toast('Subtask created','ok');}catch(err){toast(err.message,'err');}};
      const inline=h('div',{class:'task-inline-add'},title,h('button',{class:'btn sm primary',onclick:create},'Create'));
      const section=body.querySelector('.task-subtask-list');
      if(section)section.parentElement.insertBefore(inline,section.nextSibling);title.focus();
      title.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();create();}});
    }
    renderDetail();
  }
  draw();
}

/* ---------- MILESTONES via timeline ---------- */

/* ---------- TIMELINE ---------- */
async function viewTimeline(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Timeline'),
    h('div',{style:'display:flex;gap:8px'},
      can('Event Manager')&&h('button',{class:'btn',onclick:async()=>{const r=await api('/events/'+State.currentEventId+'/ai/apply-timeline',{method:'POST'});toast('Added '+r.count+' AI-suggested items','ok');viewTimeline(v.parentElement?v:$('#view'));}},'🤖 Generate Standard Timeline'),
      can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openMilestoneForm()},'+ Milestone'))));
  if(!needEvent(v))return;
  const ev=currentEvent();
  const [milestones,tasks,anns]=await Promise.all([
    api('/events/'+State.currentEventId+'/milestones'),
    api('/events/'+State.currentEventId+'/tasks'),
    api('/events/'+State.currentEventId+'/announcements')]);
  let items=[
    ...milestones.map(m=>({...m,itype:'Milestone',label:m.name})),
    ...tasks.map(t=>({...t,itype:t.type||'Task',label:t.title})),
    ...anns.map(a=>({...a,itype:'Announcement',label:a.title})),
  ].sort((a,b)=>(a.offset_days||0)-(b.offset_days||0));
  let mode='timeline';
  const sub=h('div',{class:'subnav'});
  for(const[val,l]of[['timeline','Timeline'],['list','List']]) sub.appendChild(h('button',{class:mode===val?'active':'',onclick:()=>{mode=val;draw();}},l));
  v.appendChild(sub);
  const c=h('div',{}); v.appendChild(c);
  const today=new Date().toISOString().slice(0,10);
  function draw(){
    c.innerHTML='';
    [...sub.children].forEach(b=>b.classList.toggle('active',b.textContent.toLowerCase()===mode));
    if(!items.length){c.appendChild(h('div',{class:'card list-empty'},'No timeline items yet.'));return;}
    if(mode==='timeline'){
      const tl=h('div',{class:'card'});const inner=h('div',{class:'tl'});
      for(const it of items){
        const past=it.computed_date&&it.computed_date<today;
        inner.appendChild(h('div',{class:'tl-item'+(past?' past':'')},
          h('div',{style:'display:flex;gap:8px;align-items:center;flex-wrap:wrap'},
            h('span',{class:'badge rel'},it.relative),
            h('strong',{},it.label),
            h('span',{class:'badge b-blue'},it.itype),
            inheritedTag(it),
            h('span',{class:'muted'},fmtDate(it.computed_date)),
            it.status?statusBadgeEl(it.status):null)));
      }
      tl.appendChild(inner);c.appendChild(tl);
    } else {
      const wrap=h('div',{class:'card table-wrap'});const t=h('table');
      t.appendChild(h('thead',{},h('tr',{},h('th',{},'Rel'),h('th',{},'Name'),h('th',{},'Type'),h('th',{},'Date'),h('th',{},'Owner'),h('th',{},'Status'))));
      const tb=h('tbody');
      for(const it of items)tb.appendChild(h('tr',{},h('td',{},h('span',{class:'badge rel'},it.relative)),h('td',{},it.label),h('td',{},it.itype),h('td',{},fmtDate(it.computed_date)),h('td',{},it.owner||'—'),h('td',{html:it.status?statusBadge(it.status):'—'})));
      t.appendChild(tb);wrap.appendChild(t);c.appendChild(wrap);
    }
  }
  draw();
  function openMilestoneForm(m){
    formModal(m?'Edit Milestone':'New Milestone',[
      {name:'name',label:'Name'},{name:'description',label:'Description',type:'textarea'},
      {name:'offset_days',label:'Relative timing (days from event)',type:'number'},
      {name:'date_override',label:'Date override (optional)',type:'date'},
      {name:'owner',label:'Owner'},
      {name:'status',label:'Status',type:'select',options:['Not Started','In Progress','Blocked','Completed','Cancelled']},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{
      data.offset_days=Number(data.offset_days)||0;
      if(m)await api('/milestones/'+m.id,{method:'PUT',body:data});
      else await api('/events/'+State.currentEventId+'/milestones',{method:'POST',body:data});
      toast('Saved','ok');viewTimeline($('#view'));
    },m||{status:'Not Started'});
  }
  window.__openMilestoneForm=openMilestoneForm;
}

/* ---------- CALENDAR ---------- */
async function viewCalendar(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Calendar')));
  if(!needEvent(v))return;
  const ev=currentEvent();
  const [milestones,tasks,anns]=await Promise.all([
    api('/events/'+State.currentEventId+'/milestones'),
    api('/events/'+State.currentEventId+'/tasks'),
    api('/events/'+State.currentEventId+'/announcements')]);
  let filter='all';
  const items=[...milestones.map(m=>({date:m.computed_date,label:m.name,type:'Milestone',cls:'b-purple'})),
    ...tasks.map(t=>({date:t.computed_date,label:t.title,type:t.type==='Event Day Activity'?'Event Day':'Task',cls:t.type==='Event Day Activity'?'b-green':'b-blue'})),
    ...anns.map(a=>({date:a.computed_date,label:a.title,type:'Announcement',cls:'b-amber'}))].filter(i=>i.date);
  const tools=h('div',{class:'tag-tools'});
  const fsel=h('select',{style:'max-width:180px',onchange:e=>{filter=e.target.value;draw();}},...['all','Milestone','Task','Announcement','Event Day'].map(o=>h('option',{value:o},o==='all'?'All types':o)));
  tools.appendChild(fsel);v.appendChild(tools);
  let month=ev.start_date?new Date(ev.start_date+'T00:00:00'):new Date();
  month=new Date(month.getFullYear(),month.getMonth(),1);
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    const nav=h('div',{style:'display:flex;gap:8px;align-items:center;margin-bottom:10px'},
      h('button',{class:'btn sm',onclick:()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);draw();}},'‹ Prev'),
      h('strong',{},month.toLocaleDateString(undefined,{month:'long',year:'numeric'})),
      h('button',{class:'btn sm',onclick:()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);draw();}},'Next ›'));
    cont.appendChild(nav);
    const grid=h('div',{style:'display:grid;grid-template-columns:repeat(7,1fr);gap:6px'});
    for(const d of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])grid.appendChild(h('div',{class:'muted',style:'text-align:center;font-weight:700;font-size:11px'},d));
    const first=new Date(month.getFullYear(),month.getMonth(),1);
    const startDay=first.getDay();
    const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    for(let i=0;i<startDay;i++)grid.appendChild(h('div',{}));
    const fitems=items.filter(i=>filter==='all'||i.type===filter);
    for(let d=1;d<=days;d++){
      const ds=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayItems=fitems.filter(i=>i.date===ds);
      const cell=h('div',{class:'card',style:'min-height:90px;padding:8px'},h('div',{style:'font-weight:700;font-size:12px'},d));
      for(const it of dayItems.slice(0,4))cell.appendChild(h('div',{class:'badge '+it.cls,style:'display:block;margin-top:3px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',title:it.type+': '+it.label},it.label));
      if(dayItems.length>4)cell.appendChild(h('div',{class:'muted',style:'font-size:10px'},'+'+(dayItems.length-4)+' more'));
      grid.appendChild(cell);
    }
    cont.appendChild(grid);
  }
  draw();
}

/* ---------- ANNOUNCEMENTS ---------- */
async function viewAnnouncements(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Announcements'),
    h('div',{style:'display:flex;gap:8px'},
      h('button',{class:'btn',onclick:analyzeAnns},'🤖 Analyze'),
      can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openAnnForm()},'+ New Announcement'))));
  if(!needEvent(v))return;
  let anns=await api('/events/'+State.currentEventId+'/announcements');
  const cats=await api('/categories');
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!anns.length){cont.appendChild(h('div',{class:'card list-empty'},'No announcements yet.'));return;}
    const wrap=h('div',{class:'card table-wrap'});const t=h('table');
    t.appendChild(h('thead',{},h('tr',{},h('th',{},'Rel'),h('th',{},'Title'),h('th',{},'Category'),h('th',{},'Channel'),h('th',{},'Date'),h('th',{},'Approval'),h('th',{},'Published'),h('th',{},'v'),h('th',{},'Keep/Mod/Rem'),h('th',{},''))));
    const tb=h('tbody');
    for(const a of anns){
      tb.appendChild(h('tr',{},
        h('td',{},h('span',{class:'badge rel'},a.relative)),
        h('td',{},h('div',{style:'font-weight:600;cursor:pointer',onclick:()=>openAnnDetail(a.id)},a.title,inheritedTag(a))),
        h('td',{},a.category||'—'),
        h('td',{},a.channel||'—'),
        h('td',{},fmtDate(a.computed_date)),
        h('td',{html:statusBadge(a.approval_status)}),
        h('td',{html:statusBadge(a.published_status)}),
        h('td',{},'v'+a.version),
        h('td',{},can('Contributor')?dispControl('announcements',a,async()=>{anns=await api('/events/'+State.currentEventId+'/announcements');}):(a.disposition||'—')),
        h('td',{},h('button',{class:'btn sm',onclick:()=>openAnnDetail(a.id)},'Open'))
      ));
    }
    t.appendChild(tb);wrap.appendChild(t);cont.appendChild(wrap);
  }
  draw();
  async function analyzeAnns(){
    const r=await api('/events/'+State.currentEventId+'/ai/analyze-announcements');
    const body=h('div',{});
    body.appendChild(h('p',{class:'muted'},'AI Suggested findings — review only, nothing changed automatically.'));
    for(const f of r.findings){const cls=f.severity==='warning'?'b-amber':f.severity==='ok'?'b-green':'b-blue';body.appendChild(h('div',{class:'card',style:'margin-bottom:8px'},h('span',{class:'badge '+cls},f.type),' ',h('span',{},f.detail)));}
    modal({title:'Announcement Analysis',body,footer:(f,close)=>f.appendChild(h('button',{class:'btn primary',onclick:close},'Close'))});
  }
  window.__annReload=async()=>{anns=await api('/events/'+State.currentEventId+'/announcements');draw();};
  function openAnnForm(a){
    const catOpts=['',...cats.map(c=>c.name)];
    formModal(a?'Edit Announcement':'New Announcement',[
      {name:'title',label:'Title'},
      {name:'category',label:'Category',type:'select',options:catOpts},
      {name:'phase_group',label:'Phase Group',type:'select',options:['','Before Event','During Event','After Event']},
      {name:'offset_days',label:'Relative timing (days from event)',type:'number'},
      {name:'date_override',label:'Date override (optional)',type:'date'},
      {name:'audience',label:'Audience'},{name:'purpose',label:'Purpose'},
      {name:'channel',label:'Channel',type:'select',options:['Email','WhatsApp','SMS','Website','Social Media','Printed Notice','In-person Announcement','Other']},
      {name:'owner',label:'Owner'},
      {name:'message',label:'Message',type:'textarea',rows:5},
      {name:'short_version',label:'Short version'},
      a&&{name:'change_reason',label:'Reason for change (creates a new version)'},
    ].filter(Boolean),async data=>{
      data.offset_days=Number(data.offset_days)||0;
      if(a)await api('/announcements/'+a.id,{method:'PUT',body:data});
      else await api('/events/'+State.currentEventId+'/announcements',{method:'POST',body:data});
      anns=await api('/events/'+State.currentEventId+'/announcements');draw();toast('Saved','ok');
    },a||{channel:'Email'});
  }
  window.__openAnnForm=openAnnForm;
}
async function openAnnDetail(id){
  const a=await api('/announcements/'+id);
  const body=h('div',{});
  body.appendChild(h('div',{style:'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px'},
    h('span',{class:'badge rel'},a.relative),statusBadgeEl(a.approval_status),statusBadgeEl(a.published_status),h('span',{class:'badge b-gray'},'v'+a.version),h('span',{class:'badge b-blue'},a.channel||'—')));
  const kv=h('div',{class:'kv'});
  for(const[k,val]of[['Category',a.category],['Phase',a.phase_group],['Audience',a.audience],['Purpose',a.purpose],['Owner',a.owner],['Scheduled',fmtDate(a.computed_date)],['Publication date',a.publication_date?fmtDate(a.publication_date):'Not published']]){kv.appendChild(h('div',{},k));kv.appendChild(h('div',{},val||'—'));}
  body.appendChild(kv);
  body.appendChild(h('div',{style:'margin-top:10px'},h('h3',{},'Message'),h('div',{class:'card',style:'white-space:pre-wrap;background:var(--surface2)'},a.message||'—')));
  // approval workflow
  body.appendChild(h('h3',{style:'margin-top:14px'},'Approval Workflow'));
  const wf=h('div',{style:'display:flex;gap:6px;flex-wrap:wrap;align-items:center'});
  ['Draft','Review','Approved','Scheduled','Published'].forEach((s,i)=>{
    wf.appendChild(h('span',{class:'badge '+(a.approval_status===s?'b-green':'b-gray')},s));
    if(i<4)wf.appendChild(h('span',{class:'muted'},'→'));
  });
  body.appendChild(wf);
  if(can('Coordinator')&&a.published_status!=='Published'){
    const actions=h('div',{style:'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap'});
    const trans={Draft:'Review',Review:'Approved',Approved:'Scheduled',Scheduled:'Published'};
    const next=trans[a.approval_status];
    if(next)actions.appendChild(h('button',{class:'btn primary sm',onclick:async()=>{
      if(next==='Published')confirmModal('Mark as Published','This records that the announcement was ACTUALLY published/sent externally. Only confirm if the message was truly sent. Continue?',async()=>{await api('/announcements/'+a.id+'/transition',{method:'POST',body:{to:next}});toast('Marked Published','ok');reopen();});
      else {await api('/announcements/'+a.id+'/transition',{method:'POST',body:{to:next}});toast('Moved to '+next,'ok');reopen();}
    }},'Advance to '+next));
    body.appendChild(actions);
  }
  // versions
  body.appendChild(h('h3',{style:'margin-top:14px'},'Version History ('+a.versions.length+')'));
  for(const ver of a.versions){
    body.appendChild(h('div',{class:'card',style:'margin-bottom:6px;background:var(--surface2)'},
      h('div',{style:'display:flex;justify-content:space-between'},h('strong',{},'v'+ver.version+' — '+ver.title),h('span',{class:'muted',style:'font-size:11px'},new Date(ver.created_at+'Z').toLocaleString())),
      h('div',{class:'muted',style:'font-size:12px'},'by '+ver.author+' · '+(ver.reason||'')),
      h('div',{style:'font-size:12px;margin-top:4px;white-space:pre-wrap'},(ver.message||'').slice(0,200))));
  }
  // attachments
  body.appendChild(h('h3',{style:'margin-top:14px'},'Attachments'));
  const attWrap=h('div',{});body.appendChild(attWrap);loadAttachments('announcement',a.id,attWrap);
  const m=modal({title:a.title,size:'lg',body,footer:(f,close)=>{
    if(can('Contributor'))f.appendChild(h('button',{class:'btn',onclick:async()=>{await api('/announcements/'+a.id+'/duplicate',{method:'POST'});toast('Duplicated','ok');close();if(window.__annReload)window.__annReload();}},'Duplicate'));
    if(can('Contributor'))f.appendChild(h('button',{class:'btn',onclick:()=>{close();if(window.__openAnnForm)window.__openAnnForm(a);}},'Edit'));
    if(can('Coordinator'))f.appendChild(h('button',{class:'btn danger',onclick:()=>confirmModal('Delete','Delete this announcement? Version history will be removed.',async()=>{await api('/announcements/'+a.id,{method:'DELETE'});toast('Deleted','ok');close();if(window.__annReload)window.__annReload();})},'Delete'));
    f.appendChild(h('button',{class:'btn primary',onclick:close},'Close'));
  }});
  function reopen(){m.close();openAnnDetail(id);if(window.__annReload)window.__annReload();}
}

/* ---------- COMMUNICATION PLAN ---------- */
async function viewCommunication(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Communication Plan'),
    can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ New Communication')));
  if(!needEvent(v))return;
  let comms=await api('/events/'+State.currentEventId+'/communications');
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!comms.length){cont.appendChild(h('div',{class:'card list-empty'},'No communications planned.'));return;}
    const wrap=h('div',{class:'card table-wrap'});const t=h('table');
    t.appendChild(h('thead',{},h('tr',{},h('th',{},'Rel'),h('th',{},'Title'),h('th',{},'Purpose'),h('th',{},'Audience'),h('th',{},'Channel'),h('th',{},'Date'),h('th',{},'Approval'),h('th',{},'Status'),h('th',{},''))));
    const tb=h('tbody');
    for(const c of comms)tb.appendChild(h('tr',{},
      h('td',{},h('span',{class:'badge rel'},c.relative)),h('td',{style:'font-weight:600'},c.title),h('td',{},c.purpose||'—'),h('td',{},c.audience||'—'),
      h('td',{},c.channel),h('td',{},fmtDate(c.computed_date)),h('td',{},c.approval_required?'Required':'—'),h('td',{html:statusBadge(c.status)}),
      h('td',{},can('Contributor')&&h('button',{class:'btn sm',onclick:()=>openForm(c)},'Edit'))));
    t.appendChild(tb);wrap.appendChild(t);cont.appendChild(wrap);
  }
  draw();
  function openForm(c){
    formModal(c?'Edit Communication':'New Communication',[
      {name:'title',label:'Title'},{name:'purpose',label:'Purpose'},{name:'audience',label:'Audience'},
      {name:'channel',label:'Channel',type:'select',options:['Email','WhatsApp','SMS','Website','Social Media','Printed Notice','In-person Announcement','Other']},
      {name:'offset_days',label:'Relative timing (days from event)',type:'number'},
      {name:'owner',label:'Owner'},
      {name:'status',label:'Status',type:'select',options:['Planned','Ready to Send','Sent','Cancelled']},
      {name:'approval_required',label:'Approval required',type:'checkbox'},
      {name:'message',label:'Message',type:'textarea'},
    ],async data=>{data.offset_days=Number(data.offset_days)||0;if(c)await api('/communications/'+c.id,{method:'PUT',body:data});else await api('/events/'+State.currentEventId+'/communications',{method:'POST',body:data});comms=await api('/events/'+State.currentEventId+'/communications');draw();toast('Saved','ok');},c||{channel:'Email',status:'Planned'});
  }
}

/* ---------- CHECKLISTS ---------- */
async function viewChecklists(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Checklists'),
    can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ New Checklist')));
  if(!needEvent(v))return;
  let lists=await api('/checklists?event_id='+State.currentEventId);
  const cont=h('div',{class:'grid cols-2'});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!lists.length){cont.appendChild(h('div',{class:'card list-empty'},'No checklists yet.'));return;}
    for(const l of lists){
      const done=l.items.filter(i=>i.done).length;
      const card=h('div',{class:'card'});
      card.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:center'},h('h2',{style:'margin:0;font-size:15px'},l.name),h('span',{class:'badge b-gray'},done+'/'+l.items.length)));
      card.appendChild(h('div',{class:'progress',style:'margin:8px 0'},h('span',{style:'width:'+(l.items.length?done/l.items.length*100:0)+'%'})));
      for(const it of l.items){
        card.appendChild(h('label',{class:'chk'},
          h('input',{type:'checkbox',...(it.done?{checked:true}:{}),disabled:!can('Contributor'),onchange:async e=>{await api('/checklist-items/'+it.id,{method:'PUT',body:{done:e.target.checked?1:0}});it.done=e.target.checked?1:0;draw();}}),
          h('span',{style:it.done?'text-decoration:line-through;color:var(--muted)':''},it.text)));
      }
      if(can('Contributor')){
        const add=h('form',{style:'display:flex;gap:6px;margin-top:8px',onsubmit:async e=>{e.preventDefault();const txt=e.target.t.value.trim();if(!txt)return;await api('/checklists/'+l.id+'/items',{method:'POST',body:{text:txt}});lists=await api('/checklists?event_id='+State.currentEventId);draw();}},h('input',{name:'t',placeholder:'Add item…'}),h('button',{class:'btn sm'},'Add'));
        card.appendChild(add);
      }
      cont.appendChild(card);
    }
  }
  draw();
  function openForm(){
    formModal('New Checklist',[{name:'name',label:'Name'},{name:'category',label:'Category'},{name:'items',label:'Items (one per line)',type:'textarea',rows:6}],async data=>{
      const items=(data.items||'').split('\n').map(s=>s.trim()).filter(Boolean);
      await api('/checklists',{method:'POST',body:{event_id:State.currentEventId,name:data.name,category:data.category,items}});
      lists=await api('/checklists?event_id='+State.currentEventId);draw();toast('Created','ok');
    });
  }
}

/* ---------- PEOPLE ---------- */
async function viewPeople(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'People & Roles'),
    can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ Add Person')));
  if(!needEvent(v))return;
  let people=await api('/events/'+State.currentEventId+'/people');
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!people.length){cont.appendChild(h('div',{class:'card list-empty'},'No people assigned.'));return;}
    const wrap=h('div',{class:'card table-wrap'});const t=h('table');
    t.appendChild(h('thead',{},h('tr',{},h('th',{},'Name'),h('th',{},'Role'),h('th',{},'Email'),h('th',{},'Phone'),h('th',{},''))));
    const tb=h('tbody');
    for(const p of people)tb.appendChild(h('tr',{},h('td',{style:'font-weight:600'},p.name),h('td',{},h('span',{class:'badge b-blue'},p.role||'—')),h('td',{},p.email||'—'),h('td',{},p.phone||'—'),h('td',{},can('Contributor')&&h('button',{class:'btn sm',onclick:()=>openForm(p)},'Edit'))));
    t.appendChild(tb);wrap.appendChild(t);cont.appendChild(wrap);
  }
  draw();
  function openForm(p){
    const roles=['Event Director','Event Manager','Communication Coordinator','Volunteer Coordinator','Registration Coordinator','Technical Coordinator','Content Coordinator','Finance Coordinator','Venue Coordinator','Day Coordinator'];
    formModal(p?'Edit Person':'Add Person',[{name:'name',label:'Name'},{name:'role',label:'Role',type:'select',options:['',...roles,'Custom…']},{name:'email',label:'Email'},{name:'phone',label:'Phone'},{name:'notes',label:'Notes',type:'textarea'}],async data=>{if(p)await api('/people/'+p.id,{method:'PUT',body:data});else await api('/events/'+State.currentEventId+'/people',{method:'POST',body:data});people=await api('/events/'+State.currentEventId+'/people');draw();toast('Saved','ok');},p||{});
  }
}

/* ---------- LESSONS + RETROSPECTIVE ---------- */
async function viewLessons(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Lessons Learned & Retrospective')));
  if(!needEvent(v))return;
  let tab='lessons';
  const sub=h('div',{class:'subnav'});
  for(const[val,l]of[['lessons','Lessons Learned'],['retro','Retrospective'],['keep','Keep/Change/Remove']])sub.appendChild(h('button',{class:tab===val?'active':'',onclick:()=>{tab=val;draw();}},l));
  v.appendChild(sub);
  const cont=h('div',{});v.appendChild(cont);
  async function draw(){
    [...sub.children].forEach(b=>b.classList.toggle('active',b.textContent==={lessons:'Lessons Learned',retro:'Retrospective',keep:'Keep/Change/Remove'}[tab]));
    cont.innerHTML='';
    if(tab==='lessons')await drawLessons();
    else if(tab==='retro')await drawRetro();
    else await drawKeep();
  }
  async function drawLessons(){
    let lessons=await api('/events/'+State.currentEventId+'/lessons');
    const bar=h('div',{class:'tag-tools'});
    if(can('Contributor'))bar.appendChild(h('button',{class:'btn primary',onclick:()=>openForm()},'+ New Lesson'));
    bar.appendChild(h('button',{class:'btn',onclick:async()=>{const r=await api('/events/'+State.currentEventId+'/ai/extract-lessons');showExtract(r.proposals);}},'🤖 Extract Lessons'));
    cont.appendChild(bar);
    const unconfirmed=lessons.filter(l=>!l.confirmed);
    if(unconfirmed.length)cont.appendChild(h('div',{class:'card',style:'border-color:var(--amber);margin-bottom:12px'},h('h3',{style:'color:var(--amber)'},'⚠ '+unconfirmed.length+' AI-suggested lessons awaiting confirmation'),h('div',{class:'muted'},'Review below and confirm each before it becomes official knowledge.')));
    if(!lessons.length){cont.appendChild(h('div',{class:'card list-empty'},'No lessons recorded.'));return;}
    for(const l of lessons){
      const card=h('div',{class:'card',style:'margin-bottom:10px'+(!l.confirmed?';border-color:var(--amber)':'')});
      const head=h('div',{style:'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap'});
      const left=h('div',{});
      left.innerHTML=`<span class="badge b-blue">${esc(l.category||'General')}</span> ${prioBadge(l.priority)} <strong style="margin-left:6px">${esc(l.description)}</strong>`;
      head.appendChild(left);
      head.appendChild(h('div',{style:'display:flex;gap:6px'},!l.confirmed?h('span',{class:'badge b-amber'},'AI Suggested'):h('span',{class:'badge b-green'},'Confirmed')));
      card.appendChild(head);
      if(l.impact)card.appendChild(h('div',{style:'margin-top:6px'},h('span',{class:'muted'},'Impact: '),l.impact));
      if(l.recommendation)card.appendChild(h('div',{},h('span',{class:'muted'},'Recommendation: '),l.recommendation));
      if(l.action_next)card.appendChild(h('div',{},h('span',{class:'muted'},'Action for next event: '),l.action_next));
      const acts=h('div',{style:'margin-top:8px;display:flex;gap:6px'});
      if(!l.confirmed&&can('Contributor'))acts.appendChild(h('button',{class:'btn green sm',onclick:async()=>{await api('/lessons/'+l.id,{method:'PUT',body:{confirmed:1,source:'User'}});drawLessons2();toast('Confirmed','ok');}},'✓ Confirm'));
      if(can('Contributor'))acts.appendChild(h('button',{class:'btn sm',onclick:()=>openForm(l)},'Edit'));
      if(can('Coordinator'))acts.appendChild(h('button',{class:'btn danger sm',onclick:()=>confirmModal('Delete','Delete this lesson?',async()=>{await api('/lessons/'+l.id,{method:'DELETE'});drawLessons2();})},'Delete'));
      card.appendChild(acts);
      cont.appendChild(card);
    }
    async function drawLessons2(){cont.innerHTML='';await drawLessons();}
    window.__lessonReload=drawLessons2;
    function showExtract(proposals){
      const body=h('div',{});body.appendChild(h('p',{class:'muted'},'AI Suggested — add the ones you agree with.'));
      for(const p of proposals){body.appendChild(h('div',{class:'card',style:'margin-bottom:8px;background:var(--surface2)'},
        h('div',{},h('span',{class:'badge b-blue'},p.category),' ',p.description),
        h('div',{class:'muted',style:'font-size:12px;margin-top:4px'},'Rec: '+p.recommendation),
        can('Contributor')&&h('button',{class:'btn sm',style:'margin-top:6px',onclick:async e=>{await api('/events/'+State.currentEventId+'/lessons',{method:'POST',body:{category:p.category,description:p.description,recommendation:p.recommendation,priority:p.priority,confirmed:1,source:'User'}});e.target.textContent='Added ✓';e.target.disabled=true;}},'+ Add as Lesson')));}
      modal({title:'AI Lesson Extraction',body,footer:(f,close)=>f.appendChild(h('button',{class:'btn primary',onclick:()=>{close();drawLessons2();}},'Done'))});
    }
    function openForm(l){
      formModal(l?'Edit Lesson':'New Lesson',[
        {name:'category',label:'Category',type:'select',options:['Planning','Communication','Event Execution','People','Technology','Schedule','Registration','Recommendations']},
        {name:'description',label:'What happened / observation',type:'textarea'},
        {name:'impact',label:'Impact'},
        {name:'recommendation',label:'Recommendation'},
        {name:'priority',label:'Priority',type:'select',options:['Critical','High','Medium','Low']},
        {name:'action_next',label:'Action for next event'},
        {name:'owner',label:'Owner'},
      ],async data=>{data.confirmed=1;data.source='User';if(l)await api('/lessons/'+l.id,{method:'PUT',body:data});else await api('/events/'+State.currentEventId+'/lessons',{method:'POST',body:data});drawLessons2();toast('Saved','ok');},l||{priority:'Medium'});
    }
  }
  async function drawRetro(){
    let retro=await api('/events/'+State.currentEventId+'/retrospective');
    if(!retro.length){
      cont.appendChild(h('div',{class:'card list-empty'},'No retrospective yet.',h('div',{style:'margin-top:12px'},can('Coordinator')&&h('button',{class:'btn primary',onclick:async()=>{await api('/events/'+State.currentEventId+'/retrospective/init',{method:'POST'});draw();}},'Start Structured Retrospective'))));
      return;
    }
    const sections={};for(const r of retro)(sections[r.section]=sections[r.section]||[]).push(r);
    for(const[sec,items]of Object.entries(sections)){
      const card=h('div',{class:'card',style:'margin-bottom:12px'});card.appendChild(h('h2',{style:'font-size:15px'},sec));
      for(const it of items){
        card.appendChild(h('div',{class:'field'},h('label',{},it.question),
          h('textarea',{rows:2,disabled:!can('Contributor'),onchange:async e=>{await api('/retrospective/'+it.id,{method:'PUT',body:{answer:e.target.value}});toast('Saved','ok');}},it.answer||'')));
      }
      cont.appendChild(card);
    }
  }
  async function drawKeep(){
    const [tasks,anns,ms]=await Promise.all([api('/events/'+State.currentEventId+'/tasks'),api('/events/'+State.currentEventId+'/announcements'),api('/events/'+State.currentEventId+'/milestones')]);
    cont.appendChild(h('p',{class:'muted'},'Classify each item as KEEP / MODIFY / REMOVE. These decisions drive "Create Next Event".'));
    const mk=(title,entity,items,labelFn)=>{
      const card=h('div',{class:'card',style:'margin-bottom:12px'});card.appendChild(h('h2',{style:'font-size:15px'},title));
      if(!items.length){card.appendChild(h('div',{class:'muted'},'None'));return card;}
      for(const it of items){
        card.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)'},
          h('div',{},labelFn(it),it.disposition?h('span',{class:'badge b-purple',style:'margin-left:6px'},it.disposition):null),
          can('Contributor')?dispControl(entity,it,()=>{}):h('span',{},it.disposition||'—')));
      }
      return card;
    };
    cont.appendChild(mk('Milestones','milestones',ms,i=>i.name));
    cont.appendChild(mk('Tasks','tasks',tasks,i=>i.title));
    cont.appendChild(mk('Announcements','announcements',anns,i=>i.title));
  }
  draw();
}

/* ---------- KNOWLEDGE BASE ---------- */
async function viewKnowledge(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Knowledge Base')));
  v.appendChild(h('div',{class:'card',style:'margin-bottom:14px'},
    h('p',{class:'muted',style:'margin-top:0'},'Search across all events: announcements, tasks, lessons, milestones, checklists. Try "registration", "two weeks", "thank you", or "problem".'),
    h('input',{id:'kb-q',placeholder:'Ask the knowledge base…',oninput:e=>run(e.target.value)})));
  const results=h('div',{});v.appendChild(results);
  let timer;
  async function run(q){
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      if(!q||q.length<2){results.innerHTML='';return;}
      const r=await api('/search?q='+encodeURIComponent(q));
      results.innerHTML='';
      if(!r.length){results.appendChild(h('div',{class:'card list-empty'},'No matches for "'+esc(q)+'"'));return;}
      results.appendChild(h('div',{class:'muted',style:'margin-bottom:8px'},r.length+' results'));
      for(const it of r){
        const clsMap={Announcement:'b-amber',Task:'b-blue',Lesson:'b-green',Milestone:'b-purple','Checklist item':'b-gray'};
        results.appendChild(h('div',{class:'card',style:'margin-bottom:8px;cursor:'+(it.type==='Announcement'?'pointer':'default'),onclick:()=>{if(it.type==='Announcement')openAnnDetail(it.id);}},
          h('div',{style:'display:flex;justify-content:space-between;gap:8px'},h('strong',{},it.title),h('span',{class:'badge '+(clsMap[it.type]||'b-gray')},it.type)),
          it.snippet?h('div',{class:'muted',style:'font-size:12px;margin-top:4px'},it.snippet):null,
          h('div',{class:'muted',style:'font-size:11px;margin-top:4px'},it.context)));
      }
    },250);
  }
}

/* ---------- TEMPLATES ---------- */
async function viewTemplates(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Templates'),
    can('Event Manager')&&State.currentEventId&&h('button',{class:'btn primary',onclick:saveAsTemplate},'+ Save Current Event as Template')));
  let templates=await api('/templates');
  if(!templates.length){v.appendChild(h('div',{class:'card list-empty'},'No templates yet. Save an event as a template to reuse its milestones, tasks, announcements and checklists.'));}
  const grid=h('div',{class:'grid cols-3'});v.appendChild(grid);
  for(const t of templates){
    const data=JSON.parse(t.data||'{}');
    grid.appendChild(h('div',{class:'card'},
      h('h2',{style:'font-size:15px;margin:0'},t.name),
      h('div',{class:'muted',style:'margin:6px 0'},t.description||''),
      h('div',{style:'font-size:12px'},`${(data.milestones||[]).length} milestones · ${(data.tasks||[]).length} tasks · ${(data.announcements||[]).length} announcements · ${(data.checklists||[]).length} checklists`),
      can('Event Manager')&&State.currentEventId&&h('button',{class:'btn sm',style:'margin-top:10px',onclick:async()=>{await api('/events/'+State.currentEventId+'/apply-template/'+t.id,{method:'POST'});toast('Template applied to current event','ok');}},'Apply to Current Event')));
  }
  async function saveAsTemplate(){
    formModal('Save as Template',[{name:'name',label:'Template Name'}],async data=>{await api('/events/'+State.currentEventId+'/save-template',{method:'POST',body:data});toast('Template saved','ok');viewTemplates($('#view'));},{name:(currentEvent()?currentEvent().name:'')+' Template'});
  }
}

/* ---------- REPORTS ---------- */
async function viewReports(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Reports')));
  if(!needEvent(v))return;
  const ev=currentEvent();
  const grid=h('div',{class:'grid cols-2'});v.appendChild(grid);
  const reports=[
    ['Event Summary','summary','Full details, timeline, milestones, tasks, announcements, lessons.'],
    ['Communication Report','communication','Every communication in chronological order.'],
    ['Lessons Learned Report','lessons','Problems, impact, solutions, recommendations, next-year actions.'],
    ['Next Event Preparation','next-prep','What needs to happen and when for next time.'],
    ['Event Playbook','playbook','Complete chronological playbook document.'],
  ];
  for(const[title,type,desc]of reports){
    grid.appendChild(h('div',{class:'card'},h('h2',{style:'font-size:15px;margin:0'},title),h('div',{class:'muted',style:'margin:6px 0 10px'},desc),
      h('div',{style:'display:flex;gap:6px;flex-wrap:wrap'},
        h('button',{class:'btn sm primary',onclick:()=>showReport(title,type)},'View'),
        type==='playbook'&&h('button',{class:'btn sm',onclick:()=>printPlaybook()},'🖨 Print / PDF'))));
  }
  v.appendChild(h('div',{class:'section-title'},'Exports (CSV / Excel-compatible)'));
  const ex=h('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  for(const k of ['tasks','announcements','milestones','lessons'])
    ex.appendChild(h('a',{class:'btn sm',href:'#',onclick:async e=>{e.preventDefault();await downloadCsv(k);}},'⬇ '+k+'.csv'));
  v.appendChild(ex);

  async function downloadCsv(kind){
    const res=await fetch('/api/events/'+State.currentEventId+'/export/'+kind+'.csv',{headers:{Authorization:'Bearer '+State.token}});
    const blob=await res.blob();const url=URL.createObjectURL(blob);const a=h('a',{href:url,download:ev.name.replace(/\W+/g,'_')+'_'+kind+'.csv'});document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }
  async function showReport(title,type){
    const d=await api('/events/'+State.currentEventId+'/report/'+type);
    const body=h('div',{});
    if(type==='communication'){
      body.appendChild(h('h3',{},'Communication Schedule'));
      for(const a of d.announcements)body.appendChild(h('div',{style:'padding:6px 0;border-bottom:1px solid var(--line)'},h('span',{class:'badge rel'},a.relative),' ',fmtDate(a.computed_date),' — ',h('strong',{},a.title),' ',statusBadgeEl(a.published_status)));
    } else if(type==='lessons'){
      for(const l of d.lessons)body.appendChild(h('div',{class:'card',style:'margin-bottom:8px;background:var(--surface2)'},h('strong',{},l.category+': '+l.description),h('div',{class:'muted',style:'font-size:12px'},'Impact: '+(l.impact||'—')),h('div',{class:'muted',style:'font-size:12px'},'Recommendation: '+(l.recommendation||'—')),h('div',{class:'muted',style:'font-size:12px'},'Next action: '+(l.action_next||'—'))));
      if(!d.lessons.length)body.appendChild(h('div',{class:'muted'},'No lessons.'));
    } else if(type==='next-prep'){
      if(!d.actions.length)body.appendChild(h('div',{class:'muted'},'No next-event actions recorded. Add "Action for next event" to lessons.'));
      for(const a of d.actions)body.appendChild(h('div',{style:'padding:6px 0;border-bottom:1px solid var(--line)'},prioEl(a.priority),' ',h('strong',{},a.action),h('div',{class:'muted',style:'font-size:12px'},'From: '+a.from)));
    } else {
      body.appendChild(renderSummary(d));
    }
    modal({title,size:'lg',body,footer:(f,close)=>f.appendChild(h('button',{class:'btn primary',onclick:close},'Close'))});
  }
  function prioEl(p){const d=h('span',{});d.innerHTML=prioBadge(p);return d.firstChild;}
  function renderSummary(d){
    const w=h('div',{});
    w.appendChild(h('div',{class:'kv'},...[['Event',d.event.name],['Date',fmtDate(d.event.start_date)],['Location',d.event.location],['Status',d.event.status]].flatMap(([k,val])=>[h('div',{},k),h('div',{},val||'—')])));
    const sec=(t,rows,cols,fn)=>{w.appendChild(h('h3',{style:'margin-top:14px'},t));if(!rows.length){w.appendChild(h('div',{class:'muted'},'None'));return;}const tab=h('table');tab.appendChild(h('thead',{},h('tr',{},...cols.map(c=>h('th',{},c)))));const tb=h('tbody');rows.forEach(r=>tb.appendChild(fn(r)));tab.appendChild(tb);w.appendChild(h('div',{class:'table-wrap'},tab));};
    sec('Milestones',d.milestones,['Rel','Name','Status'],m=>h('tr',{},h('td',{},m.relative),h('td',{},m.name),h('td',{html:statusBadge(m.status)})));
    sec('Tasks',d.tasks,['Rel','Task','Priority','Status'],t=>h('tr',{},h('td',{},t.relative),h('td',{},t.title),h('td',{html:prioBadge(t.priority)}),h('td',{html:statusBadge(t.status)})));
    sec('Announcements',d.announcements,['Rel','Title','Published'],a=>h('tr',{},h('td',{},a.relative),h('td',{},a.title),h('td',{html:statusBadge(a.published_status)})));
    return w;
  }
  async function printPlaybook(){
    const d=await api('/events/'+State.currentEventId+'/report/playbook');
    const w=window.open('','_blank');
    const rows=(arr,fn)=>arr.map(fn).join('');
    w.document.write(`<html><head><title>${esc(d.event.name)} — Playbook</title>
    <style>body{font-family:system-ui,Arial;margin:32px;color:#111;line-height:1.5}h1{border-bottom:3px solid #5b8cff}h2{margin-top:26px;border-bottom:1px solid #ccc;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}code{background:#eef;padding:1px 5px;border-radius:4px}@media print{.noprint{display:none}}</style></head><body>
    <button class="noprint" onclick="window.print()" style="padding:8px 16px;font-size:14px">🖨 Print / Save as PDF</button>
    <h1>${esc(d.event.name)} — Event Playbook</h1>
    <p><b>Type:</b> ${esc(d.event.event_type||'—')} &nbsp; <b>Date:</b> ${fmtDate(d.event.start_date)}–${fmtDate(d.event.end_date)} &nbsp; <b>Location:</b> ${esc(d.event.location||'—')}<br>
    <b>Organizer:</b> ${esc(d.event.organizer||'—')} &nbsp; <b>Owner:</b> ${esc(d.event.owner||'—')} &nbsp; <b>Participants:</b> ${d.event.participants||0}</p>
    <p>${esc(d.event.description||'')}</p>
    <h2>1. Key Dates & Timeline</h2><table><tr><th>Relative</th><th>Date</th><th>Item</th><th>Type</th></tr>
    ${rows([...d.milestones.map(m=>({r:m.relative,d:m.computed_date,n:m.name,t:'Milestone'})),...d.announcements.map(a=>({r:a.relative,d:a.computed_date,n:a.title,t:'Announcement'})),...d.tasks.map(t=>({r:t.relative,d:t.computed_date,n:t.title,t:t.type||'Task'}))].sort((a,b)=>(a.d||'').localeCompare(b.d||'')),i=>`<tr><td><code>${i.r}</code></td><td>${fmtDate(i.d)}</td><td>${esc(i.n)}</td><td>${esc(i.t)}</td></tr>`)}</table>
    <h2>2. Milestones</h2><table><tr><th>Name</th><th>Owner</th><th>Status</th></tr>${rows(d.milestones,m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.owner||'—')}</td><td>${esc(m.status)}</td></tr>`)}</table>
    <h2>3. Tasks & Responsibilities</h2><table><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Status</th></tr>${rows(d.tasks,t=>`<tr><td>${esc(t.title)}</td><td>${esc(t.owner||'—')}</td><td>${esc(t.priority)}</td><td>${esc(t.status)}</td></tr>`)}</table>
    <h2>4. Communication & Announcement Schedule</h2><table><tr><th>Relative</th><th>Title</th><th>Channel</th><th>Audience</th></tr>${rows(d.announcements,a=>`<tr><td><code>${a.relative}</code></td><td>${esc(a.title)}</td><td>${esc(a.channel||'—')}</td><td>${esc(a.audience||'—')}</td></tr>`)}</table>
    <h2>5. Checklists</h2>${d.checklists.map(c=>`<h3>${esc(c.name)}</h3><ul>${c.items.map(i=>`<li>${i.done?'☑':'☐'} ${esc(i.text)}</li>`).join('')}</ul>`).join('')||'<p>None</p>'}
    <h2>6. Important Contacts</h2><table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr>${rows(d.people,p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.role||'—')}</td><td>${esc(p.email||'—')}</td><td>${esc(p.phone||'—')}</td></tr>`)}</table>
    <h2>7. Lessons Learned & Recommended Improvements</h2><table><tr><th>Category</th><th>Lesson</th><th>Recommendation</th><th>Next action</th></tr>${rows(d.lessons,l=>`<tr><td>${esc(l.category||'')}</td><td>${esc(l.description||'')}</td><td>${esc(l.recommendation||'')}</td><td>${esc(l.action_next||'')}</td></tr>`)}</table>
    </body></html>`);
    w.document.close();
  }
}

/* ---------- EVENT DAY MODE ---------- */
async function viewEventDay(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'★ Event Day Mode')));
  if(!needEvent(v))return;
  const ev=currentEvent();
  const wrap=h('div',{class:'event-day'});v.appendChild(wrap);
  let date=ev.start_date||new Date().toISOString().slice(0,10);
  const picker=h('div',{class:'card',style:'margin-bottom:14px;text-align:center'});
  picker.appendChild(h('label',{},'Viewing day'));
  picker.appendChild(h('input',{type:'date',value:date,onchange:e=>{date=e.target.value;draw();}}));
  wrap.appendChild(picker);
  const cont=h('div',{});wrap.appendChild(cont);
  async function draw(){
    cont.innerHTML='';
    const d=await api('/events/'+State.currentEventId+'/eventday?date='+date);
    cont.appendChild(h('div',{class:'card',style:'text-align:center;margin-bottom:14px'},
      h('div',{style:'font-size:28px;font-weight:800'},d.eventDayNum&&d.eventDayNum>0?'EVENT DAY '+d.eventDayNum:fmtDate(date)),
      h('div',{class:'muted'},new Date(date+'T00:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))));
    // schedule
    cont.appendChild(h('h3',{},'Today\'s Schedule'));
    if(!d.dayActivities.length)cont.appendChild(h('div',{class:'muted',style:'margin-bottom:12px'},'No scheduled activities for this day.'));
    for(const a of d.dayActivities){
      cont.appendChild(h('div',{class:'ed-slot'},
        h('div',{class:'ed-check'+(a.status==='Completed'?' done':''),onclick:async()=>{if(!can('Contributor'))return;await api('/tasks/'+a.id,{method:'PUT',body:{status:a.status==='Completed'?'Not Started':'Completed'}});draw();}},a.status==='Completed'?'✓':''),
        h('div',{style:'flex:1'},h('div',{style:'font-weight:700'},a.title),a.notes?h('div',{class:'muted',style:'font-size:12px'},a.notes):null)));
    }
    // announcements
    cont.appendChild(h('h3',{style:'margin-top:16px'},'Announcements'));
    if(!d.announcements.length)cont.appendChild(h('div',{class:'muted'},'None scheduled today.'));
    for(const a of d.announcements){
      const pub=a.published_status==='Published';
      cont.appendChild(h('div',{class:'ed-slot'},
        h('div',{class:'ed-check'+(pub?' done':''),style:'font-size:14px'},pub?'✓':'→'),
        h('div',{style:'flex:1'},h('div',{style:'font-weight:700'},a.title),h('div',{class:'muted',style:'font-size:12px'},(a.channel||'')+' · '+(pub?'Published':'Not yet published'))),
        !pub&&can('Coordinator')&&h('button',{class:'btn sm',onclick:()=>openAnnDetail(a.id)},'Open')));
    }
    // tasks today
    if(d.tasksToday.filter(t=>t.type!=='Event Day Activity').length){
      cont.appendChild(h('h3',{style:'margin-top:16px'},'Tasks Due Today'));
      for(const t of d.tasksToday.filter(x=>x.type!=='Event Day Activity'))cont.appendChild(h('div',{class:'ed-slot'},h('div',{class:'ed-check'+(t.status==='Completed'?' done':''),onclick:async()=>{if(!can('Contributor'))return;await api('/tasks/'+t.id,{method:'PUT',body:{status:t.status==='Completed'?'Not Started':'Completed'}});draw();}},t.status==='Completed'?'✓':''),h('div',{style:'flex:1'},t.title)));
    }
    // contacts
    cont.appendChild(h('h3',{style:'margin-top:16px'},'Important Contacts'));
    for(const p of d.contacts)cont.appendChild(h('div',{class:'card',style:'margin-bottom:6px;display:flex;justify-content:space-between'},h('div',{},h('strong',{},p.name),' ',h('span',{class:'badge b-blue'},p.role||'')),h('div',{class:'muted'},p.phone||p.email||'')));
    if(!d.contacts.length)cont.appendChild(h('div',{class:'muted'},'No contacts.'));
  }
  draw();
}

/* ---------- ANALYTICS ---------- */
async function viewAnalytics(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Analytics & Comparison')));
  const series=await api('/series');
  // series improvement
  for(const s of series){
    if(!s.events||s.events.length<1)continue;
    const a=await api('/analytics/series/'+s.id);
    const card=h('div',{class:'card',style:'margin-bottom:14px'});
    card.appendChild(h('h2',{style:'font-size:15px'},'📈 '+s.name+' — Improvement Over Years'));
    if(!a.events.length){card.appendChild(h('div',{class:'muted'},'No events.'));v.appendChild(card);continue;}
    const tab=h('table');
    tab.appendChild(h('thead',{},h('tr',{},h('th',{},'Year'),h('th',{},'On-time %'),h('th',{},'Completion %'),h('th',{},'Announcements'),h('th',{},'Lessons'),h('th',{},'Participants'))));
    const tb=h('tbody');
    for(const e of a.events)tb.appendChild(h('tr',{},h('td',{},e.year||'—'),h('td',{},bar(e.onTimePct)),h('td',{},bar(e.completionPct)),h('td',{},e.announcements),h('td',{},e.lessons),h('td',{},e.participants||0)));
    tab.appendChild(tb);card.appendChild(h('div',{class:'table-wrap'},tab));
    if(a.recurringIssues.length){
      card.appendChild(h('h3',{style:'margin-top:12px;color:var(--amber)'},'⚠ Recurring Issues Detected'));
      for(const ri of a.recurringIssues)card.appendChild(h('div',{class:'card',style:'background:var(--surface2);margin-bottom:6px'},ri.detail));
    }
    v.appendChild(card);
  }
  // comparison
  const events=await api('/events');
  const cmp=h('div',{class:'card'});cmp.appendChild(h('h2',{style:'font-size:15px'},'Compare Two Events'));
  const selA=h('select',{},...events.map(e=>h('option',{value:e.id},e.name)));
  const selB=h('select',{},...events.map(e=>h('option',{value:e.id},e.name)));
  if(events[1])selB.value=events[1].id;
  const out=h('div',{style:'margin-top:12px'});
  cmp.appendChild(h('div',{class:'row'},selA,selB,h('button',{class:'btn primary',onclick:async()=>{
    const r=await api('/compare?a='+selA.value+'&b='+selB.value);out.innerHTML='';
    const tab=h('table');tab.appendChild(h('thead',{},h('tr',{},h('th',{},'Metric'),h('th',{},r.a.event.name),h('th',{},r.b.event.name))));
    const tb=h('tbody');
    const metrics=[['Tasks','tasks'],['Completed','tasksCompleted'],['On-time %','onTimePct'],['Milestones','milestones'],['Announcements','announcements'],['Lessons','lessons'],['Participants','participants']];
    for(const[l,k]of metrics)tb.appendChild(h('tr',{},h('td',{},l),h('td',{},String(r.a[k])),h('td',{},String(r.b[k]))));
    tab.appendChild(tb);out.appendChild(h('div',{class:'table-wrap'},tab));
  }},'Compare')));
  cmp.appendChild(out);v.appendChild(cmp);
  function bar(pct){const d=h('div',{style:'display:flex;align-items:center;gap:6px'});d.appendChild(h('div',{class:'progress',style:'width:80px'},h('span',{style:'width:'+pct+'%'})));d.appendChild(h('span',{},pct+'%'));return d;}
}

/* ---------- AUDIT ---------- */
async function viewAudit(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Audit Log')));
  if(!can('Event Manager')){v.appendChild(h('div',{class:'card list-empty'},'Requires Event Manager role.'));return;}
  const logs=await api('/audit?limit=300');
  const wrap=h('div',{class:'card table-wrap'});const t=h('table');
  t.appendChild(h('thead',{},h('tr',{},h('th',{},'When'),h('th',{},'User'),h('th',{},'Action'),h('th',{},'Entity'),h('th',{},'Change'))));
  const tb=h('tbody');
  for(const l of logs)tb.appendChild(h('tr',{},h('td',{},new Date(l.created_at+'Z').toLocaleString()),h('td',{},l.user),h('td',{},h('span',{class:'badge b-blue'},l.action)),h('td',{},l.entity_type+(l.entity_id?' #'+l.entity_id:'')),h('td',{class:'muted',style:'font-size:11px;max-width:280px'},(l.old_value?'was: '+l.old_value.slice(0,60)+' ':'')+(l.new_value?'→ '+l.new_value.slice(0,60):''))));
  t.appendChild(tb);wrap.appendChild(t);v.appendChild(wrap);
}

/* ---------- SETTINGS ---------- */
async function viewSettings(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Settings')));
  // profile
  v.appendChild(h('div',{class:'card',style:'margin-bottom:14px'},h('h2',{style:'font-size:15px'},'Your Account'),
    h('div',{class:'kv'},h('div',{},'Name'),h('div',{},State.user.name),h('div',{},'Email'),h('div',{},State.user.email),h('div',{},'Role'),h('div',{},h('span',{class:'badge b-purple'},State.user.role)))));
  // users management
  if(can('Event Manager')){
    const users=await api('/users');
    const card=h('div',{class:'card',style:'margin-bottom:14px'});card.appendChild(h('h2',{style:'font-size:15px'},'Users & Roles'));
    const t=h('table');t.appendChild(h('thead',{},h('tr',{},h('th',{},'Name'),h('th',{},'Email'),h('th',{},'Role'),h('th',{},''))));
    const tb=h('tbody');
    for(const u of users){
      const roleSel=h('select',{disabled:!can('Administrator'),onchange:async e=>{await api('/users/'+u.id+'/role',{method:'PUT',body:{role:e.target.value}});toast('Role updated','ok');}},...Object.keys(ROLE_LEVEL).map(r=>{const o=h('option',{value:r},r);if(r===u.role)o.selected=true;return o;}));
      tb.appendChild(h('tr',{},h('td',{},u.name),h('td',{},u.email),h('td',{style:'max-width:180px'},roleSel),h('td',{})));
    }
    t.appendChild(tb);card.appendChild(h('div',{class:'table-wrap'},t));v.appendChild(card);
  }
  // categories
  const cats=await api('/categories');
  const ccard=h('div',{class:'card',style:'margin-bottom:14px'});ccard.appendChild(h('h2',{style:'font-size:15px'},'Announcement Categories'));
  const groups={};for(const c of cats)(groups[c.group_name]=groups[c.group_name]||[]).push(c);
  for(const[g,items]of Object.entries(groups)){
    ccard.appendChild(h('h3',{},g));
    ccard.appendChild(h('div',{class:'pill-row'},...items.map(i=>h('span',{class:'pill'},i.name))));
  }
  if(can('Coordinator'))ccard.appendChild(h('form',{style:'display:flex;gap:6px;margin-top:8px',onsubmit:async e=>{e.preventDefault();await api('/categories',{method:'POST',body:{group_name:e.target.g.value||'Custom',name:e.target.n.value}});toast('Category added','ok');viewSettings($('#view'));}},h('input',{name:'g',placeholder:'Group',style:'max-width:140px'}),h('input',{name:'n',placeholder:'New category'}),h('button',{class:'btn sm'},'Add')));
  v.appendChild(ccard);
  // backup
  if(can('Administrator')){
    const bcard=h('div',{class:'card'});
    bcard.appendChild(h('h2',{style:'font-size:15px'},'Backup & Data Safety'));
    bcard.appendChild(h('p',{class:'muted'},'The database is snapshotted automatically on a schedule. You can also take a snapshot now, download any snapshot, or export everything as JSON.'));
    bcard.appendChild(h('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px'},
      h('button',{class:'btn primary',onclick:async()=>{await api('/backups/run',{method:'POST'});toast('Snapshot created','ok');viewSettings($('#view'));}},'📸 Back Up Now'),
      h('a',{class:'btn',href:'#',onclick:async e=>{e.preventDefault();const res=await fetch('/api/backup',{headers:{Authorization:'Bearer '+State.token}});const blob=await res.blob();const url=URL.createObjectURL(blob);const a=h('a',{href:url,download:'eventplaybook-backup.json'});document.body.appendChild(a);a.click();a.remove();}},'⬇ Export All (JSON)')));
    let backups=[];try{backups=await api('/backups');}catch(e){}
    if(backups.length){
      const bt=h('table');bt.appendChild(h('thead',{},h('tr',{},h('th',{},'Snapshot'),h('th',{},'Size'),h('th',{},'Created'),h('th',{},''))));
      const btb=h('tbody');
      for(const b of backups)btb.appendChild(h('tr',{},h('td',{style:'font-size:11px'},b.name),h('td',{},Math.round(b.size/1024)+' KB'),h('td',{},new Date(b.created_at).toLocaleString()),h('td',{},h('a',{class:'btn sm',href:'#',onclick:async e=>{e.preventDefault();const res=await fetch('/api/backups/'+encodeURIComponent(b.name)+'/download',{headers:{Authorization:'Bearer '+State.token}});const blob=await res.blob();const url=URL.createObjectURL(blob);const a=h('a',{href:url,download:b.name});document.body.appendChild(a);a.click();a.remove();}},'⬇ Download'))));
      bt.appendChild(btb);bcard.appendChild(h('div',{class:'table-wrap'},bt));
    } else bcard.appendChild(h('div',{class:'muted'},'No snapshots yet — the first runs shortly after startup.'));
    v.appendChild(bcard);
  }
}

/* ---------- ATTACHMENTS helper ---------- */
async function loadAttachments(entity_type,entity_id,wrap,readOnly=false){
  wrap.innerHTML='';
  const list=await api('/attachments?entity_type='+entity_type+'&entity_id='+entity_id);
  for(const a of list){
    wrap.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)'},
      h('a',{href:'#',onclick:async e=>{e.preventDefault();const res=await fetch('/api/attachments/'+a.id+'/download',{headers:{Authorization:'Bearer '+State.token}});const blob=await res.blob();const url=URL.createObjectURL(blob);const el=h('a',{href:url,download:a.filename});document.body.appendChild(el);el.click();el.remove();}},'📎 '+a.filename),
      h('span',{class:'muted',style:'font-size:11px'},Math.round((a.size||0)/1024)+' KB')));
  }
  if(!list.length)wrap.appendChild(h('div',{class:'muted',style:'font-size:12px'},'No attachments.'));
  if(can('Contributor')&&!readOnly){
    const f=h('input',{type:'file',style:'margin-top:8px',onchange:async e=>{
      const file=e.target.files[0];if(!file)return;
      const fd=new FormData();fd.append('file',file);fd.append('entity_type',entity_type);fd.append('entity_id',entity_id);
      try{await api('/attachments',{method:'POST',body:fd});toast('Uploaded','ok');loadAttachments(entity_type,entity_id,wrap);}catch(err){toast(err.message,'err');}
    }});
    wrap.appendChild(f);
  }
}

/* ================= SHIBIR VIEWS ================= */

/* ---------- PLANNING SETUP ---------- */
async function viewSetup(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'⚑ Planning Setup')));
  if(!needEvent(v))return;
  let d;
  try{ d=await api('/events/'+State.currentEventId+'/shibir-overview'); }catch(e){ v.appendChild(h('div',{class:'card'},e.message)); return; }
  const ev=d.event;
  // progress tracker
  const prog=h('div',{class:'card',style:'margin-bottom:14px'});
  prog.appendChild(h('h3',{},'Planning Progress — '+d.progress+'% complete'));
  prog.appendChild(h('div',{class:'progress',style:'margin-bottom:12px'},h('span',{style:'width:'+d.progress+'%'})));
  const flow=h('div',{class:'tl-flow'});
  d.stages.forEach((s,i)=>{
    flow.appendChild(h('div',{class:'step'+(s.done?'':' past'),style:s.done?'border-color:var(--green)':''},
      (s.done?'✓ ':'○ ')+s.key));
    if(i<d.stages.length-1)flow.appendChild(h('span',{class:'arrow'},'→'));
  });
  prog.appendChild(flow);
  v.appendChild(prog);

  // setup form
  const card=h('div',{class:'card',style:'margin-bottom:14px'});
  card.appendChild(h('h2',{style:'font-size:15px'},'Event Basics'));
  const canEdit=can('Event Manager');
  const form=h('div',{class:'grid cols-2'});
  const fName=setupField('Shibir Name',ev.name);
  const fGuru=setupField('Guru Bhagwant / Presence',ev.guru_bhagwant||'');
  const fRegion=setupField('Region',ev.region||'');
  const fPart=setupField('Expected Participants',ev.expected_participants||'','number');
  const fStart=setupField('Start Date',ev.start_date||'','date');
  const fDur=setupField('Duration (days)',ev.duration_days||'','number');
  form.append(fName.wrap,fGuru.wrap,fRegion.wrap,fPart.wrap,fStart.wrap,fDur.wrap);
  card.appendChild(form);
  card.appendChild(h('div',{class:'muted',style:'font-size:12px;margin:6px 0'},'End date is auto-calculated from start date + duration. Bigger venues are recommended for 5-day events or regions with more participants (e.g. LA 500+, Bay Area up to 500).'));
  if(canEdit)card.appendChild(h('button',{class:'btn primary',onclick:async()=>{
    try{
      await api('/events/'+State.currentEventId,{method:'PUT',body:{name:fName.input.value}});
      await api('/events/'+State.currentEventId+'/setup',{method:'PUT',body:{guru_bhagwant:fGuru.input.value,region:fRegion.input.value,expected_participants:Number(fPart.input.value)||0,start_date:fStart.input.value||null,duration_days:Number(fDur.input.value)||null}});
      toast('Setup saved','ok');await refreshEvents();viewSetup($('#view'));
    }catch(e){toast(e.message,'err');}
  }},'Save Setup'));
  v.appendChild(card);

  // schedule approval
  const sc=h('div',{class:'card'});
  sc.appendChild(h('h2',{style:'font-size:15px'},'Schedule Approval (Vatsalya)'));
  const statusMap={Draft:'b-gray','Submitted to Vatsalya':'b-amber',Approved:'b-green',Rejected:'b-red'};
  sc.appendChild(h('div',{style:'margin-bottom:10px'},'Current status: ',h('span',{class:'badge '+(statusMap[ev.schedule_approval]||'b-gray')},ev.schedule_approval||'Draft'),
    ev.schedule_approved_by?h('span',{class:'muted',style:'margin-left:8px'},'by '+ev.schedule_approved_by):null));
  sc.appendChild(h('p',{class:'muted',style:'font-size:12px'},'Finalize the schedule, submit it to Vatsalya for approval, then an Approver/Vatsalya, Event Manager, or Admin approves it.'));
  const acts=h('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  if(can('Coordinator')&&ev.schedule_approval!=='Submitted to Vatsalya'&&ev.schedule_approval!=='Approved')
    acts.appendChild(h('button',{class:'btn',onclick:async()=>{await api('/events/'+State.currentEventId+'/schedule/submit',{method:'POST'});toast('Submitted to Vatsalya','ok');viewSetup($('#view'));}},'Submit to Vatsalya'));
  const canApprove=['Approver','Event Manager','Administrator'].includes(State.user.role);
  if(canApprove&&ev.schedule_approval!=='Approved'){
    acts.appendChild(h('button',{class:'btn green',onclick:async()=>{await api('/events/'+State.currentEventId+'/schedule/approve',{method:'POST',body:{decision:'approve'}});toast('Schedule approved','ok');viewSetup($('#view'));}},'✓ Approve'));
    acts.appendChild(h('button',{class:'btn danger',onclick:async()=>{await api('/events/'+State.currentEventId+'/schedule/approve',{method:'POST',body:{decision:'reject'}});toast('Schedule rejected','ok');viewSetup($('#view'));}},'✕ Reject'));
  }
  sc.appendChild(acts);
  v.appendChild(sc);
  function setupField(label,val,type){const wrap=h('div',{class:'field'});wrap.appendChild(h('label',{},label));const input=h('input',{type:type||'text',value:val,disabled:!canEdit});wrap.appendChild(input);return {wrap,input};}
}

/* ---------- CORE TEAM ---------- */
async function viewCoreTeam(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'👥 Core Team'),
    can('Coordinator')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ Add Member')));
  if(!needEvent(v))return;
  let members=await api('/events/'+State.currentEventId+'/core-team');
  v.appendChild(h('p',{class:'muted'},'Members selected from different regions who plan the Shibir. Mark the POC (point of contact). Members are then assigned to departments.'));
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!members.length){cont.appendChild(h('div',{class:'card list-empty'},'No core team members yet. Add members from each region.'));return;}
    // group by region
    const byRegion={};for(const m of members)(byRegion[m.region||'No region']=byRegion[m.region||'No region']||[]).push(m);
    for(const[region,list]of Object.entries(byRegion)){
      cont.appendChild(h('div',{class:'section-title'},'📍 '+region,h('span',{class:'badge b-gray'},list.length)));
      const grid=h('div',{class:'grid cols-3'});
      for(const m of list){
        const card=h('div',{class:'card'});
        card.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:start'},
          h('h2',{style:'font-size:15px;margin:0'},m.name),
          m.is_poc?h('span',{class:'badge b-green'},'★ POC'):null));
        if(m.skills)card.appendChild(h('div',{class:'muted',style:'font-size:12px;margin:4px 0'},'Skills: '+m.skills));
        if(m.email)card.appendChild(h('div',{class:'muted',style:'font-size:12px'},'✉ '+m.email));
        if(m.phone)card.appendChild(h('div',{class:'muted',style:'font-size:12px'},'☎ '+m.phone));
        if(can('Coordinator'))card.appendChild(h('div',{style:'margin-top:8px;display:flex;gap:6px'},
          h('button',{class:'btn sm',onclick:()=>openForm(m)},'Edit'),
          h('button',{class:'btn danger sm',onclick:()=>confirmModal('Remove','Remove '+m.name+' from core team?',async()=>{await api('/core-team/'+m.id,{method:'DELETE'});members=await api('/events/'+State.currentEventId+'/core-team');draw();})},'Remove')));
        grid.appendChild(card);
      }
      cont.appendChild(grid);
    }
  }
  draw();
  function openForm(m){
    formModal(m?'Edit Member':'Add Core Team Member',[
      {name:'name',label:'Name'},
      {name:'region',label:'Region',placeholder:'Bay Area / LA / Phoenix …'},
      {name:'email',label:'Email',type:'email'},
      {name:'phone',label:'Phone'},
      {name:'skills',label:'Skills (comma separated)',placeholder:'AV, Registration, Kitchen'},
      {name:'is_poc',label:'This member is the POC (point of contact)',type:'checkbox'},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{
      if(m)await api('/core-team/'+m.id,{method:'PUT',body:data});
      else await api('/events/'+State.currentEventId+'/core-team',{method:'POST',body:data});
      members=await api('/events/'+State.currentEventId+'/core-team');draw();toast('Saved','ok');
    },m||{});
  }
}

/* ---------- DEPARTMENTS ---------- */
async function viewDepartments(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Departments'),
    h('div',{style:'display:flex;gap:8px'},
      can('Event Manager')&&h('button',{class:'btn',onclick:async()=>{await api('/events/'+State.currentEventId+'/departments/seed-defaults',{method:'POST'});toast('Default departments added','ok');viewDepartments($('#view'));}},'+ Add Default Departments'),
      can('Coordinator')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ New Department'))));
  if(!needEvent(v))return;
  let depts=await api('/events/'+State.currentEventId+'/departments');
  let members=await api('/events/'+State.currentEventId+'/core-team');
  v.appendChild(h('p',{class:'muted'},'Each department is handled by assigned core-team members. Click a department to manage its members, tasks, checklists and announcements.'));
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!depts.length){cont.appendChild(h('div',{class:'card list-empty'},'No departments yet. Click "Add Default Departments" to start with AV, Kitchen, Registration, etc.'));return;}
    const grid=h('div',{class:'grid cols-3'});
    for(const d of depts){
      const card=h('div',{class:'card',style:'cursor:pointer',onclick:()=>openDept(d)});
      card.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:start'},
        h('h2',{style:'font-size:15px;margin:0'},d.name),statusBadgeEl(d.status)));
      if(d.description)card.appendChild(h('div',{class:'muted',style:'font-size:12px;margin:4px 0'},d.description));
      card.appendChild(h('div',{style:'font-size:12px;margin-top:6px'},'👤 Lead: '+(d.lead?d.lead.name:'—')));
      card.appendChild(h('div',{style:'font-size:12px'},'👥 '+d.members.length+' members · ☑ '+d.task_done+'/'+d.task_total+' tasks'));
      if(d.members.length)card.appendChild(h('div',{style:'margin-top:6px;display:flex;gap:4px;flex-wrap:wrap'},...d.members.slice(0,5).map(m=>h('span',{class:'badge b-blue',style:'font-size:10px'},m.name))));
      grid.appendChild(card);
    }
    cont.appendChild(grid);
  }
  draw();
  function openForm(d){
    formModal(d?'Edit Department':'New Department',[
      {name:'name',label:'Department Name'},
      {name:'description',label:'Description',type:'textarea'},
      {name:'lead_member_id',label:'Lead (core team member)',type:'select',options:[{value:'',label:'— none —'},...members.map(m=>({value:m.id,label:m.name+(m.region?' ('+m.region+')':'')}))]},
      {name:'status',label:'Status',type:'select',options:['Not Started','In Progress','Blocked','Completed']},
    ],async data=>{
      if(!data.lead_member_id)data.lead_member_id=null;
      if(d)await api('/departments/'+d.id,{method:'PUT',body:data});
      else await api('/events/'+State.currentEventId+'/departments',{method:'POST',body:data});
      depts=await api('/events/'+State.currentEventId+'/departments');draw();toast('Saved','ok');
    },d||{status:'Not Started'});
  }
  async function openDept(d){
    const body=h('div',{});
    // members
    body.appendChild(h('h3',{},'Assigned Members'));
    const mwrap=h('div',{});body.appendChild(mwrap);
    function drawMembers(){
      mwrap.innerHTML='';
      if(!d.members.length)mwrap.appendChild(h('div',{class:'muted'},'No members assigned.'));
      for(const m of d.members){
        mwrap.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)'},
          h('div',{},h('strong',{},m.name),m.region?h('span',{class:'muted'},' · '+m.region):null,m.role_in_dept?h('span',{class:'badge b-blue',style:'margin-left:6px'},m.role_in_dept):null),
          can('Coordinator')&&h('button',{class:'btn danger sm',onclick:async()=>{await api('/department-members/'+m.assign_id,{method:'DELETE'});d.members=d.members.filter(x=>x.assign_id!==m.assign_id);drawMembers();}},'Remove')));
      }
    }
    drawMembers();
    if(can('Coordinator')){
      const unassigned=members.filter(m=>!d.members.find(dm=>dm.id===m.id));
      const sel=h('select',{style:'flex:2'},h('option',{value:''},'— select member —'),...unassigned.map(m=>h('option',{value:m.id},m.name+(m.region?' ('+m.region+')':''))));
      const roleInput=h('input',{placeholder:'Role in dept (optional)',style:'flex:1'});
      body.appendChild(h('div',{style:'display:flex;gap:6px;margin-top:8px'},sel,roleInput,h('button',{class:'btn sm',onclick:async()=>{
        if(!sel.value)return;
        await api('/departments/'+d.id+'/members',{method:'POST',body:{member_id:Number(sel.value),role_in_dept:roleInput.value||null}});
        depts=await api('/events/'+State.currentEventId+'/departments');d=depts.find(x=>x.id===d.id);drawMembers();sel.value='';roleInput.value='';toast('Assigned','ok');
      }},'Assign')));
    }
    // department tasks
    body.appendChild(h('h3',{style:'margin-top:16px'},'Department Tasks'));
    const tasks=(await api('/events/'+State.currentEventId+'/tasks')).filter(t=>t.department_id===d.id);
    const twrap=h('div',{});body.appendChild(twrap);
    if(!tasks.length)twrap.appendChild(h('div',{class:'muted'},'No tasks yet for this department.'));
    for(const t of tasks)twrap.appendChild(h('div',{style:'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)'},h('span',{},t.title),h('span',{},statusBadgeEl(t.status))));
    if(can('Contributor')){
      const ti=h('input',{placeholder:'New task title…',style:'flex:2'});
      const to=h('input',{placeholder:'days from event e.g. -90',type:'number',style:'flex:1'});
      body.appendChild(h('div',{style:'display:flex;gap:6px;margin-top:8px'},ti,to,h('button',{class:'btn sm',onclick:async()=>{
        if(!ti.value)return;
        await api('/events/'+State.currentEventId+'/tasks',{method:'POST',body:{title:ti.value,department_id:d.id,offset_days:Number(to.value)||0,priority:'Medium'}});
        toast('Task added','ok');m.close();openDept(depts.find(x=>x.id===d.id));
      }},'Add Task')));
    }
    const m=modal({title:'Department: '+d.name,size:'lg',body,footer:(f,close)=>{
      if(can('Coordinator'))f.appendChild(h('button',{class:'btn',onclick:()=>{close();openForm(d);}},'Edit Department'));
      f.appendChild(h('button',{class:'btn primary',onclick:close},'Close'));
    }});
  }
}

/* ---------- VENUES ---------- */
async function viewVenues(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'🏛 Venues'),
    can('Coordinator')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ Add Venue')));
  if(!needEvent(v))return;
  const ev=currentEvent();
  let venues=await api('/events/'+State.currentEventId+'/venues');
  v.appendChild(h('p',{class:'muted'},'Compare candidate venues. Pick the right size for the duration and expected participants ('+(ev.expected_participants||'?')+' expected, '+(ev.duration_days||'?')+'-day event). Mark one as Selected.'));
  const cont=h('div',{});v.appendChild(cont);
  function draw(){
    cont.innerHTML='';
    if(!venues.length){cont.appendChild(h('div',{class:'card list-empty'},'No venues added yet.'));return;}
    const grid=h('div',{class:'grid cols-2'});
    for(const vn of venues){
      const card=h('div',{class:'card',style:vn.status==='Selected'?'border-color:var(--green)':''});
      card.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:start'},h('h2',{style:'font-size:15px;margin:0'},vn.name),
        h('span',{class:'badge '+(vn.status==='Selected'?'b-green':'b-gray')},vn.status)));
      card.appendChild(h('div',{class:'muted',style:'font-size:12px;margin:4px 0'},'📍 '+(vn.location||'—')));
      card.appendChild(h('div',{style:'font-size:12px'},'Capacity: '+(vn.capacity||'—')+' · Cost: '+(vn.cost||'—')+' · '+(vn.suitable_days||'—')));
      if(vn.pros)card.appendChild(h('div',{style:'font-size:12px;color:var(--green)'},'+ '+vn.pros));
      if(vn.cons)card.appendChild(h('div',{style:'font-size:12px;color:var(--red)'},'− '+vn.cons));
      if(can('Coordinator'))card.appendChild(h('div',{style:'margin-top:8px;display:flex;gap:6px'},
        vn.status!=='Selected'&&h('button',{class:'btn green sm',onclick:async()=>{await api('/venues/'+vn.id,{method:'PUT',body:{status:'Selected'}});venues=await api('/events/'+State.currentEventId+'/venues');await refreshEvents();draw();toast('Venue selected','ok');}},'✓ Select'),
        h('button',{class:'btn sm',onclick:()=>openForm(vn)},'Edit'),
        h('button',{class:'btn danger sm',onclick:async()=>{await api('/venues/'+vn.id,{method:'DELETE'});venues=await api('/events/'+State.currentEventId+'/venues');draw();}},'Delete')));
      grid.appendChild(card);
    }
    cont.appendChild(grid);
  }
  draw();
  function openForm(vn){
    formModal(vn?'Edit Venue':'Add Venue',[
      {name:'name',label:'Venue Name'},{name:'location',label:'Location'},
      {name:'capacity',label:'Capacity',type:'number'},{name:'cost',label:'Cost'},
      {name:'suitable_days',label:'Suitable for',placeholder:'3-day / 5-day'},
      {name:'contact',label:'Contact'},
      {name:'pros',label:'Pros'},{name:'cons',label:'Cons'},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{if(vn)await api('/venues/'+vn.id,{method:'PUT',body:data});else await api('/events/'+State.currentEventId+'/venues',{method:'POST',body:data});venues=await api('/events/'+State.currentEventId+'/venues');draw();toast('Saved','ok');},vn||{});
  }
}

/* ---------- CATERERS ---------- */
async function viewCaterers(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'🍽 Caterers'),
    can('Coordinator')&&h('button',{class:'btn primary',onclick:()=>openForm()},'+ Add Caterer')));
  if(!needEvent(v))return;
  let caterers=await api('/events/'+State.currentEventId+'/caterers');
  v.appendChild(h('p',{class:'muted'},'Compare caterers on budget, taste and flexibility (rate 1–5). Mark one as Selected once the team decides.'));
  const cont=h('div',{});v.appendChild(cont);
  const stars=n=>'★'.repeat(n||0)+'☆'.repeat(5-(n||0));
  function draw(){
    cont.innerHTML='';
    if(!caterers.length){cont.appendChild(h('div',{class:'card list-empty'},'No caterers added yet.'));return;}
    const wrap=h('div',{class:'card table-wrap'});const t=h('table');
    t.appendChild(h('thead',{},h('tr',{},h('th',{},'Caterer'),h('th',{},'Cuisine'),h('th',{},'Budget'),h('th',{},'Taste'),h('th',{},'Flexibility'),h('th',{},'Cost/person'),h('th',{},'Status'),h('th',{},''))));
    const tb=h('tbody');
    for(const c of caterers){
      tb.appendChild(h('tr',{style:c.status==='Selected'?'background:rgba(47,191,113,.08)':''},
        h('td',{style:'font-weight:600'},c.name),h('td',{},c.cuisine||'—'),
        h('td',{style:'color:var(--amber)'},stars(c.budget_rating)),h('td',{style:'color:var(--amber)'},stars(c.taste_rating)),h('td',{style:'color:var(--amber)'},stars(c.flexibility_rating)),
        h('td',{},c.cost_per_person||'—'),h('td',{html:statusBadge(c.status)}),
        h('td',{},can('Coordinator')&&h('div',{style:'display:flex;gap:4px'},
          c.status!=='Selected'&&h('button',{class:'btn green sm',onclick:async()=>{await api('/caterers/'+c.id,{method:'PUT',body:{status:'Selected'}});caterers=await api('/events/'+State.currentEventId+'/caterers');await refreshEvents();draw();toast('Caterer selected','ok');}},'✓'),
          h('button',{class:'btn sm',onclick:()=>openForm(c)},'Edit'),
          h('button',{class:'btn danger sm',onclick:async()=>{await api('/caterers/'+c.id,{method:'DELETE'});caterers=await api('/events/'+State.currentEventId+'/caterers');draw();}},'✕')))));
    }
    t.appendChild(tb);wrap.appendChild(t);cont.appendChild(wrap);
  }
  draw();
  function openForm(c){
    formModal(c?'Edit Caterer':'Add Caterer',[
      {name:'name',label:'Caterer Name'},{name:'cuisine',label:'Cuisine'},
      {name:'budget_rating',label:'Budget rating (1-5, 5=best value)',type:'number'},
      {name:'taste_rating',label:'Taste rating (1-5)',type:'number'},
      {name:'flexibility_rating',label:'Flexibility rating (1-5)',type:'number'},
      {name:'cost_per_person',label:'Cost per person'},{name:'contact',label:'Contact'},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{for(const k of ['budget_rating','taste_rating','flexibility_rating'])data[k]=Number(data[k])||null;if(c)await api('/caterers/'+c.id,{method:'PUT',body:data});else await api('/events/'+State.currentEventId+'/caterers',{method:'POST',body:data});caterers=await api('/events/'+State.currentEventId+'/caterers');draw();toast('Saved','ok');},c||{});
  }
}

/* ---------- REGISTRATION ---------- */
async function viewRegistration(v){
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'📝 Registration')));
  if(!needEvent(v))return;
  const cfg=await api('/events/'+State.currentEventId+'/registration');
  v.appendChild(h('p',{class:'muted'},'Configure registration: when to open, which regions, paid or unpaid, cost, and refund policy.'));
  const canEdit=can('Coordinator');
  const card=h('div',{class:'card'});
  const grid=h('div',{class:'grid cols-2'});
  const f={};
  const mk=(key,label,type,val)=>{const wrap=h('div',{class:'field'});wrap.appendChild(h('label',{},label));let input;if(type==='select'){input=h('select',{disabled:!canEdit},...['Not Open','Open','Closed','Full'].map(o=>{const op=h('option',{value:o},o);if(o===val)op.selected=true;return op;}));}else if(type==='checkbox'){input=h('input',{type:'checkbox',disabled:!canEdit});if(val)input.checked=true;wrap.appendChild(h('label',{class:'chk'},input,'Paid Shibir'));f[key]=input;grid.appendChild(wrap);return;}else{input=h('input',{type:type||'text',value:val==null?'':val,disabled:!canEdit});}wrap.appendChild(input);f[key]=input;grid.appendChild(wrap);};
  mk('status','Status','select',cfg.status);
  mk('open_date','Open Date','date',cfg.open_date);
  mk('close_date','Close Date','date',cfg.close_date);
  mk('regions','Regions (which regions can register)','text',cfg.regions);
  mk('is_paid','Paid?','checkbox',cfg.is_paid);
  mk('cost_per_person','Cost per person','text',cfg.cost_per_person);
  mk('capacity','Capacity','number',cfg.capacity);
  mk('refund_deadline','Refund deadline','date',cfg.refund_deadline);
  card.appendChild(grid);
  const rp=h('div',{class:'field'});rp.appendChild(h('label',{},'Refund Policy'));const rpi=h('textarea',{rows:2,disabled:!canEdit},cfg.refund_policy||'');rp.appendChild(rpi);f.refund_policy=rpi;card.appendChild(rp);
  const nt=h('div',{class:'field'});nt.appendChild(h('label',{},'Notes'));const nti=h('textarea',{rows:2,disabled:!canEdit},cfg.notes||'');nt.appendChild(nti);f.notes=nti;card.appendChild(nt);
  if(canEdit)card.appendChild(h('button',{class:'btn primary',onclick:async()=>{
    const body={status:f.status.value,open_date:f.open_date.value||null,close_date:f.close_date.value||null,regions:f.regions.value,is_paid:f.is_paid.checked?1:0,cost_per_person:f.cost_per_person.value,capacity:Number(f.capacity.value)||null,refund_deadline:f.refund_deadline.value||null,refund_policy:f.refund_policy.value,notes:f.notes.value};
    await api('/events/'+State.currentEventId+'/registration',{method:'PUT',body});toast('Registration saved','ok');
  }},'Save Registration Settings'));
  v.appendChild(card);
}

/* ---------- boot ---------- */
async function refreshEvents(){ State.events=await api('/events'); if(!State.currentEventId&&State.events.length){State.currentEventId=State.events[0].id;localStorage.setItem('ep_event',State.currentEventId);} }
async function boot(){
  try{
    const me=await api('/auth/me'); State.user=me.user;
    await refreshEvents();
    const hash=location.hash.slice(1); if(hash&&NAV.find(n=>n[0]===hash))State.route=hash;
    renderShell(); renderView();
  }catch(e){ renderAuth(); }
}
window.addEventListener('hashchange',()=>{const hash=location.hash.slice(1);if(hash&&NAV.find(n=>n[0]===hash)&&hash!==State.route){State.route=hash;renderShell();renderView();}});
if(State.token)boot(); else renderAuth();
