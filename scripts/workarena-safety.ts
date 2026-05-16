export const WORKARENA_RESET_MUTATION_RISK =
  "it may reset or mutate the remote ServiceNow instance";

export const WORKARENA_RESET_APPROVAL_MESSAGE =
  `Pass --allow-servicenow-reset only after explicit approval; ${WORKARENA_RESET_MUTATION_RISK}.`;

export const WORKARENA_HELD_SESSION_RESET_APPROVAL_MESSAGE =
  `Protocol is ready. ${WORKARENA_RESET_APPROVAL_MESSAGE}`;

export const WORKARENA_SELECTED_HANDOFF_APPROVAL_NOTE =
  `The selected handoff command includes --allow-servicenow-reset; run it only after explicit approval because ${WORKARENA_RESET_MUTATION_RISK}.`;

export const WORKARENA_ENV_RESET_SAFETY_NOTE =
  `A real WorkArena env.reset() requires --allow-servicenow-reset or --reset; ${WORKARENA_RESET_MUTATION_RISK}.`;

export const WORKARENA_BROWSERGYM_RESET_SAFETY_NOTE =
  `A real BrowserGym reset requires --allow-servicenow-reset and strict doctor readiness; ${WORKARENA_RESET_MUTATION_RISK}.`;

export const WORKARENA_DEMO_SERVER_BLOCKED_HTML =
  `<p class="warn">Server started without --allow-servicenow-reset. /start is blocked because the flag may reset or mutate the remote ServiceNow instance and requires explicit approval.</p>`;

export const WORKARENA_DEMO_SERVER_START_ERROR =
  `Restart the demo server with --allow-servicenow-reset only after explicit approval; ${WORKARENA_RESET_MUTATION_RISK}.`;
