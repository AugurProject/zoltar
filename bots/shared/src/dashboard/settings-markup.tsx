/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact'

/**
 * Server-rendered building blocks of the Settings page every bot dashboard shares: the stepper chip row, the numbered
 * step sections, the collapsible panels with their unsaved/queued badges, and the panels whose behaviour is the same
 * for every bot (execution wallet, transaction delivery, execution mode). The client-side behaviour lives in
 * `settings-navigation.ts`, `form-state.ts` and `readiness.ts`.
 *
 * Bot pages compose these Preact function components and render them through `renderStaticMarkup`. The JSX import
 * source pragma keeps the module working in bot images that do not ship a tsconfig.
 */

type SettingsStep = { id: string; label: string; step?: number | undefined }

function StepMark({ step }: { step: number | undefined }) {
	return step === undefined ? null : <span class='settings-step'>{step.toString()}</span>
}

/** The sticky chip row that jumps between the settings steps and highlights the one in view. */
function SettingsNavigation({ steps }: { steps: readonly SettingsStep[] }) {
	return (
		<nav id='settings-nav' class='settings-nav' aria-label='Settings sections' data-page-content='settings'>
			{steps.map(step => (
				<a href={`#${step.id}`} data-settings-target={step.id}>
					<StepMark step={step.step} />
					{step.label}
				</a>
			))}
		</nav>
	)
}

type SettingsIntroProps = { aside?: ComponentChildren | undefined; eyebrow?: ComponentChildren | undefined; scopeId?: string | undefined; scopeText: ComponentChildren; title?: ComponentChildren | undefined }

/** The page heading with the chain-profile scope line the bot fills in once its configuration loads. */
export function SettingsIntro({ aside, eyebrow = 'Operator controls', scopeId = 'settings-chain-scope', scopeText, title = 'Settings' }: SettingsIntroProps) {
	return (
		<div id='settings' class='settings-intro' data-page-content='settings'>
			<div>
				<p class='eyebrow'>{eyebrow}</p>
				<h2>{title}</h2>
				<p id={scopeId} class='section-note'>
					{scopeText}
				</p>
			</div>
			{aside}
		</div>
	)
}

type SettingsSectionProps = { children?: ComponentChildren | undefined; collapsed?: boolean | undefined; id: string; step?: number | undefined; title: ComponentChildren }

/** One numbered setup step holding one or more panels; a collapsed step (such as Advanced) starts closed everywhere. */
export function SettingsSection({ children, collapsed = false, id, step, title }: SettingsSectionProps) {
	return (
		<section id={id} class='settings-section' aria-labelledby={`${id}-title`} data-settings-collapsed={collapsed ? 'true' : undefined}>
			<h3 id={`${id}-title`} class='settings-section-title'>
				<StepMark step={step} />
				{title}
			</h3>
			{children}
		</section>
	)
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
	if (badges !== undefined) return <span class='settings-badges'>{badges}</span>
	if (formId !== undefined) return <span class='settings-badges' data-form={formId} />
	return null
}

/** A collapsible panel: title and one-line summary on the left, unsaved/queued badges on the right, the body below a rule. */
export function SettingsGroup({ badges, children, formId, id, open = true, summary, summaryId, title, titleId }: SettingsGroupProps) {
	return (
		<details id={id} class='settings-group panel' open={open}>
			<summary>
				<span class='settings-summary-copy'>
					<strong id={titleId}>{title}</strong>
					<small id={summaryId}>{summary}</small>
				</span>
				<SettingsBadges badges={badges} formId={formId} />
			</summary>
			<div class='settings-body'>{children}</div>
		</details>
	)
}

type FormActionsProps = { statusId: string; submitId?: string | undefined; submitLabel: ComponentChildren }

/** The status line and save button that close every focused form; the button starts disabled until an edit differs. */
export function FormActions({ statusId, submitId, submitLabel }: FormActionsProps) {
	return (
		<div class='form-actions'>
			<span id={statusId} class='action-status muted' role='status' aria-live='polite' />
			<button id={submitId} class='button' type='submit'>
				{submitLabel}
			</button>
		</div>
	)
}

type SwitchFieldProps = { id: string; label: ComponentChildren; leading?: boolean | undefined; name?: string | undefined }

/** A checkbox with its label beside it; `leading` places it flush under the panel rule ahead of the fields it governs. */
export function SwitchField({ id, label, leading = false, name }: SwitchFieldProps) {
	return (
		<label class={leading ? 'switch-field form-switch' : 'switch-field'}>
			<input id={id} name={name} type='checkbox' />
			<span>{label}</span>
		</label>
	)
}

