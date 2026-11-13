'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..'),values=new Map();
const context={window:{},sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
vm.createContext(context);
for(const file of ['question-banks.js','course-navigation.js'])vm.runInContext(fs.readFileSync(path.join(root,'src/cbt',file),'utf8'),context);
vm.runInContext(zlib.gunzipSync(fs.readFileSync(path.join(root,'public/cbt-course-data.js.gz'))).toString(),context);
const {CBT_COURSE:course,CBTQuestionBanks:banks,CBTNavigation:nav}=context.window;
let items=0,banksChecked=0;
for(const group of course.groups){
 const entries=banks.entries(course,group).filter(t=>t?.status==='ready');
 entries.forEach((item,i)=>{
  const state=nav.state(course,item.id);assert(state);assert.equal(state.groupId,group.id);
  assert.equal(state.index,i+1);assert.equal(state.total,entries.length);
  assert.equal(state.previous?.id,entries[i-1]?.id);assert.equal(state.next?.id,entries[i+1]?.id);
  if(item.questionBank){
   banksChecked++;
   for(const id of item.parts){const legacy=nav.state(course,id);assert.equal(legacy.index,state.index);assert.equal(legacy.next?.id,state.next?.id)}
  }
  items++;
 });
}
assert.equal(banksChecked,54);assert.equal(nav.state(course,'fo1d01i'),null);assert.equal(nav.state(course,'does-not-exist'),null);
nav.handoff('next',{audio:false,text:false,speed:'fast',index:888,finished:true});
assert.equal(JSON.stringify(nav.takeSettings('other')),'{}');
assert.equal(JSON.stringify(nav.takeSettings('next')),JSON.stringify({audio:false,text:false,speed:'fast'}));
assert.equal(JSON.stringify(nav.takeSettings('next')),'{}');
nav.handoff('next',{audio:'false',text:4,speed:'1000'});assert.equal(JSON.stringify(nav.takeSettings('next')),'{}');
assert.equal(nav.playerURL('intro',true),'cbt/player.html?autostart=1');
assert.equal(nav.playerURL('quiz-24101',true),'cbt/course-player.html?lesson=quiz-24101&autostart=1');
console.log(JSON.stringify({groups:course.groups.length,availableEntries:items,questionBanks:banksChecked,groupBoundaries:true,missingLessonSkipped:true,settingsOnlyHandoff:true}));
