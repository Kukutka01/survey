// Расшифровка привязки заявки -> VK-профиль. Каждый доступ пишется в структурированный аудит-лог.
import {getRawDb} from '@/db/raw';
import {readAdminSession,json,errorResponse,HttpError,privateProfileId,decryptProfile} from '@/lib/security';

export async function GET(request:Request){try{
 if(!await readAdminSession(request))throw new HttpError(401,'Unauthorized');
 const id=new URL(request.url).searchParams.get('id');
 if(!id||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new HttpError(400,'Invalid id');
 const profileId=await privateProfileId(id);
 const row=await getRawDb().prepare('SELECT encrypted_profile FROM private_profiles WHERE id = ?').bind(profileId).first<{encrypted_profile:string}>();
 if(!row)return json({profile:null});
 const profile=await decryptProfile(row.encrypted_profile,profileId);
 console.log(JSON.stringify({event:'admin_profile_decrypt',submission:id.slice(0,8)+'…'})); // без PII в логе
 return json({profile});
}catch(e){return errorResponse(e)}}
