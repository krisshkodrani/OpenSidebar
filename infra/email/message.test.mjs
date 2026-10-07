import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMessage} from './message.mjs';
import {createHandler} from './handler.mjs';
const event = {userPoolId:'test_pool',region:'eu-central-1',triggerSource:'CustomEmailSender_Authentication',request:{type:'customEmailSenderRequestV1',code:'dGVzdA==',userAttributes:{email:'person@example.test'}}};
const decryptCode = async()=>({plaintext:Buffer.from('12345678'),messageHeader:{encryptionContext:{'userpool-id':'test_pool'}}});
test('eight-digit code, branded sender and plain text survive delivery',async()=>{
 let delivered;
 await createHandler({poolId:'test_pool',region:'eu-central-1',decryptCode,send:async(input)=>{delivered=input;}})(event);
 assert.equal(delivered.FromEmailAddress,'OpenSidebar <no-reply@opensidebar.com>');
 assert.match(delivered.Content.Simple.Body.Html.Data,/12345678/);
 assert.match(delivered.Content.Simple.Body.Text.Data,/12345678/);
 assert.equal(delivered.Content.Simple.Body.Html.Data.includes('{{CODE}}'),false);
});
test('foreign pool and mismatched encryption context cannot send',async()=>{
 let sends=0;
 const handler=createHandler({poolId:'test_pool',region:'eu-central-1',decryptCode:async()=>({plaintext:Buffer.from('12345678'),messageHeader:{encryptionContext:{'userpool-id':'other'}}}),send:async()=>{sends++;}});
 await assert.rejects(handler({...event,userPoolId:'other'}),/delivery failed/);
 await assert.rejects(handler(event),/delivery failed/);
 assert.equal(sends,0);
});
test('all Cognito message types render and temporary password stays escaped',()=>{
 for(const kind of ['SignUp','ResendCode','ForgotPassword','UpdateUserAttribute','VerifyUserAttribute']) assert.match(renderMessage('CustomEmailSender_'+kind,'123456').html,/123456/);
 const password=renderMessage('CustomEmailSender_AdminCreateUser','&lt;abc&amp;xyz&gt;');
 assert.match(password.html,/&lt;abc&amp;xyz&gt;/);assert.match(password.text,/<abc&xyz>/);
 assert.match(renderMessage('CustomEmailSender_AccountTakeOverNotification').html,/unusual account activity/);
 assert.throws(()=>renderMessage('CustomEmailSender_Unexpected','123456'));
 assert.throws(()=>renderMessage('CustomEmailSender_Authentication','<script>'));
});
test('delivery failures reveal no SDK content or security code',async()=>{
 const handler=createHandler({poolId:'test_pool',region:'eu-central-1',decryptCode,send:async()=>{throw new Error('sensitive 12345678 person@example.test');}});
 await assert.rejects(handler(event),{message:'OpenSidebar security email delivery failed (delivery/Error)'});
});
