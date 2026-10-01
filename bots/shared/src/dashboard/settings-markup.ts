import { Fragment, h, type ComponentChildren } from 'preact'
import { RawMarkup, renderStaticMarkup } from './static-markup.ts'

/**
 * Server-rendered building blocks of the Settings page every bot dashboard shares: the stepper chip row, the numbered
 * step sections, the collapsible panels with their unsaved/queued badges, and the panels whose behaviour is the same
 * for every bot (execution wallet, transaction delivery, execution mode). The client-side behaviour lives in
 * `settings-navigation.ts`, `form-state.ts` and `readiness.ts`.
 *
 * The components are Preact function components that bot pages compose with JSX and render through
 * `renderStaticMarkup`. They are written with `h` rather than JSX because the chaos bot's TypeScript project, which
 * imports this module, does not enable JSX; the lower-case functions at the end keep its HTML-string API.
 */

export type SettingsStep = { id: string; label: string; step?: number | undefined }

function StepMark({ step }: { step: number | undefined }) {
	return step === undefined ? null : h('span', { class: 'settings-step' }, step.toString())
}

/** The sticky chip row that jumps between the settings steps and highlights the one in view. */
function SettingsNavigation({ steps }: { steps: readonly SettingsStep[] }) {
	return h(
		'nav',
		{ id: 'settings-nav', class: 'settings-nav', 'aria-label': 'Settings sections', 'data-page-content': 'settings' },
		steps.map(step => h('a', { href: `#${step.id}`, 'data-settings-target': step.id }, h(StepMark, { step: step.step }), step.label)),
	)
}

type SettingsIntroProps = { aside?: ComponentChildren | undefined; eyebrow?: ComponentChildren | undefined; scopeId?: string | undefined; scopeText: ComponentChildren; title?: ComponentChildren | undefined }

/** The page heading with the chain-profile scope line the bot fills in once its configuration loads. */
export function SettingsIntro({ aside, eyebrow = 'Operator controls', scopeId = 'settings-chain-scope', scopeText, title = 'Settings' }: SettingsIntroProps) {
	return h('div', { id: 'settings', class: 'settings-intro', 'data-page-content': 'settings' }, h('div', null, h('p', { class: 'eyebrow' }, eyebrow), h('h2', null, title), h('p', { id: scopeId, class: 'section-note' }, scopeText)), aside)
}

type SettingsSectionProps = { children?: ComponentChildren | undefined; collapsed?: boolean | undefined; id: string; step?: number | undefined; title: ComponentChildren }

/** One numbered setup step holding one or more panels; a collapsed step (such as Advanced) starts closed everywhere. */
export function SettingsSection({ children, collapsed = false, id, step, title }: SettingsSectionProps) {
	return h('section', { id, class: 'settings-section', 'aria-labelledby': `${id}-title`, 'data-settings-collapsed': collapsed ? 'true' : undefined }, h('h3', { id: `${id}-title`, class: 'settings-section-title' }, h(StepMark, { step }), title), children)
}

type SettingsGroupProps = {
	/** Badges a bot manages itself, rendered inside the summary's badge row instead of the form-state badges. */
	badges?: ComponentChildren | undefined
	children?: ComponentChildren | undefined
	/** The form whose unsaved and queued badges sit in the summary line. */
	formId?: string | undefined
	id?: string | undefined
	open?: boolean | undefined
	summary: ComponentChildren
	/** Set when the bot rewrites the summary line from its snapshot. */
	summaryId?: string | undefined
	title: ComponentChildren
	/** Set when the bot rewrites the title, such as a universe count. */
	titleId?: string | undefined
}

function SettingsBadges({ badges, formId }: Pick<SettingsGroupProps, 'badges' | 'formId'>) {
	if (badges !== undefined) return h('span', { class: 'settings-badges' }, badges)
	if (formId !== undefined) return h('span', { class: 'settings-badges', 'data-form': formId })
	return null
}

/** A collapsible panel: title and one-line summary on the left, unsaved/queued badges on the right, the body below a rule. */
export function SettingsGroup({ badges, children, formId, id, open = true, summary, summaryId, title, titleId }: SettingsGroupProps) {
	return h('details', { id, class: 'settings-group panel', open }, h('summary', null, h('span', { class: 'settings-summary-copy' }, h('strong', { id: titleId }, title), h('small', { id: summaryId }, summary)), h(SettingsBadges, { badges, formId })), h('div', { class: 'settings-body' }, children))
}

type FormActionsProps = { statusId: string; submitId?: string | undefined; submitLabel: ComponentChildren }

