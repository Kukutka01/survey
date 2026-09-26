export type Answers=Record<string,string>;
export type Question={id:string;text:string;type:string;options:string[];optional?:boolean;scale?:string[];scaleEnds?:string[];group?:string;instruction?:string};
export function hasExperience(a:Answers){return a.s1q4==='Да'||['Работаю по получаемой специальности','Работаю не по получаемой специальности','Прохожу оплачиваемую стажировку или практику','Прохожу неоплачиваемую стажировку, практику или участвую в профессиональном проекте'].includes(a.s1q3)}
export function applicable(q:Question,a:Answers){return (!q.id.startsWith('s2q')||hasExperience(a))&&(q.id!=='s10q2'||a.s10q1==='Да')}
export function validAnswer(q:Question,a:unknown):boolean{
 if(q.optional&&(a===undefined||a===''))return true;
 if(typeof a!=='string'||a.length>1000||/[\u0000-\u001f\u007f]/.test(a))return false;
 const v=a.trim();
 if(q.type==='number')return /^\d{1,5}$/.test(v)&&Number(v)<=10000;
 if(q.type==='text')return v.length>=2&&v.length<=150;
 if(q.type==='url'){if(!v)return true;try{const u=new URL(v);return u.protocol==='https:'&&['vk.com','www.vk.com','m.vk.com','vk.ru','www.vk.ru'].includes(u.hostname)&&/^\/[a-zA-Z0-9_.]{2,100}\/?$/.test(u.pathname)&&!u.search&&!u.hash&&!u.port&&!u.username&&!u.password}catch{return false}}
 if(q.type==='likert')return ['1','2','3','4','5'].includes(v);
 if(q.options.includes('Другое:')&&v.startsWith('Другое:'))return v.slice(7).trim().length>0;
 return q.options.includes(v)
}
