
function binding(name: string): string | undefined {
  try { return (globalThis as any).process?.env?.[name]; } catch { return undefined; }
}
import { getRawDb } from '@/db/raw';
const encoder=new TextEncoder();
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const safeHeaders={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function json(body:unknown,status=200,extra:Record<string,string>={}){return Response.json(body,{status,headers:{...safeHeaders,...extra}})}
function decode(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function encode(b:ArrayBuffer|Uint8Array){return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unurl(s:string){return decode(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4))}
function secret(name:'SURVEY_SIGNING_KEY'|'VK_ENCRYPTION_KEY'){const value=binding(name);if(typeof value!=='string'||decode(value).length!==32)throw new Error('Security configuration unavailable');return decode(value)}
export async function sign(value:string){const key=await crypto.subtle.importKey('raw',secret('SURVEY_SIGNING_KEY'),{name:'HMAC',hash:'SHA-256'},false,['sign']);return encode(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))}
export function isLocal(request:Request){return ['localhost','127.0.0.1'].includes(new URL(request.url).hostname)}
// Доверенные прокси (например nginx перед контейнером). Задаётся переменной окружения SURVEY_TRUSTED_PROXIES через binding TRUSTED_PROXIES.
// Если переменная не задана — режим "без прокси": заголовки x-forwarded-for игнорируются полностью,
// что исключает обход rate-limit через подделку XFF.
const TRUSTED_PROXIES=(()=>{try{return new Set((binding('TRUSTED_PROXIES')??'').split(',').map((s:string)=>s.trim()).filter(Boolean))}catch{return new Set<string>()}})();
function trustedProxy(request:Request){const xff=request.headers.get('x-forwarded-for');if(!xff)return null;const first=xff.split(',')[0].trim();return TRUSTED_PROXIES.has(first)?first:null}
// Идентификация клиента: сначала cf-connecting-ip (Cloudflare), затем x-real-ip / xff только от доверенного прокси.
// В локальной разработке используется заглушка, чтобы тесты не упирались в лимиты.
export function clientIp(request:Request){return isLocal(request)?'local':request.headers.get('cf-connecting-ip')||trustedProxy(request)||request.headers.get('x-real-ip')||'unknown'}
// Минимальная длительность сессии: защита от мгновенной отправки (бот нажимает «Отправить» за миллисекунды после GET /api/session).
// Возрах сессии по подписанной cookie. Для legacy-сессий (без created) считаем от expires-4ч.
export async function sessionAge(request:Request){const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(request)+'='))?.split('=')[1];if(!raw)return 0;try{const body=raw.split('.')[0];const s=JSON.parse(new TextDecoder().decode(unurl(body)));const t=typeof s.created==='number'?s.created:(typeof s.expires==='number'?s.expires-4*3600*1000:0);return t?Math.max(0,(Date.now()-t)/1000):0}catch{return 0}}
export function cookieName(request:Request){return isLocal(request)?'survey_session':'__Host-survey_session'}
export type Session={nonce:string;created?:number;expires:number};
export async function readSession(request:Request):Promise<Session|null>{
 try{const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(request)+'='))?.split('=')[1];if(!raw||raw.length>512)return null;const [body,sig,...rest]=raw.split('.');if(!body||!sig||rest.length)return null;const key=await crypto.subtle.importKey('raw',secret('SURVEY_SIGNING_KEY'),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,unurl(sig),encoder.encode(body)))return null;const session=JSON.parse(new TextDecoder().decode(unurl(body)));if(typeof session.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(session.nonce)||!Number.isSafeInteger(session.expires)||session.expires<=Date.now())return null;return session}catch{return null}
}
// created — время выдачи сессии (анти-бот: мгновенная отправка сразу после GET /api/session невозможна).
export async function createSession(request:Request){const session={nonce:crypto.randomUUID(),created:Date.now(),expires:Date.now()+4*3600*1000};const body=encode(encoder.encode(JSON.stringify(session)));return {session,cookie:`${cookieName(request)}=${body}.${await sign(body)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${isLocal(request)?'':'; Secure'}`}}
export async function csrf(session:Session){return sign('csrf:'+session.nonce)}
// Анти-бот: apiNonce привязан к nonce CSP (x-nonce выставляется middleware на каждый ответ).
// Бот, скрейпящий HTML и вызывающий fetch() вне страницы, не знает актуальный CSP-nonce и получает 403.
// CSP-nonce читается из запроса (его выставляет middleware), а не из ответа,
// который в момент вызова ещё не создан — иначе привязка к nonce страницы терялась бы.
export async function apiNonce(request:Request){return sign('apinonce:'+(request.headers.get('x-nonce')??''))}
export function sameOrigin(request:Request,required=false){const origin=request.headers.get('origin');const fetchSite=request.headers.get('sec-fetch-site');if(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')throw new HttpError(403,'Forbidden');if((required&&!origin)||(origin&&origin!==new URL(request.url).origin))throw new HttpError(403,'Forbidden')}
export async function rateLimit(request:Request,scope:'session'|'submit',session?:Session){
 const now=Math.floor(Date.now()/1000);const window=600;const bucket=Math.floor(now/window);
 const ip=clientIp(request);
 // 'unknown' означает, что мы не можем достоверно определить IP клиента (нет cf-connecting-ip и нет доверенного прокси).
 // В этом режиме строгий IP-лимит неприменим — полагаемся на session-scoped лимиты, CSRF и минимальный возраст сессии.
 const identities=[{key:await sign(`rate:${scope}:${bucket}:${ip}`),limit:scope==='session'?100:60}];
 if(session)identities.push({key:await sign(`rate:session-submit:${bucket}:${session.nonce}`),limit:2});
 const db=getRawDb();const results=await db.batch(identities.map(x=>db.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(x.key,(bucket+2)*window,x.limit)));
 if(results.some(r=>!r.results?.length))throw new HttpError(429,'Too many requests');
 await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
}
export async function boundedJson(request:Request){if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError(415,'Expected JSON');if(request.headers.get('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new HttpError(415,'Unsupported encoding');const limit=32768;const len=request.headers.get('content-length');if(len&&(!/^\d+$/.test(len)||Number(len)>limit))throw new HttpError(413,'Request too large');const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing body');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HttpError(413,'Request too large')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new HttpError(400,'Invalid JSON')}}
export async function privateProfileId(responseId:string){return sign('vk-link:'+responseId)}
export async function encryptProfile(link:string,profileId:string){const key=await crypto.subtle.importKey('raw',secret('VK_ENCRYPTION_KEY'),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(profileId)},key,encoder.encode(link));return JSON.stringify({v:1,iv:encode(iv),ciphertext:encode(ciphertext)})}
export async function payloadHash(payload:string){return sign('payload:'+payload)}
export function errorResponse(e:unknown){if(e instanceof HttpError)return json({error:e.message},e.status,e.status===429?{'Retry-After':'600'}:{});console.error('Survey service unavailable',e instanceof Error?(e.stack||e.message):String(e));return json({error:'Service unavailable. Please retry.'},503)}

// ---------- Админка ----------
export function adminPassword():string|undefined{const v=binding('ADMIN_PASSWORD');return v&&v.length>=12?v:undefined}
// constant-time сравнение (защита от timing-атак на пароль админки)
export function timingSafeEqualStr(a:string,b:string){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
export function adminCookieName(request:Request){return isLocal(request)?'admin_session':'__Host-admin_session'}
// Токен сессии админки — случайные 32 байта; в БД храним только HMAC(token), чтобы дамп БД не давал доступа.
export async function createAdminSession(){const token=encode(crypto.getRandomValues(new Uint8Array(32)));return {token,hash:await sign('admin:'+token)}}
export async function adminTokenHash(token:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;return sign('admin:'+token)}
export async function readAdminSession(request:Request){
 const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(adminCookieName(request)+'='))?.split('=')[1];
 if(!raw||raw.length>64)return null;const hash=await adminTokenHash(raw);if(!hash)return null;
 const db=getRawDb();const row=await db.prepare('SELECT expires_at FROM admin_sessions WHERE token = ?').bind(hash).first<{expires_at:number}>();
 if(!row||row.expires_at*1000<=Date.now())return null;
 await db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET expires_at = ?').bind(hash,row.expires_at,row.expires_at).run();
 return {token:raw};
}
export async function setAdminCookie(request:Request,token:string){return `${adminCookieName(request)}=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=28800${isLocal(request)?'':'; Secure'}`}
export async function destroyAdminSession(request:Request){const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(adminCookieName(request)+'='))?.split('=')[1];const hash=raw?await adminTokenHash(raw):null;if(hash)await getRawDb().prepare('DELETE FROM admin_sessions WHERE token = ?').bind(hash).run()}
// Расшифровка VK-профиля (AES-256-GCM, AAD = profileId). Используется только из admin API после проверки сессии.
export async function decryptProfile(blob:string,profileId:string){const {iv,ciphertext}=JSON.parse(blob);const key=await crypto.subtle.importKey('raw',secret('VK_ENCRYPTION_KEY'),'AES-GCM',false,['decrypt']);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unurl(iv),additionalData:encoder.encode(profileId)},key,unurl(ciphertext));return new TextDecoder().decode(plain)}
