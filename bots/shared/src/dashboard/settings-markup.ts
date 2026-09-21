/**
 * Server-rendered building blocks of the Settings page every bot dashboard shares: the stepper chip row, the numbered
 * step sections, the collapsible panels with their unsaved/queued badges, and the panels whose behaviour is the same
 * for every bot (execution wallet, transaction delivery, execution mode). All inputs are repository-owned markup,
 * never request or runtime data; the client-side behaviour lives in `settings-navigation.ts`, `form-state.ts` and
 * `readiness.ts`.
 */

export type SettingsStep = { id: string; label: string; step?: number }

function stepMark(step: number | undefined) {
	return step === undefined ? '' : `<span class="settings-step">${step.toString()}</span>`
}

/** The sticky chip row that jumps between the settings steps and highlights the one in view. */
function settingsNavigation(steps: readonly SettingsStep[]) {
	const chips = steps.map(step => `<a href="#${step.id}" data-settings-target="${step.id}">${stepMark(step.step)}${step.label}</a>`).join('')
	return `<nav id="settings-nav" class="settings-nav" aria-label="Settings sections" data-page-content="settings">${chips}</nav>`
}

/** The page heading with the chain-profile scope line the bot fills in once its configuration loads. */
export function settingsIntro({ aside = '', eyebrow = 'Operator controls', scopeId = 'settings-chain-scope', scopeText, title = 'Settings' }: { aside?: string; eyebrow?: string; scopeId?: string; scopeText: string; title?: string }) {
	return `<div id="settings" class="settings-intro" data-page-content="settings"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p id="${scopeId}" class="section-note">${scopeText}</p></div>${aside}</div>`
}

/** One numbered setup step holding one or more panels; a collapsed step (such as Advanced) starts closed everywhere. */
export function settingsSection({ collapsed = false, groups, id, step, title }: { collapsed?: boolean; groups: string; id: string; step?: number; title: string }) {
	const collapsedAttribute = collapsed ? ' data-settings-collapsed="true"' : ''
	return `<section id="${id}" class="settings-section" aria-labelledby="${id}-title"${collapsedAttribute}><h3 id="${id}-title" class="settings-section-title">${stepMark(step)}${title}</h3>${groups}</section>`
}

type SettingsGroupOptions = {
	/** Badge markup a bot manages itself, rendered inside the summary's badge row instead of the form-state badges. */
	badges?: string
	body: string
	/** The form whose unsaved and queued badges sit in the summary line. */
	formId?: string
	id?: string
	open?: boolean
	summary: string
	/** Set when the bot rewrites the summary line from its snapshot. */
	summaryId?: string
	title: string
	/** Set when the bot rewrites the title, such as a universe count. */
	titleId?: string
}

/** A collapsible panel: title and one-line summary on the left, unsaved/queued badges on the right, the body below a rule. */
export function settingsGroup({ badges: customBadges, body, formId, id, open = true, summary, summaryId, title, titleId }: SettingsGroupOptions) {
	const idAttribute = id === undefined ? '' : ` id="${id}"`
	const titleAttribute = titleId === undefined ? '' : ` id="${titleId}"`
	const summaryAttribute = summaryId === undefined ? '' : ` id="${summaryId}"`
	let badges = ''
	if (customBadges !== undefined) badges = `<span class="settings-badges">${customBadges}</span>`
	else if (formId !== undefined) badges = `<span class="settings-badges" data-form="${formId}"></span>`
	return `<details${idAttribute} class="settings-group panel"${open ? ' open' : ''}><summary><span class="settings-summary-copy"><strong${titleAttribute}>${title}</strong><small${summaryAttribute}>${summary}</small></span>${badges}</summary><div class="settings-body">${body}</div></details>`
}

/** The status line and save button that close every focused form; the button starts disabled until an edit differs. */
export function formActions({ statusId, submitId, submitLabel }: { statusId: string; submitId?: string; submitLabel: string }) {
	const idAttribute = submitId === undefined ? '' : ` id="${submitId}"`
	return `<div class="form-actions"><span id="${statusId}" class="action-status muted" role="status" aria-live="polite"></span><button${idAttribute} class="button" type="submit">${submitLabel}</button></div>`
}

/** A checkbox with its label beside it; `leading` places it flush under the panel rule ahead of the fields it governs. */
export function switchField({ id, label, leading = false, name }: { id: string; label: string; leading?: boolean; name?: string }) {
	const nameAttribute = name === undefined ? '' : ` name="${name}"`
	return `<label class="switch-field${leading ? ' form-switch' : ''}"><input id="${id}"${nameAttribute} type="checkbox" /><span>${label}</span></label>`
}

