import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresControlRepository } from '../src/postgres-control-repository.js';
const connectionString = process.env.MCP_TEST_DATABASE_URL;
test('interactive readiness requires a fresh capability handshake and falls back for old clients', {skip:!connectionString}, async()=>{
  const repository = new PostgresControlRepository(connectionString!);
  const accountId = `remote-test-${crypto.randomUUID()}`;
  try {
    await repository.migrate();
    await repository.migrate();
    await repository.upsertAccount(accountId,'fixture@example.test',true);
    const device=await repository.upsertDevice(accountId,crypto.randomUUID(),'Test','test','browser_extension');
    assert.deepEqual(device.capabilities,[]);
    await repository.markRemoteMissionReady(accountId,device.id,true);
    assert.deepEqual((await repository.listDevices(accountId))[0].capabilities,['remote_browser_tasks_v1','remote_browser_interactive_v1']);
    await repository.markRemoteMissionReady(accountId,device.id);
    assert.deepEqual((await repository.listDevices(accountId))[0].capabilities,['remote_browser_tasks_v1']);
    await repository.pool.query("UPDATE control.devices SET remote_mission_ready_at=now()-interval '4 minutes',remote_interactive_ready=true WHERE id=$1",[device.id]);
    assert.deepEqual((await repository.listDevices(accountId))[0].capabilities,[]);
  } finally {
    await repository.pool.query('DELETE FROM control.accounts WHERE account_id=$1',[accountId]);
    await repository.pool.end();
  }
});