type DescribedSwitchProps = { danger?: boolean | undefined; description: ComponentChildren; id: string; label: ComponentChildren; name?: string | undefined }

/** A boxed toggle with a full-sentence explanation beside it, for policy switches whose consequences need spelling out. */
export function DescribedSwitch({ danger = false, description, id, label, name }: DescribedSwitchProps) {
	return (
		<div class={danger ? 'switch-row danger-switch' : 'switch-row'}>
			<div>
				<label for={id}>{label}</label>
				<p id={`${id}-help`}>{description}</p>
			</div>
			<input id={id} name={name} type='checkbox' aria-describedby={`${id}-help`} />
		</div>
	)
}

type SettingsPageProps = { children?: ComponentChildren | undefined; intro: ComponentChildren; notices?: ComponentChildren | undefined; steps: readonly SettingsStep[] }

/** The whole Settings page: intro, chip row, any load-state notice, then the step sections. */
export function SettingsPage({ children, intro, notices, steps }: SettingsPageProps) {
	return (
		<>
			{intro}
			<SettingsNavigation steps={steps} />
			{notices}
			<div class='settings-stack' data-page-content='settings'>
				{children}
			</div>
		</>
	)
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
	return (
		<SettingsGroup id='execution-wallet' summary={summary} summaryId='signer-summary' title={title}>
			<form id='signer-form' autocomplete='off'>
				<fieldset id='signer-fieldset' disabled>
					<label>
						<span>Private key</span>
						<input id='private-key' name='privateKey' type='password' autocomplete='off' aria-describedby='signer-status' placeholder='0x…' spellcheck={false} required />
					</label>
					<SwitchField id='remember-signer' label={rememberLabel} name='rememberSigner' />
					<div class='form-actions'>
						<span id='signer-status' class='action-status muted' role='status' aria-live='polite'>
							Keys stay local and are never returned by the API or logged.
						</span>
						<div class='button-group'>
							{forgetButton ? (
								<button id='forget-signer-button' class='button button-secondary' type='button'>
									Remove saved key · keep signer
								</button>
							) : null}
							<button id='clear-signer-button' class='button button-secondary' type='button'>
								Remove signer &amp; saved key
							</button>
							<button id='set-signer-button' class='button' type='submit' disabled>
								Set signer
							</button>
						</div>
					</div>
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

/** The transaction delivery form shared by bots that submit through private relays or the public mempool. */
export function SubmissionPanel({ note }: { note: ComponentChildren }) {
	return (
		<SettingsGroup formId='submission-form' summary='Transaction delivery' title='Submission'>
			<form id='submission-form'>
				<fieldset id='submission-fieldset' disabled>
					<div class='submission-grid'>
						<label>
							<span>Delivery mode</span>
							<select id='submission-mode' name='submissionMode'>
								<option value='private'>Private relays</option>
								<option value='public'>Public mempool</option>
							</select>
						</label>
						<label class='relay-urls-field'>
							<span>Private relay URLs · one per line, up to 8</span>
							<textarea id='relay-urls' name='relayUrls' rows={3} spellcheck={false} />
						</label>
						<label>
							<span>Required successful bundle relays</span>
							<input id='minimum-bundle-relay-successes' type='number' min='1' max='8' step='1' required />
						</label>
					</div>
					<p class='section-note'>{note}</p>
					<FormActions statusId='submission-status' submitLabel='Save submission' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

type ExecutionModePanelProps = { note: ComponentChildren; submitLabel?: ComponentChildren | undefined; switchLabel?: ComponentChildren | undefined }

/**
 * The execution mode panel: the readiness checklist the bot fills from its snapshot, then the live-execution switch
 * that stays locked until every required row holds. `renderExecutionMode` in `readiness.ts` drives it.
 */
export function ExecutionModePanel({ note, submitLabel = 'Save execution mode', switchLabel = 'Live execution · sign and submit transactions' }: ExecutionModePanelProps) {
	return (
		<SettingsGroup formId='execution-form' id='execution-mode' summary='Dry run' summaryId='execution-mode-summary' title='Execution mode'>
			<ul id='execution-checklist' class='readiness-list' aria-label='Live execution prerequisites' />
			<form id='execution-form'>
				<fieldset id='execution-fieldset' disabled>
					<SwitchField id='execution-enabled' label={switchLabel} leading />
					<p class='section-note'>{note}</p>
					<FormActions statusId='execution-status' submitLabel={submitLabel} />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}
