#!/bin/bash
# End-to-end acceptance test against running server
set -e
B=http://localhost:3000/api
PASS=0; FAIL=0
chk(){ if [ "$1" == "$2" ]; then echo "  ✓ $3"; PASS=$((PASS+1)); else echo "  ✗ $3 (expected '$2' got '$1')"; FAIL=$((FAIL+1)); fi; }
j(){ node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const k=process.argv[1].split('.');let v=o;for(const p of k)v=v==null?undefined:v[p];console.log(v==null?'':(typeof v==='object'?JSON.stringify(v):v));}catch(e){console.log('PARSE_ERR')}})" "$1"; }

echo "== Auth =="
ADMIN=$(curl -s $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"password"}')
AT=$(echo "$ADMIN" | j token); chk "$([ -n "$AT" ] && echo ok)" "ok" "Admin login"
MT=$(curl -s $B/auth/login -H 'Content-Type: application/json' -d '{"email":"manager@example.com","password":"password"}' | j token)
CT=$(curl -s $B/auth/login -H 'Content-Type: application/json' -d '{"email":"contrib@example.com","password":"password"}' | j token)
VT=$(curl -s $B/auth/login -H 'Content-Type: application/json' -d '{"email":"viewer@example.com","password":"password"}' | j token)
BADLOGIN=$(curl -s -o /dev/null -w "%{http_code}" $B/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"wrong"}')
chk "$BADLOGIN" "401" "Bad password rejected (401)"

AUTHM="-H Authorization:Bearer $MT"
AUTHC="-H Authorization:Bearer $CT"
AUTHV="-H Authorization:Bearer $VT"
AUTHA="-H Authorization:Bearer $AT"

echo "== Test 1-6: create event & children =="
EV=$(curl -s $B/events -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"name":"Test Gala 2030","event_type":"Gala","start_date":"2030-07-25","end_date":"2030-07-26","location":"Test Hall","create_series":true}')
EID=$(echo "$EV" | j id); chk "$([ -n "$EID" ] && echo ok)" "ok" "T1 Create event (id=$EID)"
chk "$(echo "$EV" | j event_year)" "2030" "T2 Event year derived from date"
MS=$(curl -s $B/events/$EID/milestones -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"name":"Registration opens","offset_days":-60}')
chk "$(echo "$MS" | j relative)" "T-60" "T4 Milestone relative label"
chk "$(echo "$MS" | j computed_date)" "2030-05-26" "T15a Milestone date recalculated (-60 => 2030-05-26)"
TK=$(curl -s $B/events/$EID/tasks -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Book venue","offset_days":-120,"priority":"High"}')
TID=$(echo "$TK" | j id); chk "$(echo "$TK" | j computed_date)" "2030-03-27" "T5 Task date (-120 => 2030-03-27)"
AN=$(curl -s $B/events/$EID/announcements -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Save the Date","offset_days":-120,"message":"Save the date!"}')
AID=$(echo "$AN" | j id); chk "$(echo "$AN" | j version)" "1" "T6 Announcement created v1"

echo "== Test 7: announcement version =="
curl -s -X PUT $B/announcements/$AID -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"message":"Save the date! Updated details.","change_reason":"clarify"}' >/dev/null
AV=$(curl -s $B/announcements/$AID -H "Authorization: Bearer $MT")
chk "$(echo "$AV" | j version)" "2" "T7 Version bumped to 2 on content change"
VC=$(echo "$AV" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).versions.length)})")
chk "$VC" "2" "T7 Two versions stored"

echo "== Test 8: checklist =="
CL=$(curl -s $B/checklists -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d "{\"event_id\":$EID,\"name\":\"Pre-Event\",\"items\":[\"Venue confirmed\",\"AV tested\"]}")
CLID=$(echo "$CL" | j id); ITEMID=$(echo "$CL" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).items[0].id))")
chk "$([ -n "$CLID" ] && echo ok)" "ok" "T8 Checklist created"

