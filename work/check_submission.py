import json,urllib.request,urllib.error,uuid
s=json.load(open('app/survey.json'));answers={q['id']:('3' if q['type']=='likert' else '0' if q['type']=='number' else '' if q['type']=='url' else q['options'][0]) for x in s for q in x['questions']}
def post(payload):
 req=urllib.request.Request('http://localhost:5173/api/responses',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req) as r:return r.status,r.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
id=str(uuid.uuid4());p={'id':id,'answers':answers,'vkConsent':False}
assert post({'id':id,'answers':{}})[0]==400
bad=dict(answers);bad['s9q1']='-1';assert post({'id':id,'answers':bad})[0]==400
bad=dict(answers);bad['s10q1']='https://vk.com/test';assert post({'id':id,'answers':bad,'vkConsent':False})[0]==400
print('valid submission:',post(p));print('idempotent retry:',post(p));print('Incomplete, negative number and absent VK consent rejected');open('work/test-id.txt','w').write(id)
