// Данные админки: агрегаты + постраничный список заявок. Только после проверки admin-сессии.
// Ответы отдаются без VK-ссылок (они шифруются отдельно и доступны только через /api/admin/profile).
import {getRawDb} from '@/db/raw';
import surveyData from '@/app/survey.json';
import {readAdminSession,json,errorResponse,HttpError} from '@/lib/security';
import type {Answers,Question} from '@/app/validation';

const sections:{title:string;questions:Question[]}[]=surveyData;
const questions=sections.flatMap(s=>s.questions);

export async function GET(request:Request){try{
 if(!await readAdminSession(request))throw new HttpError(401,'Unauthorized');
 const db=getRawDb();
 const total=(await db.prepare('SELECT COUNT(*) AS c FROM survey_submissions').first<{c:number}>())?.c??0;
 const withVk=(await db.prepare('SELECT COUNT(*) AS c FROM private_profiles').first<{c:number}>())?.c??0;
 const pageParam=new URL(request.url).searchParams.get('page');
 let page=1;
 if(pageParam!==null){if(!/^\d{1,6}$/.test(pageParam)||Number(pageParam)<1)throw new HttpError(400,'Invalid page');page=Number(pageParam)}
 const pageSize=50;
 // LIMIT/OFFSET — константа и валидированное целое после строгой проверки; injection невозможен
 const rows=await db.prepare(`SELECT id, answers, created_at, version FROM survey_submissions ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`).all<{id:string;answers:string;created_at:string;version:number}>();
 const allRows=await db.prepare('SELECT answers FROM survey_submissions').all<{answers:string}>();
 const items=(rows.results??[]).map(r=>{
  let a:Answers={};try{a=JSON.parse(r.answers)}catch{}
  return {id:r.id,createdAt:r.created_at,version:r.version,...Object.fromEntries(questions.map(q=>[q.id,a[q.id]??'']))};
 });
 // распределения ответов по каждому закрытому вопросу (по всей базе)
 const distributions:Record<string,{key:string;count:number}[]>={};
 for(const q of questions){
  if(q.type==='text'||q.type==='url'||q.type==='number')continue;
  const counts=new Map<string,number>();
  for(const r of allRows.results??[]){
   try{const a=JSON.parse(r.answers) as Answers;const v=a[q.id];if(v===undefined||v==='')continue;counts.set(v,(counts.get(v)??0)+1)}catch{}
  }
  distributions[q.id]=[...counts.entries()].map(([key,count])=>({key,count})).sort((x,y)=>y.count-x.count);
 }
 return json({total,withVk,page,pageSize,questions:questions.map(q=>({id:q.id,text:q.text,type:q.type,options:q.options,scale:q.scale,section:sections.findIndex(s=>s.questions.includes(q))})),sections:sections.map(s=>s.title),items,distributions});
}catch(e){return errorResponse(e)}}
