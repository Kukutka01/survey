// Полноценная админка: логин, сводка, распределения по вопросам, таблица заявок,
// CSV-экспорт, расшифровка VK-профиля (по клику, с аудит-логом на сервере).
// Все данные — только через /api/admin/* после проверки HttpOnly-сессии. React рендерит значения
// как текст (XSS-safe); CSP strict-dynamic разрешает только скрипты этого бандла.
'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';

type Q={id:string;text:string;type:string;options:string[];scale?:string[];section:number};
type Dist={key:string;count:number}[];
type Item=Record<string,string>&{id:string;createdAt:string;version:number};
type Data={total:number;withVk:number;page:number;pageSize:number;questions:Q[];sections:string[];items:Item[];distributions:Record<string,Dist>};

const css=`
.admin{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:24px;color:#0f172a}
.admin h1{font-size:22px}.admin h2{font-size:16px;margin:28px 0 8px}
.cards{display:flex;gap:12px;flex-wrap:wrap}.card{border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;min-width:140px}
.card b{font-size:24px;display:block}
button.a{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;margin-right:8px}
button.a:disabled{opacity:.5}
input.p{border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:14px;width:280px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e2e8f0;padding:5px 7px;text-align:left;vertical-align:top}
.dist{margin:6px 0}.dist .bar{background:#dbeafe;border-radius:4px;height:14px}.dist .fill{background:#2563eb;border-radius:4px;height:14px}
.row-actions button{background:none;border:none;color:#2563eb;cursor:pointer;text-decoration:underline;font-size:12px}
.err{color:#b91c1c}.muted{color:#64748b;font-size:13px}
`;