echo "== Test 9: complete task =="
curl -s -X PUT $B/tasks/$TID -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"status":"Completed"}' >/dev/null
TS=$(curl -s $B/events/$EID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).find(x=>x.id==$TID);console.log(t.status+'|'+(t.completion_date?'dated':'nodate'))})")
chk "$TS" "Completed|dated" "T9 Task completed with completion_date set"

echo "== Task hierarchy, checklist, comments, dependencies, and attachments =="
PARENT=$(curl -s $B/events/$EID/tasks -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Acceptance task parent","offset_days":-21,"priority":"High"}')
PID=$(echo "$PARENT" | j id); chk "$([ -n "$PID" ] && echo ok)" "ok" "Create parent task"
CHILD=$(curl -s -X POST $B/tasks/$PID/subtasks -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Acceptance subtask","offset_days":-14}')
CID=$(echo "$CHILD" | j id); chk "$(echo "$CHILD" | j parent_task_id)" "$PID" "Create subtask linked to parent"
GRAND=$(curl -s -X POST $B/tasks/$CID/subtasks -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Acceptance nested subtask","offset_days":-7}')
GID=$(echo "$GRAND" | j id); chk "$(echo "$GRAND" | j parent_task_id)" "$CID" "Create nested subtask"
CYCLE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT $B/tasks/$PID -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d "{\"parent_task_id\":$GID}")
chk "$CYCLE" "400" "Reject cyclic task hierarchy"
DETAIL=$(curl -s $B/tasks/$PID/detail -H "Authorization: Bearer $MT")
DCHILD=$(echo "$DETAIL" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).subtasks.length))")
chk "$DCHILD" "1" "Task detail returns child subtasks"
CI=$(curl -s $B/tasks/$PID/checklist-items -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"text":"Acceptance checklist item"}')
CIID=$(echo "$CI" | j id); chk "$([ -n "$CIID" ] && echo ok)" "ok" "Add task checklist item"
CIDONE=$(curl -s -X PUT $B/task-checklist-items/$CIID -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"done":true}' | j done)
chk "$CIDONE" "1" "Complete task checklist item"
COMMENT=$(curl -s -X POST $B/tasks/$PID/comments -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"body":"Acceptance discussion entry"}' | j body)
chk "$COMMENT" "Acceptance discussion entry" "Post append-only task comment"
PRE=$(curl -s $B/events/$EID/tasks -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"title":"Acceptance prerequisite"}')
PREID=$(echo "$PRE" | j id)
DEP=$(curl -s -X PUT $B/tasks/$PID/dependencies -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d "{\"depends_on\":[$PREID]}")
chk "$(echo "$DEP" | j ok)" "true" "Save task dependency"
DEPCYCLE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT $B/tasks/$PREID/dependencies -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d "{\"depends_on\":[$PID]}")
chk "$DEPCYCLE" "400" "Reject dependency cycle"
DELETEP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE $B/tasks/$PID -H "Authorization: Bearer $MT")
chk "$DELETEP" "409" "Prevent deleting a task that still has subtasks"
printf 'Attachment from task workflow integration test\n' >/tmp/eventplaybook-task-test.txt
ATT=$(curl -s -X POST $B/attachments -H "Authorization: Bearer $MT" -F entity_type=task -F entity_id=$PID -F file=@/tmp/eventplaybook-task-test.txt)
ATTID=$(echo "$ATT" | j id); chk "$([ -n "$ATTID" ] && echo ok)" "ok" "Upload a task attachment"
ATTDL=$(curl -s $B/attachments/$ATTID/download -H "Authorization: Bearer $MT" | grep -c 'Attachment from task workflow integration test' || true)
chk "$ATTDL" "1" "Download task attachment"
rm -f /tmp/eventplaybook-task-test.txt

