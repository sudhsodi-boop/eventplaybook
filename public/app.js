/* EventPlaybook SPA — vanilla JS */
'use strict';
const State = {
  token: localStorage.getItem('ep_token') || null,
  user: null,
  events: [],
  currentEventId: Number(localStorage.getItem('ep_event')) || null,
  route: 'dashboard',
};
const ROLE_LEVEL = { Viewer:1, Contributor:2, Coordinator:3, 'Event Manager':4, Administrator:5 };
function can(min){ return State.user && (ROLE_LEVEL[State.user.role]||0) >= ROLE_LEVEL[min]; }

/* ---------- API ---------- */
async function api(path, opts={}){
  const headers = opts.headers || {};
  if(!(opts.body instanceof FormData)) headers['Content-Type']='application/json';
  if(State.token) headers['Authorization']='Bearer '+State.token;
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
  ['dashboard','Dashboard','◧'],['events','Events','▦'],['calendar','Calendar','▤'],['timeline','Timeline','▬'],
  ['tasks','Tasks','☑'],['announcements','Announcements','📣'],['communication','Communication Plan','✉'],
  ['checklists','Checklists','✓'],['people','People & Roles','☺'],['lessons','Lessons Learned','◆'],
  ['knowledge','Knowledge Base','⌕'],['templates','Templates','▤'],['reports','Reports','▣'],
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
    analytics:viewAnalytics,audit:viewAudit,settings:viewSettings};
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
  v.appendChild(h('div',{class:'page-head'},h('h1',{},'Tasks'),
    can('Contributor')&&h('button',{class:'btn primary',onclick:()=>openTaskForm()},'+ New Task')));
  if(!needEvent(v))return;
  let tasks=await api('/events/'+State.currentEventId+'/tasks');
  const ev=currentEvent();
  // filters
  let filterStatus='',filterPrio='',q='',viewMode='list';
  const tools=h('div',{class:'tag-tools'});
  const search=h('input',{placeholder:'Search tasks…',style:'max-width:200px',oninput:e=>{q=e.target.value.toLowerCase();draw();}});
  const fs=h('select',{style:'max-width:150px',onchange:e=>{filterStatus=e.target.value;draw();}},...['','Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s||'All Statuses')));
  const fp=h('select',{style:'max-width:130px',onchange:e=>{filterPrio=e.target.value;draw();}},...['','Critical','High','Medium','Low'].map(s=>h('option',{value:s},s||'All Priorities')));
  const vm=h('select',{style:'max-width:130px',onchange:e=>{viewMode=e.target.value;draw();}},...[['list','List'],['kanban','Kanban']].map(([val,l])=>h('option',{value:val},l)));
  tools.append(search,fs,fp,vm);
  v.appendChild(tools);
  const container=h('div',{}); v.appendChild(container);
  const selected=new Set();
  function filtered(){return tasks.filter(t=>(!filterStatus||t.status===filterStatus)&&(!filterPrio||t.priority===filterPrio)&&(!q||(t.title||'').toLowerCase().includes(q)));}
  function draw(){
    container.innerHTML='';
    const list=filtered();
    if(!list.length){container.appendChild(h('div',{class:'card list-empty'},'No tasks match.'));return;}
    if(viewMode==='kanban'){
      const board=h('div',{class:'kanban'});
      for(const st of ['Not Started','In Progress','Blocked','Completed','Cancelled']){
        const col=h('div',{class:'kcol'},h('h4',{},st+' ('+list.filter(t=>t.status===st).length+')'));
        for(const t of list.filter(x=>x.status===st)){
          const pb=h('span',{}); pb.innerHTML=prioBadge(t.priority);
          col.appendChild(h('div',{class:'kcard',style:'cursor:pointer',onclick:()=>openTaskForm(t)},
            h('div',{style:'font-weight:600'},t.title),
            h('div',{style:'margin-top:4px'},h('span',{class:'badge rel'},t.relative),' ',pb.firstChild),
            h('div',{class:'muted',style:'font-size:11px;margin-top:2px'},fmtDate(t.computed_date)+' · '+(t.owner||'—'))));
        }
        board.appendChild(col);
      }
      container.appendChild(board); return;
    }
    // list w/ bulk
    const bulkBar=h('div',{style:'display:flex;gap:8px;align-items:center;margin-bottom:8px'});
    const bulkSel=h('select',{style:'max-width:160px'},...['Not Started','In Progress','Blocked','Completed','Cancelled'].map(s=>h('option',{value:s},s)));
    bulkBar.append(h('span',{class:'muted'},selected.size+' selected'),bulkSel,h('button',{class:'btn sm',disabled:!selected.size||!can('Contributor'),onclick:async()=>{await api('/tasks/bulk-status',{method:'POST',body:{ids:[...selected],status:bulkSel.value}});selected.clear();tasks=await api('/events/'+State.currentEventId+'/tasks');draw();toast('Updated','ok');}},'Apply to selected'));
    container.appendChild(bulkBar);
    const wrap=h('div',{class:'card table-wrap'});
    const table=h('table');
    table.appendChild(h('thead',{},h('tr',{},h('th',{},''),h('th',{},'Task'),h('th',{},'Phase'),h('th',{},'Rel'),h('th',{},'Date'),h('th',{},'Owner'),h('th',{},'Priority'),h('th',{},'Status'),h('th',{},'Keep/Mod/Rem'),h('th',{},''))));
    const tb=h('tbody');
    for(const t of list){
      const cb=h('input',{type:'checkbox',style:'width:auto',onchange:e=>{e.target.checked?selected.add(t.id):selected.delete(t.id);}});
      if(selected.has(t.id))cb.checked=true;
      tb.appendChild(h('tr',{},
        h('td',{},cb),
        h('td',{},h('div',{style:'font-weight:600'},t.title,inheritedTag(t)),t.description?h('div',{class:'muted',style:'font-size:11px'},t.description.slice(0,60)):null),
        h('td',{},h('span',{class:'muted',style:'font-size:11px'},(t.phase||'').replace(/Phase \d+ — /,''))),
        h('td',{},h('span',{class:'badge rel'},t.relative)),
        h('td',{},fmtDate(t.computed_date)),
        h('td',{},t.owner||'—'),
        h('td',{html:prioBadge(t.priority)}),
        h('td',{html:statusBadge(t.status)}),
        h('td',{},can('Contributor')?dispControl('tasks',t,async()=>{tasks=await api('/events/'+State.currentEventId+'/tasks');}):(t.disposition||'—')),
        h('td',{},can('Contributor')&&h('button',{class:'btn sm',onclick:()=>openTaskForm(t)},'Edit'))
      ));
    }
    table.appendChild(tb); wrap.appendChild(table); container.appendChild(wrap);
  }
  draw();
  function openTaskForm(t){
    formModal(t?'Edit Task':'New Task',[
      {name:'title',label:'Title'},{name:'description',label:'Description',type:'textarea'},
      {name:'phase',label:'Phase',type:'select',options:['','Phase 1 — Long-Term Preparation','Phase 2 — Planning','Phase 3 — Final Preparation','Phase 4 — Final Communication','Phase 5 — Final Countdown','Phase 6 — Event Execution','Phase 7 — Immediate Follow-Up','Phase 8 — Retrospective','Phase 9 — Knowledge Capture']},
      {name:'type',label:'Type',type:'select',options:['Task','Milestone','Announcement','Meeting','Deadline','Event Day Activity','Review','Follow-up']},
      {name:'offset_days',label:'Relative timing (days from event, e.g. -30, 0, 7)',type:'number'},
      {name:'date_override',label:'Date override (optional)',type:'date'},
      {name:'owner',label:'Owner'},{name:'assignee',label:'Assignee'},
      {name:'priority',label:'Priority',type:'select',options:['Critical','High','Medium','Low']},
      {name:'status',label:'Status',type:'select',options:['Not Started','In Progress','Blocked','Completed','Cancelled']},
      {name:'notes',label:'Notes',type:'textarea'},
    ],async data=>{
      data.offset_days=Number(data.offset_days)||0;
      if(t)await api('/tasks/'+t.id,{method:'PUT',body:data});
      else await api('/events/'+State.currentEventId+'/tasks',{method:'POST',body:data});
      tasks=await api('/events/'+State.currentEventId+'/tasks');draw();toast('Saved','ok');
    },t||{priority:'Medium',status:'Not Started',type:'Task'});
    if(t&&can('Coordinator')){/* add delete via separate button */ }
  }
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
    v.appendChild(h('div',{class:'card'},h('h2',{style:'font-size:15px'},'Backup & Export'),h('p',{class:'muted'},'Download a full JSON backup of all data (passwords redacted).'),
      h('a',{class:'btn',href:'#',onclick:async e=>{e.preventDefault();const res=await fetch('/api/backup',{headers:{Authorization:'Bearer '+State.token}});const blob=await res.blob();const url=URL.createObjectURL(blob);const a=h('a',{href:url,download:'eventplaybook-backup.json'});document.body.appendChild(a);a.click();a.remove();}},'⬇ Download Backup')));
  }
}

