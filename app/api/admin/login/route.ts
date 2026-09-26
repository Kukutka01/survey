// Логин админки. Защита от брутфорса: HMAC-скользящий лимит 5 попыток / 10 минут на IP,
// сравнение пароля за constant-time, сессия — случайный токен (в БД только его HMAC).
import {getRawDb} from '@/db/raw';
import {sameOrigin,boundedJson,json,errorResponse,HttpError,adminPassword,timingSafeEqualStr,createAdminSession,setAdminCookie,sign,clientIp,isLocal} from '@/lib/security';

async function loginLimit(request:Request){
 const now=Math.floor(Date.now()/1000);const window=600;const bucket=Math.floor(now/window);
 const key=await sign(`rate:admin-login:${bucket}:${clientIp(request)}`);
 const db=getRawDb();
 const r=await db.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < 5 RETURNING count').bind(key,(bucket+2)*window).first<{count:number}>();
 await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
 if(!r)throw new HttpError(429,'Слишком много попыток. Подождите 10 минут.');
}

export async function POST(request:Request){try{
 sameOrigin(request,true);await loginLimit(request);
 const data=await boundedJson(request);
 if(!data||typeof data!=='object'||Object.keys(data).some(k=>k!=='password')||typeof data.password!=='string'||data.password.length>200)throw new HttpError(400,'Invalid request');
 const expected=adminPassword();
 if(!expected)throw new HttpError(503,'Админка отключена: ADMIN_PASSWORD не задан');
 const ok=timingSafeEqualStr(data.password,expected);
 if(!ok)throw new HttpError(401,'Неверный пароль');
 const {token,hash}=await createAdminSession();
 const db=getRawDb();
 await db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(Math.floor(Date.now()/1000)).run();
 await db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').bind(hash,Math.floor(Date.now()/1000)+28800).run();
 console.log(JSON.stringify({event:'admin_login_ok',local:isLocal(request)}));
 return json({ok:true},200,{'Set-Cookie':await setAdminCookie(request,token)});
}catch(e){return errorResponse(e)}}