echo "== Test 10: event day mode API =="
ED=$(curl -s "$B/events/$EID/eventday?date=2030-07-25" -H "Authorization: Bearer $MT")
chk "$(echo "$ED" | j eventDayNum)" "1" "T10 Event Day number = 1 on start date"

echo "== Test 11-13: complete event, auto retro, lessons =="
curl -s -X PUT $B/events/$EID -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"status":"Completed"}' >/dev/null
RC=$(curl -s $B/events/$EID/retrospective -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))" 2>/dev/null || echo 0)
chk "$([ "$RC" -gt 0 ] && echo ok)" "ok" "T11/12 Auto retrospective created on completion ($RC items)"
LC=$(curl -s $B/events/$EID/lessons -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
chk "$([ "$LC" -ge 0 ] && echo ok)" "ok" "T13 Lessons endpoint works ($LC AI lessons)"
curl -s $B/events/$EID/lessons -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"description":"Manual lesson","category":"Planning","action_next":"Do X earlier","disposition":"MODIFY"}' >/dev/null

echo "== Test 14-18: clone from previous =="
# mark a milestone REMOVE first
curl -s -X PUT $B/milestones/$(echo "$MS" | j id) -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"disposition":"REMOVE"}' >/dev/null
CLONE=$(curl -s $B/events/$EID/clone -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"start_date":"2031-07-25","copy":{"milestones":true,"tasks":true,"announcements":true}}')
NID=$(echo "$CLONE" | j id); chk "$([ -n "$NID" ] && echo ok)" "ok" "T14 Cloned event created (id=$NID)"
chk "$(echo "$CLONE" | j previous_event_id)" "$EID" "T14 Clone links to previous event"
TASK_TREE=$(curl -s $B/events/$NID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d),p=a.find(x=>x.title==='Acceptance task parent'),c=a.find(x=>x.title==='Acceptance subtask'),g=a.find(x=>x.title==='Acceptance nested subtask');console.log(p&&c&&g&&Number(c.parent_task_id)===Number(p.id)&&Number(g.parent_task_id)===Number(c.id)?'ok':'bad')})")
chk "$TASK_TREE" "ok" "Clone preserves nested task parent links"
CLONED_PARENT_ID=$(curl -s $B/events/$NID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).find(x=>x.title==='Acceptance task parent').id))")
CLONED_DETAIL=$(curl -s $B/tasks/$CLONED_PARENT_ID/detail -H "Authorization: Bearer $MT")
CLONED_CHECKLIST=$(echo "$CLONED_DETAIL" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d);console.log(x.checklist.length+':'+(x.checklist[0]?.done||0)+':'+x.comments.length+':'+x.dependencies.length)})")
chk "$CLONED_CHECKLIST" "1:0:0:1" "Clone copies checklist structure, resets checks, leaves comments behind, and maps dependencies"
CLONED_ATTS=$(curl -s "$B/attachments?entity_type=task&entity_id=$CLONED_PARENT_ID" -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
SOURCE_ATTS=$(curl -s "$B/attachments?entity_type=task&entity_id=$PID" -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
SOURCE_COMMENTS=$(curl -s $B/tasks/$PID/detail -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).comments.length))")
chk "$CLONED_ATTS:$SOURCE_ATTS:$SOURCE_COMMENTS" "0:1:1" "Clone does not copy attachments or comments and leaves prior-event history intact"
NT=$(curl -s $B/events/$NID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).find(x=>x.title=='Book venue');console.log(t?t.computed_date:'none')})")
chk "$NT" "2031-03-27" "T15 Cloned task date recalculated to 2031"
NM=$(curl -s $B/events/$NID/milestones -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).filter(x=>x.name=='Registration opens').length))")
chk "$NM" "0" "T16 REMOVE-marked milestone NOT copied"
NLT=$(curl -s $B/events/$NID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).filter(x=>x.title.includes('From lessons')).length))")
chk "$([ "$NLT" -ge 1 ] && echo ok)" "ok" "T16 Lesson next-action added as task ($NLT)"
# old event unchanged
OLDT=$(curl -s $B/events/$EID/tasks -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).find(x=>x.title=='Book venue');console.log(t.computed_date)})")
chk "$OLDT" "2030-03-27" "T17 Original event dates unchanged"
OLDV=$(curl -s $B/announcements/$AID -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).versions.length))")
chk "$OLDV" "2" "T18 Original announcement history intact (2 versions)"

