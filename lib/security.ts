import { env } from 'cloudflare:workers';
import { getRawDb } from '@/db/raw';
const encoder=new TextEncoder();
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export const safeHeaders={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function json(body:unknown,status=200,extra:Record<string,string>={}){return Response.json(body,{status,headers:{...safeHeaders,...extra}})}
function decode(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function encode(b:ArrayBuffer|Uint8Array){return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unurl(s:string){return decode(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4))}
function secret(name:'SURVEY_SIGNING_KEY'|'VK_ENCRYPTION_KEY'){const value=env[name];if(typeof value!=='string'||decode(value).length!==32)throw new Error('Security configuration unavailable');return decode(value)}
async function sign(value:string){const key=await crypto.subtle.importKey('raw',secret('SURVEY_SIGNING_KEY'),{name:'HMAC',hash:'SHA-256'},false,['sign']);return encode(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))}
export function isLocal(request:Request){return ['localhost','127.0.0.1'].includes(new URL(request.url).hostname)}
export function cookieName(request:Request){return isLocal(request)?'survey_session':'__Host-survey_session'}
export type Session={nonce:string;expires:number};
export async function readSession(request:Request):Promise<Session|null>{
 try{const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(request)+'='))?.split('=')[1];if(!raw||raw.length>512)return null;const [body,sig,...rest]=raw.split('.');if(!body||!sig||rest.length)return null;const key=await crypto.subtle.importKey('raw',secret('SURVEY_SIGNING_KEY'),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,unurl(sig),encoder.encode(body)))return null;const session=JSON.parse(new TextDecoder().decode(unurl(body)));if(typeof session.nonce!=='string'||!/^[a-f0-9-]{36}$/.test(session.nonce)||!Number.isSafeInteger(session.expires)||session.expires<=Date.now())return null;return session}catch{return null}
}
export async function createSession(request:Request){const session={nonce:crypto.randomUUID(),expires:Date.now()+4*3600*1000};const body=encode(encoder.encode(JSON.stringify(session)));return {session,cookie:`${cookieName(request)}=${body}.${await sign(body)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${isLocal(request)?'':'; Secure'}`}}
export async function csrf(session:Session){return sign('csrf:'+session.nonce)}
export function sameOrigin(request:Request,required=false){const origin=request.headers.get('origin');const fetchSite=request.headers.get('sec-fetch-site');if(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')throw new HttpError(403,'Forbidden');if((required&&!origin)||(origin&&origin!==new URL(request.url).origin))throw new HttpError(403,'Forbidden')}
export async function rateLimit(request:Request,scope:'session'|'submit',session?:Session){
 const now=Math.floor(Date.now()/1000);const window=600;const bucket=Math.floor(now/window);
 const ip=isLocal(request)?'local':request.headers.get('cf-connecting-ip');if(!ip)throw new HttpError(503,'Service unavailable');
 const identities=[{key:await sign(`rate:${scope}:${bucket}:${ip}`),limit:scope==='session'?100:60}];
 if(session)identities.push({key:await sign(`rate:session-submit:${bucket}:${session.nonce}`),limit:8});
 const db=getRawDb();const results=await db.batch(identities.map(x=>db.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(x.key,(bucket+2)*window,x.limit)));
 if(results.some(r=>!r.results?.length))throw new HttpError(429,'Too many requests');
 await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
}
export async function boundedJson(request:Request){if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new HttpError(415,'Expected JSON');if(request.headers.get('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new HttpError(415,'Unsupported encoding');const limit=32768;const len=request.headers.get('content-length');if(len&&(!/^\d+$/.test(len)||Number(len)>limit))throw new HttpError(413,'Request too large');const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing body');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HttpError(413,'Request too large')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new HttpError(400,'Invalid JSON')}}
export async function privateProfileId(responseId:string){return sign('vk-link:'+responseId)}
export async function encryptProfile(link:string,profileId:string){const key=await crypto.subtle.importKey('raw',secret('VK_ENCRYPTION_KEY'),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(profileId)},key,encoder.encode(link));return JSON.stringify({v:1,iv:encode(iv),ciphertext:encode(ciphertext)})}
export async function payloadHash(payload:string){return sign('payload:'+payload)}
export function errorResponse(e:unknown){if(e instanceof HttpError)return json({error:e.message},e.status,e.status===429?{'Retry-After':'600'}:{});console.error('Survey service unavailable');return json({error:'Service unavailable. Please retry.'},503)}