/* ---------- ATTACHMENTS helper ---------- */
async function loadAttachments(entity_type,entity_id,wrap){
  wrap.innerHTML='';
  const list=await api('/attachments?entity_type='+entity_type+'&entity_id='+entity_id);
  for(const a of list){
    wrap.appendChild(h('div',{style:'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--line)'},
      h('a',{href:'#',onclick:async e=>{e.preventDefault();const res=await fetch('/api/attachments/'+a.id+'/download',{headers:{Authorization:'Bearer '+State.token}});const blob=await res.blob();const url=URL.createObjectURL(blob);const el=h('a',{href:url,download:a.filename});document.body.appendChild(el);el.click();el.remove();}},'📎 '+a.filename),
      h('span',{class:'muted',style:'font-size:11px'},Math.round((a.size||0)/1024)+' KB')));
  }
  if(!list.length)wrap.appendChild(h('div',{class:'muted',style:'font-size:12px'},'No attachments.'));
  if(can('Contributor')){
    const f=h('input',{type:'file',style:'margin-top:8px',onchange:async e=>{
      const file=e.target.files[0];if(!file)return;
      const fd=new FormData();fd.append('file',file);fd.append('entity_type',entity_type);fd.append('entity_id',entity_id);
      try{await api('/attachments',{method:'POST',body:fd});toast('Uploaded','ok');loadAttachments(entity_type,entity_id,wrap);}catch(err){toast(err.message,'err');}
    }});
    wrap.appendChild(f);
  }
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