/** The status line and save button that close every focused form; the button starts disabled until an edit differs. */
export function FormActions({ statusId, submitId, submitLabel }: FormActionsProps) {
	return h('div', { class: 'form-actions' }, h('span', { id: statusId, class: 'action-status muted', role: 'status', 'aria-live': 'polite' }), h('button', { id: submitId, class: 'button', type: 'submit' }, submitLabel))
}

type SwitchFieldProps = { id: string; label: ComponentChildren; leading?: boolean | undefined; name?: string | undefined }

/** A checkbox with its label beside it; `leading` places it flush under the panel rule ahead of the fields it governs. */
export function SwitchField({ id, label, leading = false, name }: SwitchFieldProps) {
	return h('label', { class: leading ? 'switch-field form-switch' : 'switch-field' }, h('input', { id, name, type: 'checkbox' }), h('span', null, label))
}

type DescribedSwitchProps = { danger?: boolean | undefined; description: ComponentChildren; id: string; label: ComponentChildren; name?: string | undefined }

/** A boxed toggle with a full-sentence explanation beside it, for policy switches whose consequences need spelling out. */
function DescribedSwitch({ danger = false, description, id, label, name }: DescribedSwitchProps) {
	return h('div', { class: danger ? 'switch-row danger-switch' : 'switch-row' }, h('div', null, h('label', { for: id }, label), h('p', { id: `${id}-help` }, description)), h('input', { id, name, type: 'checkbox', 'aria-describedby': `${id}-help` }))
}

type SettingsPageProps = { children?: ComponentChildren | undefined; intro: ComponentChildren; notices?: ComponentChildren | undefined; steps: readonly SettingsStep[] }

/** The whole Settings page: intro, chip row, any load-state notice, then the step sections. */
export function SettingsPage({ children, intro, notices, steps }: SettingsPageProps) {
	return h(Fragment, null, intro, h(SettingsNavigation, { steps }), notices, h('div', { class: 'settings-stack', 'data-page-content': 'settings' }, children))
}

type SignerPanelProps = {
	/** The Remove saved key button, for bots that keep a memory-only signer active after forgetting the saved one. */
	forgetButton?: boolean | undefined
	rememberLabel?: ComponentChildren | undefined
	summary?: ComponentChildren | undefined
	title?: ComponentChildren | undefined
}

/**
 * The execution wallet panel. The summary line reports the active and saved signer; the status line inside the form
 * reports the outcome of the last request. Buttons: optional Remove saved key, Remove signer, Set signer.
 */
export function SignerPanel({ forgetButton = false, rememberLabel = 'Save this key in the local operator file', summary = 'Locked', title = 'Execution wallet' }: SignerPanelProps) {
	const privateKey = h('label', null, h('span', null, 'Private key'), h('input', { id: 'private-key', name: 'privateKey', type: 'password', autocomplete: 'off', 'aria-describedby': 'signer-status', placeholder: '0x…', spellcheck: false, required: true }))
	const buttons = h(
		'div',
		{ class: 'button-group' },
		forgetButton ? h('button', { id: 'forget-signer-button', class: 'button button-secondary', type: 'button' }, 'Remove saved key · keep signer') : null,
		h('button', { id: 'clear-signer-button', class: 'button button-secondary', type: 'button' }, 'Remove signer & saved key'),
		h('button', { id: 'set-signer-button', class: 'button', type: 'submit', disabled: true }, 'Set signer'),
	)
	const actions = h('div', { class: 'form-actions' }, h('span', { id: 'signer-status', class: 'action-status muted', role: 'status', 'aria-live': 'polite' }, 'Keys stay local and are never returned by the API or logged.'), buttons)
	return h(
		SettingsGroup,
		{ id: 'execution-wallet', summary, summaryId: 'signer-summary', title },
		h('form', { id: 'signer-form', autocomplete: 'off' }, h('fieldset', { id: 'signer-fieldset', disabled: true }, privateKey, h(SwitchField, { id: 'remember-signer', label: rememberLabel, name: 'rememberSigner' }), actions)),
	)
}

