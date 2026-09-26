// app/api/responses/route.ts — приём ответов анкеты. Антибот/антинакрутка (все проверки серверные):
//  1) HMAC-сессия + CSRF-токен: токен выдаётся только после загрузки страницы.
//  2) x-survey-nonce привязан к CSP-nonce рендера — переиграть запрос из скрипта нельзя.
//  3) Минимальное время сессии (~60 c): мгновенная отправка = автокликер.
//  4) Rate-limit по IP (скользящее окно) + одна отправка на submission id (повтор — 409).
//  5) Жёсткая валидация: белый список ключей payload, UUID v4, диапазон оценок, согласованность согласия.
//  6) VK-ссылка шифруется AES-256-GCM; digest(payload) защищает от подмены повторной отправки.
import {getRawDb} from '@/db/raw';
import surveyData from '@/app/survey.json';
const sections: {title:string;questions:Question[]}[]=surveyData;
import {validAnswer,applicable,type Answers,type Question} from '@/app/validation';
import {sameOrigin,readSession,csrf,rateLimit,boundedJson,privateProfileId,encryptProfile,payloadHash,json,errorResponse,HttpError,apiNonce,sessionAge} from '@/lib/security';
export async function POST(request:Request){try{
 sameOrigin(request,true);const session=await readSession(request);if(!session||request.headers.get('x-survey-csrf')!==await csrf(session))throw new HttpError(403,'Invalid session');
 // Анти-бот 1: apiNonce привязан к CSP-nonce страницы — запрос вне рендера сайта не пройдёт.
 if(request.headers.get('x-survey-nonce')!==await apiNonce(request))throw new HttpError(403,'Invalid session');
 // Анти-бот 2: мгновенная отправка сразу после выдачи сессии — признак автотеста/скрипта.
 // Клиент дополнительно выдерживает локальный таймер (MIN_FILL_MS в app/page.tsx).
 const age=await sessionAge(request);if(age<60)throw new HttpError(429,'Too early');
 await rateLimit(request,'submit',session);
 const data=await boundedJson(request);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['id','answers','vkConsent','questionnaireVersion'].includes(k))||data.questionnaireVersion!==2||typeof data.vkConsent!=='boolean'||typeof data.id!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.id)||!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers))throw new HttpError(400,'Invalid submission');
 const questions=sections.flatMap(s=>s.questions);const keys=new Set(questions.map(q=>q.id));if(Object.keys(data.answers).some(k=>!keys.has(k)))throw new HttpError(400,'Unknown answer');
 const answers:Answers={};for(const q of questions){if(!applicable(q,data.answers)){if(data.answers[q.id])throw new HttpError(400,'Inapplicable answer');continue}const v=data.answers[q.id];if(!validAnswer(q,v))throw new HttpError(400,'Invalid answer');answers[q.id]=typeof v==='string'?v.trim():'';}
 if(data.vkConsent!==(answers.s10q1==='Да'))throw new HttpError(400,'Consent mismatch');
 const profile=answers.s10q2||'';if(profile&&!data.vkConsent)throw new HttpError(400,'Consent required');delete answers.s10q2;delete answers.s10q1;
 const db=getRawDb();const digest=await payloadHash(JSON.stringify({answers,profile,consent:data.vkConsent}));
 const existing=await db.prepare('SELECT payload_hash FROM survey_submissions WHERE id = ?').bind(data.id).first<{payload_hash:string}>();
 if(existing){if(existing.payload_hash!==digest)throw new HttpError(409,'Submission already exists');return json({ok:true},200)}
 const now=new Date().toISOString();const statements=[db.prepare('INSERT INTO survey_submissions (id, answers, payload_hash, created_at, version) VALUES (?, ?, ?, ?, 2)').bind(data.id,JSON.stringify(answers),digest,now)];
 if(profile){const profileId=await privateProfileId(data.id);const encrypted=await encryptProfile(profile,profileId);statements.push(db.prepare('INSERT INTO private_profiles (id, encrypted_profile, consent_version, consent_at) VALUES (?, ?, 1, ?)').bind(profileId,encrypted,now))}
 try{await db.batch(statements)}catch(e){const saved=await db.prepare('SELECT payload_hash FROM survey_submissions WHERE id = ?').bind(data.id).first<{payload_hash:string}>();if(saved?.payload_hash===digest)return json({ok:true},200);if(saved)throw new HttpError(409,'Submission already exists');throw e}
 return json({ok:true},201);
}catch(e){return errorResponse(e)}}