export default function Admin(){
 const [authed,setAuthed]=useState<boolean|null>(null);
 const [password,setPassword]=useState('');const [loginErr,setLoginErr]=useState('');const [busy,setBusy]=useState(false);
 const [data,setData]=useState<Data|null>(null);const [page,setPage]=useState(1);const [err,setErr]=useState('');
 const [profiles,setProfiles]=useState<Record<string,string>>({});const [tab,setTab]=useState<'overview'|'responses'>('overview');

 const load=useCallback(async(p=1)=>{const r=await fetch(`/api/admin/data?page=${p}`,{cache:'no-store'});if(r.status===401){setAuthed(false);return}if(!r.ok)throw new Error(String(r.status));const d=await r.json() as Data;setData(d);setPage(d.page);setAuthed(true)},[]);
 useEffect(()=>{load().catch(()=>setErr('Не удалось загрузить данные'))},[load]);
 useEffect(()=>{const s=document.createElement('style');s.textContent=css;document.head.appendChild(s);return()=>{s.remove()}},[]);

 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);setLoginErr('');try{const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(r.status===401)setLoginErr('Неверный пароль');else if(r.status===429)setLoginErr('Слишком много попыток — подождите 10 минут');else if(!r.ok)setLoginErr('Ошибка входа');else{setPassword('');await load()}}catch{setLoginErr('Ошибка сети')}finally{setBusy(false)}}
 async function logout(){await fetch('/api/admin/logout',{method:'POST'});setAuthed(false);setData(null)}
 async function exportCsv(){setBusy(true);try{const r=await fetch('/api/admin/export',{method:'POST'});if(!r.ok)throw new Error();const blob=await r.blob();const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='trajectory-responses.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}catch{setErr('Экспорт не удался')}finally{setBusy(false)}}
 async function showProfile(id:string){if(profiles[id])return;try{const r=await fetch(`/api/admin/profile?id=${id}`,{cache:'no-store'});if(!r.ok)throw new Error();const {profile}=await r.json() as {profile?:string|null};setProfiles(p=>({...p,[id]:profile??'—'}))}catch{setProfiles(p=>({...p,[id]:'нет профиля или ошибка'}))}}

 const likertAvg=useMemo(()=>{if(!data)return[];const out:{q:Q;avg:number;n:number}[]=[];for(const q of data.questions.filter(x=>x.type==='likert'||x.type==='rating')){let sum=0,n=0;for(const it of data.items){const v=Number(it[q.id]);if(it[q.id]&&v>=1){sum+=v;n++}}if(n)out.push({q,avg:sum/n,n})}return out.sort((a,b)=>b.avg-a.avg)},[data]);

 if(authed===false)return <main className="admin"><h1>Траектория · админка</h1><form onSubmit={login}><input className="p" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль администратора" autoComplete="current-password"/><br/><br/><button className="a" disabled={busy||!password}>{busy?'…':'Войти'}</button></form>{loginErr&&<p className="err">{loginErr}</p>}<p className="muted">Пароль — не менее 12 символов (ADMIN_PASSWORD). 5 попыток / 10 минут.</p></main>;
 if(authed===null)return <main className="admin"><p>Проверка сессии…</p></main>;
 if(!data)return <main className="admin"><p>{err||'Загрузка…'}</p><button className="a" onClick={logout}>Выйти</button></main>;

 const totalPages=Math.max(1,Math.ceil(data.total/data.pageSize));
 return <main className="admin">
  <h1>Траектория · результаты</h1>
  <div className="cards">
   <div className="card"><b>{data.total}</b>всего заявок</div>
   <div className="card"><b>{data.withVk}</b>с VK-профилем</div>
   <div className="card"><b>{data.questions.length}</b>вопросов</div>
  </div>
  <p style={{marginTop:16}}>
   <button className="a" onClick={()=>setTab('overview')}>Сводка</button>
   <button className="a" onClick={()=>setTab('responses')}>Заявки ({data.total})</button>
   <button className="a" onClick={exportCsv} disabled={busy}>CSV экспорт</button>
   <button className="a" onClick={logout} style={{background:'#64748b'}}>Выйти</button>
  </p>
  {tab==='overview'&&<>
   <h2>Распределения ответов</h2>
   {data.sections.map((title,si)=><section key={title}>
    <h2 style={{color:'#2563eb'}}>{String(si+1).padStart(2,'0')} · {title}</h2>
    {data.questions.filter(q=>q.section===si).map(q=>{const d=data.distributions[q.id];if(!d||!d.length)return null;const max=Math.max(...d.map(x=>x.count));return <div key={q.id} style={{marginBottom:14}}>
      <div className="muted">{q.text}</div>
      {d.map(x=><div className="dist" key={x.key}><span>{x.key}{q.scale?` — ${q.scale[Number(x.key)-1]??''}`:''}: {x.count}</span><div className="bar" style={{width:`${Math.round(x.count/max*100)}%`}}/></div>)}
     </div>})}
   </section>)}
   <h2>Средние оценки (ликирт/рейтинг)</h2>
   <table><thead><tr><th>Вопрос</th><th>Среднее</th><th>n</th></tr></thead><tbody>
    {likertAvg.map(({q,avg,n})=><tr key={q.id}><td>{q.text}</td><td>{avg.toFixed(2)}</td><td>{n}</td></tr>)}
   </tbody></table>
  </>}
  {tab==='responses'&&<>
   <h2>Заявки · страница {data.page} из {totalPages}</h2>
   <p><button className="a" disabled={data.page<=1} onClick={()=>load(page-1)}>← Назад</button><button className="a" disabled={data.page>=totalPages} onClick={()=>load(page+1)}>Вперёд →</button></p>
   <div style={{overflowX:'auto'}}><table><thead><tr><th>ID</th><th>Дата</th>{data.questions.slice(0,12).map(q=><th key={q.id} title={q.text}>{q.id}</th>)}<th>VK</th></tr></thead><tbody>
    {data.items.map(it=><tr key={it.id}>
     <td>{it.id.slice(0,8)}</td><td>{it.createdAt.slice(0,16).replace('T',' ')}</td>
     {data.questions.slice(0,12).map(q=><td key={q.id}>{it[q.id]||'·'}</td>)}
     <td className="row-actions">{profiles[it.id]!==undefined?<span>{profiles[it.id]}</span>:<button onClick={()=>showProfile(it.id)}>показать</button>}</td>
    </tr>)}
   </tbody></table></div>
   <p className="muted">Показаны первые 12 вопросов; полный набор — в CSV. VK-ссылки расшифровываются по клику и попадают в серверный аудит-лог.</p>
  </>}
 </main>;
}
