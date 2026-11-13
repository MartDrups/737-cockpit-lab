'use strict';
(() => {
 function state(course,id){
  const banks=window.CBTQuestionBanks,item=banks?.find(course,id);
  const group=course?.groups.find(g=>g.id===item?.group||g.topics.includes(id));
  if(!group||!item)return null;
  const entries=banks.entries(course,group).filter(t=>t?.status==='ready');
  const index=entries.findIndex(t=>t.id===id||t.questionBank&&t.parts.includes(id));
  if(index<0)return null;
  const brief=t=>t?{id:t.id,title:t.title}:null;
  return {currentId:id,groupId:group.id,groupTitle:group.title,index:index+1,total:entries.length,
   previous:brief(entries[index-1]),next:brief(entries[index+1])};
 }
 function settings(value){
  const result={};
  if(typeof value?.audio==='boolean')result.audio=value.audio;
  if(typeof value?.text==='boolean')result.text=value.text;
  if(['normal','slow','fast'].includes(value?.speed))result.speed=value.speed;
  return result;
 }
 function handoff(id,value){
  try{sessionStorage.setItem('737-cbt-navigation',JSON.stringify({id,settings:settings(value)}))}catch{}
 }
 function takeSettings(id){
  try{
   const value=JSON.parse(sessionStorage.getItem('737-cbt-navigation')||'null');
   if(value?.id!==id)return {};
   sessionStorage.removeItem('737-cbt-navigation');return settings(value.settings);
  }catch{return {}}
 }
 function playerURL(id,autostart=false){
  const path=id==='intro'?'cbt/player.html':'cbt/course-player.html?lesson='+encodeURIComponent(id);
  return path+(autostart?(path.includes('?')?'&':'?')+'autostart=1':'');
 }
 window.CBTNavigation={state,handoff,takeSettings,playerURL};
})();