echo "== Test 19: search =="
SR=$(curl -s "$B/search?q=Save%20the%20Date" -H "Authorization: Bearer $MT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
chk "$([ "$SR" -ge 1 ] && echo ok)" "ok" "T19 Search finds announcement ($SR results)"

echo "== Test 20: reports =="
RP=$(curl -s $B/events/$EID/report/summary -H "Authorization: Bearer $MT" | j event.name)
chk "$RP" "Test Gala 2030" "T20 Summary report"
CSV=$(curl -s $B/events/$EID/export/tasks.csv -H "Authorization: Bearer $MT" | head -1)
chk "$(echo "$CSV" | grep -c title)" "1" "T20 CSV export has header"
PB=$(curl -s $B/events/$EID/report/playbook -H "Authorization: Bearer $MT" | j event.name)
chk "$PB" "Test Gala 2030" "T20 Playbook report"

echo "== Test 21: permissions (RBAC) =="
VCODE=$(curl -s -o /dev/null -w "%{http_code}" $B/events -H "Authorization: Bearer $VT" -H 'Content-Type: application/json' -d '{"name":"Viewer should fail"}')
chk "$VCODE" "403" "T21 Viewer cannot create event (403)"
CCODE=$(curl -s -o /dev/null -w "%{http_code}" $B/events -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"name":"Contributor should fail"}')
chk "$CCODE" "403" "T21 Contributor cannot create event (403)"
CTASK=$(curl -s -o /dev/null -w "%{http_code}" $B/events/$EID/tasks -H "Authorization: Bearer $CT" -H 'Content-Type: application/json' -d '{"title":"Contributor task ok"}')
chk "$CTASK" "200" "T21 Contributor CAN create task (200)"
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" $B/events)
chk "$NOAUTH" "401" "T21 No token => 401"
ROLECODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT $B/users/5/role -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"role":"Administrator"}')
chk "$ROLECODE" "403" "T21 Manager cannot change roles (admin only)"

echo "== Test 22: validation / errors =="
BADEV=$(curl -s -o /dev/null -w "%{http_code}" $B/events -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"start_date":"not-a-date"}')
chk "$BADEV" "400" "T22 Invalid date rejected (400)"
NF=$(curl -s -o /dev/null -w "%{http_code}" $B/events/99999 -H "Authorization: Bearer $MT")
chk "$NF" "404" "T22 Missing event => 404"

echo "== Test: locked events immutable =="
curl -s $B/events/$EID/lock -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"locked":true}' >/dev/null
LOCKED=$(curl -s -o /dev/null -w "%{http_code}" -X PUT $B/events/$EID -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' -d '{"notes":"try edit"}')
chk "$LOCKED" "409" "Locked event edit blocked (409)"
curl -s $B/events/$EID/lock -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"locked":false}' >/dev/null

echo "== Test 23: startup / key APIs =="
for ep in "dashboard/1" "events" "series" "categories" "notifications" "templates" "analytics/series/1"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" $B/$ep -H "Authorization: Bearer $MT")
  chk "$code" "200" "T23 GET /$ep"
done
AUDIT=$(curl -s -o /dev/null -w "%{http_code}" $B/audit -H "Authorization: Bearer $MT")
chk "$AUDIT" "200" "T23 Audit log accessible to Manager"

echo ""
echo "===================="
echo "PASS=$PASS FAIL=$FAIL"
echo "===================="
[ "$FAIL" -eq 0 ]
