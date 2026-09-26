// CSV-экспорт всех заявок (без VK-ссылок). Экранирование кавычек — защита от CSV injection.
import {getRawDb} from '@/db/raw';
import surveyData from '@/app/survey.json';
import {readAdminSession,json,errorResponse,HttpError,boundedJson} from '@/lib/security';
import type {Answers,Question} from '@/app/validation';

const sections:{title:string;questions:Question[]}[]=surveyData;
const questions=sections.flatMap(s=>s.questions);
function cell(v:unknown){const s=String(v??'');return /^[\t\r\n]*[=+\-@]/.test(s)?`'${s}`:s} // formula-injection guard
function csvEscape(v:unknown){return `"${cell(v).replace(/"/g,'""')}"`}

export async function POST(request:Request){try{
 if(!await readAdminSession(request))throw new HttpError(401,'Unauthorized');
 const data=await boundedJson(request).catch(()=>({}));
 if(data&&typeof data==='object'&&Object.keys(data).length)throw new HttpError(400,'Invalid request');
 const db=getRawDb();
 const rows=await db.prepare('SELECT id, answers, created_at, version FROM survey_submissions ORDER BY created_at').all<{id:string;answers:string;created_at:string;version:number}>();
 const lines=['id;created_at;version;'+questions.map(q=>csvEscape(`${q.id} — ${q.text.replace(/"/g,'')}`)).join(';')];
 for(const r of rows.results??[]){
  let a:Answers={};try{a=JSON.parse(r.answers)}catch{}
  lines.push([csvEscape(r.id),csvEscape(r.created_at),csvEscape(r.version),...questions.map(q=>csvEscape(a[q.id]??''))].join(';'));
 }
 console.log(JSON.stringify({event:'admin_export',rows:(rows.results??[]).length}));
 return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="trajectory-responses.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(e){return errorResponse(e)}}
export async function GET(){return json({error:'Use POST'},405)}