/** A boxed toggle with a full-sentence explanation beside it, for policy switches whose consequences need spelling out. */
export function describedSwitch({ danger = false, description, id, label, name }: { danger?: boolean; description: string; id: string; label: string; name?: string }) {
	const nameAttribute = name === undefined ? '' : ` name="${name}"`
	return `<div class="switch-row${danger ? ' danger-switch' : ''}"><div><label for="${id}">${label}</label><p id="${id}-help">${description}</p></div><input id="${id}"${nameAttribute} type="checkbox" aria-describedby="${id}-help" /></div>`
}

/** The whole Settings page: intro, chip row, any load-state notice, then the step sections. */
export function settingsPage({ intro, notices = '', sections, steps }: { intro: string; notices?: string; sections: string; steps: readonly SettingsStep[] }) {
	return `${intro}${settingsNavigation(steps)}${notices}<div class="settings-stack" data-page-content="settings">${sections}</div>`
}

type SignerPanelOptions = {
	/** The Remove saved key button, for bots that keep a memory-only signer active after forgetting the saved one. */
	forgetButton?: boolean
	rememberLabel?: string
	summary?: string
	title?: string
}

/**
 * The execution wallet panel. The summary line reports the active and saved signer; the status line inside the form
 * reports the outcome of the last request. Buttons: optional Remove saved key, Remove signer, Set signer.
 */
export function signerPanel({ forgetButton = false, rememberLabel = 'Save this key in the local operator file', summary = 'Locked', title = 'Execution wallet' }: SignerPanelOptions = {}) {
	const forget = forgetButton ? '<button id="forget-signer-button" class="button button-secondary" type="button">Remove saved key · keep signer</button>' : ''
	const body = `<form id="signer-form" autocomplete="off"><fieldset id="signer-fieldset" disabled><label><span>Private key</span><input id="private-key" name="privateKey" type="password" autocomplete="off" aria-describedby="signer-status" placeholder="0x…" spellcheck="false" required /></label>${switchField({ id: 'remember-signer', label: rememberLabel, name: 'rememberSigner' })}<div class="form-actions"><span id="signer-status" class="action-status muted" role="status" aria-live="polite">Keys stay local and are never returned by the API or logged.</span><div class="button-group">${forget}<button id="clear-signer-button" class="button button-secondary" type="button">Remove signer &amp; saved key</button><button id="set-signer-button" class="button" type="submit" disabled>Set signer</button></div></div></fieldset></form>`
	return settingsGroup({ body, id: 'execution-wallet', summary, summaryId: 'signer-summary', title })
}

/** The transaction delivery form shared by bots that submit through private relays or the public mempool. */
function submissionFields({ note, statusId = 'submission-status', submitLabel = 'Save submission' }: { note: string; statusId?: string; submitLabel?: string }) {
	return `<div class="submission-grid"><label><span>Delivery mode</span><select id="submission-mode" name="submissionMode"><option value="private">Private relays</option><option value="public">Public mempool</option></select></label><label class="relay-urls-field"><span>Private relay URLs · one per line, up to 8</span><textarea id="relay-urls" name="relayUrls" rows="3" spellcheck="false"></textarea></label><label><span>Required successful bundle relays</span><input id="minimum-bundle-relay-successes" type="number" min="1" max="8" step="1" required /></label></div><p class="section-note">${note}</p>${formActions({ statusId, submitLabel })}`
}

export function submissionPanel(options: { note: string }) {
	return settingsGroup({ body: `<form id="submission-form"><fieldset id="submission-fieldset" disabled>${submissionFields(options)}</fieldset></form>`, formId: 'submission-form', summary: 'Transaction delivery', title: 'Submission' })
}

/**
 * The execution mode panel: the readiness checklist the bot fills from its snapshot, then the live-execution switch
 * that stays locked until every required row holds. `renderExecutionMode` in `readiness.ts` drives it.
 */
export function executionModePanel({ note, submitLabel = 'Save execution mode', switchLabel = 'Live execution · sign and submit transactions' }: { note: string; submitLabel?: string; switchLabel?: string }) {
	const body = `<ul id="execution-checklist" class="readiness-list" aria-label="Live execution prerequisites"></ul><form id="execution-form"><fieldset id="execution-fieldset" disabled>${switchField({ id: 'execution-enabled', label: switchLabel, leading: true })}<p class="section-note">${note}</p>${formActions({ statusId: 'execution-status', submitLabel })}</fieldset></form>`
	return settingsGroup({ body, formId: 'execution-form', id: 'execution-mode', summary: 'Dry run', summaryId: 'execution-mode-summary', title: 'Execution mode' })
}