/** The transaction delivery form shared by bots that submit through private relays or the public mempool. */
export function SubmissionPanel({ note }: { note: ComponentChildren }) {
	const mode = h('label', null, h('span', null, 'Delivery mode'), h('select', { id: 'submission-mode', name: 'submissionMode' }, h('option', { value: 'private' }, 'Private relays'), h('option', { value: 'public' }, 'Public mempool')))
	const relays = h('label', { class: 'relay-urls-field' }, h('span', null, 'Private relay URLs · one per line, up to 8'), h('textarea', { id: 'relay-urls', name: 'relayUrls', rows: 3, spellcheck: false }))
	const successes = h('label', null, h('span', null, 'Required successful bundle relays'), h('input', { id: 'minimum-bundle-relay-successes', type: 'number', min: '1', max: '8', step: '1', required: true }))
	return h(
		SettingsGroup,
		{ formId: 'submission-form', summary: 'Transaction delivery', title: 'Submission' },
		h('form', { id: 'submission-form' }, h('fieldset', { id: 'submission-fieldset', disabled: true }, h('div', { class: 'submission-grid' }, mode, relays, successes), h('p', { class: 'section-note' }, note), h(FormActions, { statusId: 'submission-status', submitLabel: 'Save submission' }))),
	)
}

type ExecutionModePanelProps = { note: ComponentChildren; submitLabel?: ComponentChildren | undefined; switchLabel?: ComponentChildren | undefined }

/**
 * The execution mode panel: the readiness checklist the bot fills from its snapshot, then the live-execution switch
 * that stays locked until every required row holds. `renderExecutionMode` in `readiness.ts` drives it.
 */
export function ExecutionModePanel({ note, submitLabel = 'Save execution mode', switchLabel = 'Live execution · sign and submit transactions' }: ExecutionModePanelProps) {
	return h(
		SettingsGroup,
		{ formId: 'execution-form', id: 'execution-mode', summary: 'Dry run', summaryId: 'execution-mode-summary', title: 'Execution mode' },
		h('ul', { id: 'execution-checklist', class: 'readiness-list', 'aria-label': 'Live execution prerequisites' }),
		h('form', { id: 'execution-form' }, h('fieldset', { id: 'execution-fieldset', disabled: true }, h(SwitchField, { id: 'execution-enabled', label: switchLabel, leading: true }), h('p', { class: 'section-note' }, note), h(FormActions, { statusId: 'execution-status', submitLabel }))),
	)
}

// HTML-string API for bots whose pages are still string templates. Every string argument is repository-owned markup
// inserted verbatim, never request or runtime data.

function raw(html: string) {
	return h(RawMarkup, { html })
}

function optionalRaw(html: string | undefined) {
	return html === undefined ? undefined : raw(html)
}

export function settingsIntro({ aside = '', eyebrow, scopeId, scopeText, title }: { aside?: string; eyebrow?: string; scopeId?: string; scopeText: string; title?: string }) {
	return renderStaticMarkup(h(SettingsIntro, { aside: raw(aside), eyebrow: optionalRaw(eyebrow), scopeId, scopeText: raw(scopeText), title: optionalRaw(title) }))
}

export function settingsSection({ collapsed, groups, id, step, title }: { collapsed?: boolean; groups: string; id: string; step?: number; title: string }) {
	return renderStaticMarkup(h(SettingsSection, { collapsed, id, step, title: raw(title) }, raw(groups)))
}

export function settingsGroup({ badges, body, formId, id, open, summary, summaryId, title, titleId }: Omit<SettingsGroupProps, 'badges' | 'children' | 'summary' | 'title'> & { badges?: string; body: string; summary: string; title: string }) {
	return renderStaticMarkup(h(SettingsGroup, { badges: optionalRaw(badges), formId, id, open, summary: raw(summary), summaryId, title: raw(title), titleId }, raw(body)))
}

export function describedSwitch({ danger, description, id, label, name }: { danger?: boolean; description: string; id: string; label: string; name?: string }) {
	return renderStaticMarkup(h(DescribedSwitch, { danger, description: raw(description), id, label: raw(label), name }))
}

export function settingsPage({ intro, notices = '', sections, steps }: { intro: string; notices?: string; sections: string; steps: readonly SettingsStep[] }) {
	return renderStaticMarkup(h(SettingsPage, { intro: raw(intro), notices: raw(notices), steps }, raw(sections)))
}

export function signerPanel({ forgetButton, rememberLabel, summary, title }: { forgetButton?: boolean; rememberLabel?: string; summary?: string; title?: string } = {}) {
	return renderStaticMarkup(h(SignerPanel, { forgetButton, rememberLabel: optionalRaw(rememberLabel), summary: optionalRaw(summary), title: optionalRaw(title) }))
}

export function executionModePanel({ note, submitLabel, switchLabel }: { note: string; submitLabel?: string; switchLabel?: string }) {
	return renderStaticMarkup(h(ExecutionModePanel, { note: raw(note), submitLabel: optionalRaw(submitLabel), switchLabel: optionalRaw(switchLabel) }))
}
