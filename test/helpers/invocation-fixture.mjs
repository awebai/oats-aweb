// Controlled data for the approved full-subject invocation; never an authority
// producer or replacement for the kernel's captured-record verification.
const integrity={format:'oats.tree-exec.v1',value:`sha256-${'a'.repeat(64)}`};
export const FIXTURE_INCARNATION_ID='11111111-1111-4111-8111-111111111111';
export function persistentSubject(alias='example') {
  const identity={kind:'local-soul',source:'path:/fixture/source',exportPath:'.'};
  return {kind:'persistent',soul:{identity,alias,definition:'soul.yaml',projection:{roots:['.']},sourceArtifact:{kind:'soul',identity,integrity},revision:{kind:'local',source:identity.source,integrity,provenance:[{kind:'source-export',document:{kind:'operator',id:'fixture'},pointer:''}]}}};
}
export function helperSubject(name='helper') {
  const provider={kind:'capability',capability:'example.helpers',integrity};
  return {kind:'helper',provider,definition:{owner:provider,path:`agents/${name}/soul.yaml`,kind:'file'},name};
}
export function invocationFor({binding,context,action,subject=persistentSubject(),instance,intent=null,priorReceipt=null,messagingChoice}={}) {
  const selected=context.kind==='workspace'?{kind:'workspace',identity:context.identity}:context;
  const messaging=messagingChoice ?? (binding.capability==='oats.aweb'?{schemaVersion:1,enabled:true,privateKey:{provider:'oats.aweb',human:binding.payload.responsibleHuman,context:selected},wider:binding.payload.wider,provenance:binding.provenance}:{schemaVersion:1,enabled:false});
  return {schemaVersion:1,executionBinding:{schemaVersion:1,deployment:'/deployment/fixture',resolution:{schemaVersion:1,id:`sha256-${'b'.repeat(64)}`}},subject,
    instance:instance===undefined?{home:'/deployment/fixture/example',work:'/deployment/fixture/example/work',name:'example-1',agent:subject.kind==='persistent'?subject.soul.alias:subject.name,incarnationId:FIXTURE_INCARNATION_ID}:instance,
    intent,context,responsibleHuman:messaging.enabled?messaging.privateKey.human:null,messagingChoice:messaging,capability:binding.capability,action,priorReceipt};
}
