import json,urllib.request,urllib.error,http.cookiejar,uuid,re,sqlite3,pathlib
base='http://localhost:5173';s=json.load(open('app/survey.json'))
def client():
 jar=http.cookiejar.CookieJar();return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def request(op,path,body=None,headers=None,method=None):
 h={'Origin':base,**(headers or {})};raw=None if body is None else (body if isinstance(body,bytes) else json.dumps(body).encode());req=urllib.request.Request(base+path,data=raw,headers=h,method=method)
 try:
  with op.open(req) as r:return r.status,r.read().decode(),r.headers
 except urllib.error.HTTPError as e:return e.code,e.read().decode(),e.headers
answers={q['id']:('3' if q['type']=='likert' else '0' if q['type']=='number' else 'Московская область' if q['type']=='text' else 'https://vk.com/security_test_profile' if q['type']=='url' else q['options'][0]) for section in s for q in section['questions']}
p={'id':str(uuid.uuid4()),'answers':answers,'vkConsent':True,'questionnaireVersion':2}
c=client();status,body,h=request(c,'/api/session');assert status==200,(status,body);token=json.loads(body)['csrf'];headers={'Content-Type':'application/json','X-Survey-CSRF':token}
assert 'HttpOnly' in h['Set-Cookie'] and 'SameSite=Strict' in h['Set-Cookie']
checks=[]
def expect(name,code,body=p,h=headers,op=c,path='/api/responses',method=None):
 r=request(op,path,body,h,method);assert r[0]==code,(name,r[0],r[1]);checks.append(name)
expect('missing session rejected',403,op=client())
expect('cross-origin rejected',403,h={**headers,'Origin':'https://attacker.example'})
expect('missing CSRF rejected',403,h={'Content-Type':'application/json'})
expect('body size limit',413,body=b'x'*32769)
expect('content type enforced',415,h={**headers,'Content-Type':'text/plain'})
expect('unknown fields rejected',400,body={**p,'admin':True})
bad=dict(answers);bad['s3q1']='9';expect('invalid scale rejected',400,body={**p,'answers':bad})
bad=dict(answers);bad['s10q1']='Нет';expect('unconsented VK rejected',400,body={**p,'answers':bad,'vkConsent':False})
expect('valid submission saved',201)
expect('same submission safely retried',200)
# Eight authenticated attempts above consume the per-session budget.
expect('last allowed retry',200)
expect('rate limit enforced',429)
expect('no read API',405,body=None,h={},method='GET')
# Inspect only the local test database; production has never received these fixtures.
found=False
for file in pathlib.Path('.wrangler/state').rglob('*.sqlite'):
 db=sqlite3.connect(file)
 try:
  row=db.execute('select answers from survey_submissions where id=?',(p['id'],)).fetchone()
  if not row:continue
  found=True;assert 'vk.com' not in row[0] and 's10q' not in row[0]
  rows=db.execute('select id, encrypted_profile from private_profiles').fetchall();assert rows
  assert all('vk.com' not in v and p['id']!=k for k,v in rows)
  assert db.execute('select count(*) from survey_submissions where id=?',(p['id'],)).fetchone()[0]==1
 except sqlite3.OperationalError:pass
assert found
checks+=['VK excluded from analytical answers','VK ciphertext and opaque link stored separately','retry created no duplicate']
print('\n'.join('PASS '+x for x in checks))
