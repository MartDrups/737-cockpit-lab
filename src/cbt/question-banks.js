'use strict';
(() => {
 const storageKey=id=>'737-cbt-course-'+id;
 const question=topic=>topic.status==='ready'&&topic.sourceMode==='test';
 function bank(course,group){
  if(typeof group==='string')group=course.groups.find(g=>g.id===group);
  if(!group)return null;
  const parts=group.topics.map(id=>course.topics.find(t=>t.id===id)).filter(t=>t&&question(t));
  if(!parts.length)return null;
  return {id:'quiz-'+group.id,group:group.id,title:'Проверка знаний: '+group.title,
   status:'ready',player:'course',questionBank:true,parts:parts.map(t=>t.id),
   questionCount:parts.length,sceneCount:parts.reduce((n,t)=>n+t.sceneCount,0),
   searchText:parts.map(t=>t.title).join(' ')};
 }
 function find(course,id){
  return id?.startsWith('quiz-')?bank(course,id.slice(5)):course.topics.find(t=>t.id===id);
 }
 function entries(course,group){
  const combined=bank(course,group),result=[];let inserted=false;
  for(const id of group.topics){
   const topic=course.topics.find(t=>t.id===id);
   if(question(topic)){
    if(!inserted){result.push(combined);inserted=true}
   }else result.push(topic);
  }
  return result;
 }
 function parts(course,item){return item.questionBank?item.parts.map(id=>find(course,id)):[item]}
 function progress(item,read){
  const own=read(storageKey(item.id));
  if(own||!item.questionBank)return own;
  const previous=item.parts.map(id=>read(storageKey(id)));
  return {finished:previous.every(p=>p?.finished),started:previous.some(p=>p&&(p.index||p.visited?.length||p.finished))};
 }
 function compose(item,lessons){
  if(item.parts.length!==lessons.length)throw new Error('Не все вопросы загружены.');
  const scenes=[],sections=[],glossary=[],known=new Set();
  lessons.forEach((lesson,number)=>{
   const topicId=item.parts[number],prefix=topicId+'::';
   lesson.scenes.forEach((scene,offset)=>scenes.push({...scene,id:prefix+scene.id,
    sourceStateScope:offset===0?'independent-root':scene.sourceStateScope,
    bankQuestion:{id:topicId,number:number+1,total:lessons.length,sourceScene:scene.id,
     screen:offset+1,screens:lesson.scenes.length,variant:scene.sourceVariant||null}}));
   (lesson.sections||[]).forEach(section=>sections.push({...section,first:prefix+section.first,
    title:'Вопрос '+(number+1)+' · '+section.title}));
   (lesson.glossary||[]).forEach(entry=>{
    const key=entry.name+'\n'+entry.definition;
    if(!known.has(key)){known.add(key);glossary.push(entry)}
   });
  });
  return {id:item.id,title:item.title,sourceMode:'test',training:true,questionBank:true,
   scenes,sections,glossary,nativeExamOrSimulationImplemented:false};
 }
 function restore(item,lesson,read){
  const existing=read(storageKey(item.id));
  if(existing)return existing;
  const allowed=new Set(lesson.scenes.map(s=>s.id)),visited=[],completed=[],comments={};
  const old=new Map(item.parts.map(id=>[id,read(storageKey(id))||{}]));
  for(const [id,saved] of old){
   for(const scene of saved.visited||[])if(allowed.has(id+'::'+scene))visited.push(id+'::'+scene);
   for(const scene of saved.completed||[])if(allowed.has(id+'::'+scene))completed.push(id+'::'+scene);
   for(const [scene,text] of Object.entries(saved.comments||{}))if(allowed.has(id+'::'+scene))comments[id+'::'+scene]=text;
  }
  const current=item.parts.find(id=>!old.get(id).finished)||item.parts.at(-1);
  const saved=old.get(current),start=lesson.scenes.findIndex(s=>s.bankQuestion.id===current);
  const length=lesson.scenes.filter(s=>s.bankQuestion.id===current).length;
  const finished=lesson.scenes.every(s=>visited.includes(s.id)&&(!s.exercise?.supported||completed.includes(s.id)));
  return {index:start+Math.min(Math.max(0,saved.index||0),length-1),visited,completed,comments,
   settings:saved.settings||[...old.values()].find(p=>p.settings)?.settings||{},
   movies:saved.movies||{},finished};
 }
 window.CBTQuestionBanks={bank,find,entries,parts,progress,compose,restore,storageKey};
})();
