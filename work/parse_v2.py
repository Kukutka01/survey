import re,json,pathlib
p=pathlib.Path('/Users/aleksandr/.codex/attachments/b73ce4d6-6957-4702-b220-c7c6324f056d/Pasted text.txt')
lines=p.read_text().splitlines()
headers=['Укажите ваш пол','Опыт работы или стажировки','Профессиональное поле','Карьерные возможности','Ресурсы для профессионального развития','Карьерные ценности','Представления об эффективной карьере','Карьерные действия и намерения','Траектория и ожидаемые результаты','Дополнительный добровольный блок']
print([(i,l) for i,l in enumerate(lines) if l.strip() and not l.endswith('\t') and not l.startswith(('1 —','Оцените','Учитывайте')) and ('ценност' in l.lower() or l in headers)])
starts=[lines.index(h) for h in headers]+[len(lines)];sections=[]
for si in range(10):
 ls=lines[starts[si]:starts[si+1]];qs=[]
 if si in [0,1,8]:
  stars=[i for i,l in enumerate(ls) if l=='*']
  for idx,pos in enumerate(stars):
   text=ls[pos-1].strip();end=stars[idx+1]-1 if idx+1<len(stars) else len(ls)
   opts=[x.strip() for x in ls[pos+1:end] if x.strip()]
   typ='choice'
   if text.startswith('Сколько') or text.startswith('В скольких'):typ='number';opts=[]
   elif text.startswith('В каком регионе'):typ='text';opts=[]
   elif text.startswith('Насколько'):typ='rating';opts=list(map(str,range(1,11)))
   q=dict(text=text,type=typ,options=opts)
   if typ=='rating':q['scaleEnds']=[ls[pos+1],ls[end-1]]
   qs.append(q)
 elif si in range(2,8):
  seen=set();group='';labels=[];instruction=''
  for l in ls:
   if ' — ' in l and not '\t' in l and not l.startswith(('1 —','Оцените','Учитывайте')):group=l.strip()
   if l.startswith(('Оцените','Учитывайте')):instruction=l.strip()
   if l.startswith('1 —') and '\t' in l:labels=[re.sub(r'^\d — ','',x.strip()) for x in l.split('\t') if x.strip()]
   elif l.endswith('\t'):
    text=l.strip()
    if text in seen:continue
    seen.add(text);qs.append(dict(text=text,type='likert',options=[],scale=labels,group=group,instruction=instruction))
 else:
  qs=[dict(text='Согласны ли вы добровольно предоставить ссылку на профиль во «ВКонтакте» для указанной исследовательской цели?',type='choice',options=['Да','Нет'],optional=True),dict(text='Если вы ответили «Да», укажите ссылку на ваш профиль во «ВКонтакте»',type='url',options=[],optional=True)]
 for j,q in enumerate(qs):q['id']=f's{si+1}q{j+1}'
 sections.append(dict(title=headers[si] if si else 'Знакомство',questions=qs))
pathlib.Path('app/survey.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2))
print([(s['title'],len(s['questions'])) for s in sections])
print('total',sum(len(s['questions']) for s in sections))
for i in [0,1,8]:print(json.dumps(sections[i],ensure_ascii=False))
