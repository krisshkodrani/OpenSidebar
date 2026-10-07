import { readFileSync } from 'node:fs';
const template = readFileSync(new URL('./sign-in.html', import.meta.url), 'utf8');
const escape = (value) => value.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unescapePassword = (value) => value.replace(/&(lt|gt|amp|quot|apos|#39);/g, (_, key) => ({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'",'#39':"'"}[key]));
const messages = {
  Authentication: ['Your sign-in code', 'Dein Anmeldecode', 'Enter this one-time code in the browser where you started signing in to OpenSidebar.', 'Gib den einmaligen Code in dem Browser ein, in dem du die Anmeldung gestartet hast.'],
  SignUp: ['Verify your email', 'E-Mail bestätigen', 'Enter this code to confirm your email address for OpenSidebar.', 'Gib diesen Code ein, um deine E-Mail-Adresse für OpenSidebar zu bestätigen.'],
  ResendCode: ['Verify your email', 'E-Mail bestätigen', 'Enter this new code to confirm your email address for OpenSidebar.', 'Gib diesen neuen Code ein, um deine E-Mail-Adresse für OpenSidebar zu bestätigen.'],
  ForgotPassword: ['Reset your password', 'Passwort zurücksetzen', 'Enter this code in the OpenSidebar password reset page you opened.', 'Gib diesen Code auf der geöffneten OpenSidebar-Seite zum Zurücksetzen des Passworts ein.'],
  UpdateUserAttribute: ['Verify your email', 'E-Mail bestätigen', 'Enter this code to confirm the email address change you requested.', 'Gib diesen Code ein, um die angeforderte Änderung deiner E-Mail-Adresse zu bestätigen.'],
  VerifyUserAttribute: ['Verify your email', 'E-Mail bestätigen', 'Enter this code to confirm your email address for OpenSidebar.', 'Gib diesen Code ein, um deine E-Mail-Adresse für OpenSidebar zu bestätigen.'],
  AdminCreateUser: ['Your OpenSidebar invitation', 'Deine OpenSidebar-Einladung', 'Use this temporary password to complete your OpenSidebar invitation. You will be asked to choose a new password.', 'Verwende dieses vorläufige Passwort für deine OpenSidebar-Einladung. Anschließend wählst du ein neues Passwort.'],
  AccountTakeOverNotification: ['Security notice', 'Sicherheitshinweis', 'OpenSidebar detected unusual account activity. If this was not you, open your workspace directly and contact support.', 'OpenSidebar hat ungewöhnliche Kontoaktivität festgestellt. Falls du das nicht warst, öffne deinen Arbeitsbereich direkt und kontaktiere den Support.'],
};
export function renderMessage(trigger, secret = '') {
  const kind = trigger.replace(/^CustomEmailSender_/, '');
  if (!trigger.startsWith('CustomEmailSender_') || !Object.hasOwn(messages, kind)) throw new Error('Unsupported email event');
  const [title, deTitle, instruction, deInstruction] = messages[kind];
  const value = kind === 'AccountTakeOverNotification' ? 'Security notice / Sicherheitshinweis' : kind === 'AdminCreateUser' ? unescapePassword(secret) : secret;
  if (!value || value.length > 256 || (kind !== 'AdminCreateUser' && kind !== 'AccountTakeOverNotification' && !/^\d{6,8}$/.test(value))) throw new Error('Invalid security message');
  let html = template.replaceAll('Your sign-in code', title).replace('Dein Anmeldecode', deTitle)
    .replace('Your one-time code to open your OpenSidebar workspace.', instruction)
    .replace('Enter this one-time code in the browser where you started signing in to OpenSidebar.', instruction)
    .replace('Gib den einmaligen Code in dem Browser ein, in dem du die Anmeldung gestartet hast.', deInstruction)
    .replace('{{CODE}}', escape(value));
  if (kind === 'AdminCreateUser' || kind === 'AccountTakeOverNotification') html = html.replace('font-size:30px;line-height:1.3;font-weight:700;letter-spacing:3px', 'font-size:18px;line-height:1.5;font-weight:700;letter-spacing:0;overflow-wrap:anywhere;word-break:break-word');
  return {subject: `OpenSidebar · ${title}`, html, text: `${title}\n\n${instruction}\n\n${value}\n\nKeep this private. If you did not request it, you can ignore this email.\n\n${deTitle}\n${deInstruction}\n\nOpenSidebar: https://opensidebar.com/app\nSupport: support@playscenario.ai`};
}
