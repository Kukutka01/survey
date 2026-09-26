import {sameOrigin,json,errorResponse,readAdminSession,destroyAdminSession} from '@/lib/security';
export async function POST(request:Request){try{
 sameOrigin(request,true);const session=await readAdminSession(request);if(!session)throw new Error('unauthorized');
 await destroyAdminSession(request);
 return json({ok:true},200,{'Set-Cookie':'admin_session=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict'});
}catch(e){return errorResponse(e)}}
