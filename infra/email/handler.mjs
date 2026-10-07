import { KmsKeyringNode, buildClient, CommitmentPolicy } from '@aws-crypto/client-node';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { renderMessage } from './message.mjs';

export function createHandler({poolId, region, decryptCode, send}) {
  return async (event) => {
    let stage = 'validation';
    try {
      if (event.userPoolId !== poolId || event.region !== region || event.request?.type !== 'customEmailSenderRequestV1') throw new Error('Invalid event');
      const email = event.request.userAttributes?.email;
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw new Error('Invalid recipient');
      let secret = '';
      if (event.triggerSource !== 'CustomEmailSender_AccountTakeOverNotification') {
        if (typeof event.request.code !== 'string' || event.request.code.length > 32768) throw new Error('Invalid code envelope');
        stage = 'decryption';
        const {plaintext, messageHeader} = await decryptCode(Buffer.from(event.request.code, 'base64'));
        if (messageHeader.encryptionContext['userpool-id'] !== poolId) throw new Error('Invalid encryption context');
        secret = Buffer.from(plaintext).toString('utf8');
      }
      stage = 'rendering';
      const message = renderMessage(event.triggerSource, secret);
      stage = 'delivery';
      await send({FromEmailAddress:'OpenSidebar <no-reply@opensidebar.com>', ReplyToAddresses:['support@playscenario.ai'], Destination:{ToAddresses:[email]}, Content:{Simple:{Subject:{Data:message.subject,Charset:'UTF-8'},Body:{Html:{Data:message.html,Charset:'UTF-8'},Text:{Data:message.text,Charset:'UTF-8'}}}}});
    } catch (error) {
      // Never log events, addresses, code envelopes, decrypted values or SDK errors.
      const category = ['AccessDeniedException','AccessDenied','MessageRejected','InvalidParameterValue','CredentialsProviderError','TypeError','BadRequestException','NotFoundException','AccountSuspendedException','LimitExceededException','TooManyRequestsException'].includes(error?.name) ? error.name : 'Error';
      throw new Error(`OpenSidebar security email delivery failed (${stage}/${category})`);
    }
  };
}
let liveHandler;
export async function handler(event) {
  if (!liveHandler) {
    const {decrypt} = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
    const keyring = new KmsKeyringNode({keyIds:[process.env.KEY_ARN]});
    const ses = new SESv2Client({region:process.env.AWS_REGION});
    liveHandler = createHandler({poolId:process.env.USER_POOL_ID,region:process.env.AWS_REGION,decryptCode:(ciphertext)=>decrypt(keyring,ciphertext),send:(input)=>ses.send(new SendEmailCommand(input))});
  }
  return liveHandler(event);
}
