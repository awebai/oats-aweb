// Read-only kernel queries (lib/session-readiness.mjs): the selected CLI only, and an
// environment without the invoking instance's selectors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kernelQueryEnvironment,querySelectedKernel} from '../oats-package/capabilities/oats-aweb/lib/session-readiness.mjs';
test('a kernel query needs the caller-owned OATS_CLI_BIN',()=>{
 assert.throws(()=>querySelectedKernel(['--version','--json'],{env:{}}),{code:'provider-unavailable'});
});
test('read-only kernel child retains normal native context while removing invoking instance selectors',()=>{
 const env={HOME:'/native/home',PI_CODING_AGENT_DIR:'/native/pi',NATIVE_AUTH_HELPER:'SYNTHETIC',GIT_CONFIG_GLOBAL:'/native/git',OATS_HOME_DIR:'/scope/data',OATS_DEPLOYMENT:'/wrong',OATS_RESOLUTION:'wrong',OATS_CLI_BIN:'/selected/kernel',OATS_BINDING_FILE:'/private/snapshot',PI_AGENT_HOME:'/wrong',PI_AGENTS_ROOT:'/wrong',OAS_CONTEXT:'/wrong'};
 const original={...env},clean=kernelQueryEnvironment(env);
 for(const key of ['HOME','PI_CODING_AGENT_DIR','NATIVE_AUTH_HELPER','GIT_CONFIG_GLOBAL','OATS_HOME_DIR'])assert.equal(clean[key],env[key]);
 for(const key of ['OATS_DEPLOYMENT','OATS_RESOLUTION','OATS_CLI_BIN','OATS_BINDING_FILE','PI_AGENT_HOME','PI_AGENTS_ROOT','OAS_CONTEXT'])assert.equal(Object.hasOwn(clean,key),false);
 assert.deepEqual(env,original);
});
