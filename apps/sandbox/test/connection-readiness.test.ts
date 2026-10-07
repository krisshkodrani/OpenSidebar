import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CloudDeviceV1} from '@opensidebar/shared-types';
import {browserReadiness} from '../src/app/settings/connection-readiness.js';
const device={availability:'online',capabilities:['remote_browser_tasks_v1'],revokedAt:null} as CloudDeviceV1;
test('connection readiness distinguishes permission, delivery capability and presence',()=>{
 assert.equal(browserReadiness(device,true).label,'Ready for remote reading');
 assert.equal(browserReadiness(device,false).label,'Remote work disabled');
 assert.equal(browserReadiness({...device,capabilities:[]},true).label,'Remote work unavailable');
 assert.equal(browserReadiness({...device,availability:'offline'},true).label,'Browser offline');
 assert.equal(browserReadiness({...device,revokedAt:'2026-10-07'},true).label,'Access revoked');
});
