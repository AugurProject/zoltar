// The chaos bot does not depend on Preact itself and ships no tsconfig in its image, so it calls the factory re-exported by the shared renderer directly instead of compiling JSX.
import { DescribedSwitch, ExecutionModePanel, SettingsGroup, SettingsIntro, SettingsPage, SettingsSection, SignerPanel } from '@zoltar/bot-shared/dashboard/settings-markup'
import { Fragment, h, renderStaticMarkup } from '@zoltar/bot-shared/dashboard/static-markup'

function UnitField({ id, label, max, min, unit }: { id: string; label: string; max: string; min: string; unit: string }) {
	return h('label', null, h('span', null, label), h('span', { class: 'input-with-unit' }, h('input', { id, min, max, inputmode: 'numeric', type: 'number', required: true }), h('span', null, unit)))
}

function DecimalField({ id, label }: { id: string; label: string }) {
	return h('label', null, h('span', null, label), h('input', { id, inputmode: 'decimal', type: 'text', required: true }))
}

function ConnectivityPanel() {
	return h(
		SettingsGroup,
		{ id: 'network-connectivity', summary: 'Server-side endpoint and chain verification', title: 'Chain and RPC connectivity' },
		h(
			'form',
			{ id: 'connectivity-form' },
			h(
				'fieldset',
				{ id: 'connectivity-fields', disabled: true },
				h('p', { class: 'notice' }, 'RPC checks run from the chaos-bot server. Docker service URLs such as ', h('code', null, 'http://reth:8545'), " work only when that process shares the service's container network. Saved endpoint URLs remain visible here so the active configuration can be reviewed and edited."),
				h(
					'div',
					{ class: 'field-grid' },
					h('label', null, h('span', null, 'Primary read RPC'), h('input', { id: 'read-rpc-url', autocomplete: 'off', placeholder: 'http://reth:8545', spellcheck: false, type: 'url', required: true })),
					h('label', null, h('span', null, 'RPC agreement'), h('select', { id: 'rpc-quorum' }, h('option', { value: '1' }, 'One healthy reader'), h('option', { value: '2' }, 'Two agreeing readers'))),
					h('label', { class: 'field-grid-wide' }, h('span', null, 'Independent quorum read RPCs'), h('textarea', { id: 'quorum-rpc-urls', autocomplete: 'off', placeholder: 'One URL per line', rows: 3, spellcheck: false })),
					h('label', { class: 'field-grid-wide' }, h('span', null, 'Public submission RPCs'), h('textarea', { id: 'public-rpc-urls', autocomplete: 'off', placeholder: 'One URL per line', rows: 3, spellcheck: false, required: true })),
				),
				h(
					'div',
					{ class: 'form-actions' },
					h('span', { id: 'connectivity-status', class: 'action-status muted', role: 'status', 'aria-live': 'polite' }),
					h('div', { class: 'button-group' }, h('button', { id: 'discard-connectivity', class: 'button button-secondary', type: 'button', disabled: true }, 'Discard RPC draft'), h('button', { id: 'save-connectivity', class: 'button', type: 'submit' }, 'Check and save RPCs')),
				),
			),
		),
	)
}

function PolicySwitches() {
	return h(
		Fragment,
		null,
		h(DescribedSwitch, { description: 'Includes disputes, auction participation, and other economically adversarial workflows.', id: 'allow-high-risk', label: 'Allow high-risk operations', name: 'allowHighRiskOperations' }),
		h(DescribedSwitch, { danger: true, description: 'Includes forks, REP migration, burns, and global lifecycle transitions.', id: 'allow-irreversible', label: 'Allow irreversible operations', name: 'allowIrreversibleOperations' }),
		h(DescribedSwitch, {
			description:
				'Continuously completes the exact genesis topology: binary question, origin security pool, wallet vault, external REP/WETH Uniswap pool creation, initialization, and seeding, Statoblast trading roots, canonical trading pair, and initial pair liquidity. Only these initializer operations bypass the selectable allowlist.',
			id: 'initialize-genesis-universe',
			label: 'Initialize genesis universe',
			name: 'initializeGenesisUniverse',
		}),
		h(DescribedSwitch, {
			description: h(
				Fragment,
				null,
				'Turn this off for a staged rollout, then enable operations in the',
				' ',
				h('a', { id: 'selectable-operation-catalog-link', class: 'text-link', href: '/catalog' }, 'Operation catalog'),
				'. An empty allowlist runs lifecycle obligations only unless genesis initialization is enabled; only its ordered initializer operations are exempt. Lifecycle discovery, recovery, and execution are never disabled by this control.',
			),
			id: 'all-selectable-operations',
			label: 'Allow every selectable operation',
			name: 'allSelectableOperations',
		}),
	)
}

const ECOSYSTEM_SWITCHES = [
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'Open Oracle'],
	['trading', 'Trading'],
] as const

function PolicyPanel() {
	return h(
		SettingsGroup,
		{
			badges: h('span', { id: 'settings-draft-status', class: 'settings-badge', 'data-kind': 'dirty', role: 'status', hidden: true }, 'Unsaved changes'),
			summary: 'Risk scope, random novelty, reserves, timing, and ecosystems · editable while paused',
			title: 'Execution policy',
		},
		h(
			'form',
			{ id: 'settings-form' },
			h(
				'fieldset',
				{ id: 'settings-fields', disabled: true },
				h(PolicySwitches, null),
				h(
					'label',
					{ class: 'selectable-operation-allowlist-label', for: 'selectable-operation-allowlist' },
					h('span', null, 'Selectable operation allowlist'),
					h('textarea', { id: 'selectable-operation-allowlist', 'aria-describedby': 'all-selectable-operations-help', placeholder: 'One exact definition ID per line, for example:\nopen-oracle.weth.wrap', rows: 5, spellcheck: false }),
				),
				h(
					'div',
					{ class: 'field-grid' },
					h(UnitField, { id: 'min-delay', label: 'Minimum random delay', max: '3599', min: '60', unit: 'seconds' }),
					h(UnitField, { id: 'max-delay', label: 'Maximum random delay', max: '3600', min: '60', unit: 'seconds' }),
					h(DecimalField, { id: 'reserve-eth', label: 'ETH reserve' }),
					h(DecimalField, { id: 'reserve-rep', label: 'REP reserve' }),
					h(DecimalField, { id: 'maximum-eth-operation', label: 'Maximum ETH per operation' }),
					h(DecimalField, { id: 'maximum-gas-cost', label: 'Maximum gas cost (ETH)' }),
					h(DecimalField, { id: 'maximum-rep-operation', label: 'Maximum REP per operation' }),
					h(UnitField, { id: 'workflow-valid-blocks', label: 'Workflow validity', max: '1000000', min: '243', unit: 'blocks' }),
				),
				h(
					'fieldset',
					{ class: 'ecosystem-controls' },
					h('legend', null, 'Enabled ecosystems'),
					ECOSYSTEM_SWITCHES.map(([id, label]) => h('label', { class: 'switch-field' }, h('input', { 'data-ecosystem-toggle': id, type: 'checkbox' }), h('span', null, label))),
				),
				h(
					'div',
					{ class: 'form-actions' },
					h('span', { id: 'settings-save-status', class: 'action-status muted', role: 'status', 'aria-live': 'polite' }),
					h('div', { class: 'button-group' }, h('button', { id: 'discard-settings', class: 'button button-secondary', type: 'button', disabled: true }, 'Discard changes'), h('button', { id: 'save-settings', class: 'button', type: 'submit' }, 'Save execution policy')),
				),
			),
		),
	)
}

const STEPS = [
	{ id: 'settings-connect', label: 'Connect', step: 1 },
	{ id: 'settings-policy', label: 'Execution policy', step: 2 },
	{ id: 'settings-go-live', label: 'Go live', step: 3 },
	{ id: 'settings-complete', label: 'Complete configuration', step: 4 },
]

/** The Settings page: Connect, Execution policy, Go live, and Complete configuration; the pause note sits under the chip row. */
function ChaosSettingsPage() {
	return h(
		SettingsPage,
		{
			intro: h(SettingsIntro, { aside: h('span', { id: 'settings-scope', class: 'badge neutral' }, 'Configuration loading'), eyebrow: 'Safety controls', scopeText: 'Changes apply before the next selection cycle.' }),
			notices: h(
				Fragment,
				null,
				h('div', { id: 'configuration-status', class: 'notice hidden', role: 'status', 'data-page-content': 'settings' }),
				h('div', { id: 'settings-pause-note', class: 'notice warning hidden', role: 'status', 'data-page-content': 'settings' }, 'Execution policy and execution mode are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, ecosystem scope, or the live switch.'),
			),
			steps: STEPS,
		},
		h(SettingsSection, { id: 'settings-connect', step: 1, title: 'Connect' }, h(ConnectivityPanel, null)),
		h(SettingsSection, { id: 'settings-policy', step: 2, title: 'Execution policy' }, h(PolicyPanel, null)),
		h(
			SettingsSection,
			{ id: 'settings-go-live', step: 3, title: 'Go live' },
			h(SignerPanel, { rememberLabel: "Remember in the bot's owner-only state directory", summary: 'No signer configured', title: 'Transaction signer' }),
			h('p', { class: 'notice' }, 'Changing the signer address restarts the bot paused with live execution off. Old funds, positions, and recovery history remain with the old signer and its preserved state.'),
			h(ExecutionModePanel, { note: 'Off is dry-run mode. Live mode can spend gas and protocol assets.', switchLabel: 'Submit live transactions' }),
		),
		h(
			SettingsSection,
			{ id: 'settings-complete', step: 4, title: 'Complete configuration' },
			h(
				SettingsGroup,
				{ title: 'All configuration fields', summary: 'Network, contracts, discovery, submission, and runtime' },
				h('p', { class: 'notice' }, 'Saving restarts paused in dry-run mode. Identity changes preserve the old state. Dashboard binding changes may disconnect this page.'),
				h(
					'form',
					{ id: 'complete-configuration-form' },
					h('button', { id: 'load-complete-configuration', class: 'button button-secondary', type: 'button' }, 'Discard changes'),
					h(
						'fieldset',
						{ id: 'complete-configuration-fields', disabled: true },
						h('label', { class: 'switch-field' }, h('input', { id: 'complete-configuration-json-mode', type: 'checkbox' }), h('span', null, 'Edit as JSON, including optional fields')),
						h('div', { id: 'complete-configuration-content' }),
						h('label', { id: 'complete-configuration-json-label', class: 'hidden' }, h('span', null, 'Complete configuration JSON'), h('textarea', { id: 'complete-configuration-json', rows: 20, spellcheck: false, 'aria-describedby': 'complete-configuration-status' })),
					),
					h('div', { class: 'form-actions' }, h('span', { id: 'complete-configuration-status', class: 'action-status muted', role: 'status', 'aria-live': 'polite' }), h('button', { id: 'save-complete-configuration', class: 'button', type: 'submit', disabled: true }, 'Check, save and restart')),
				),
			),
		),
	)
}

export const settingsPageMarkup = renderStaticMarkup(h(ChaosSettingsPage, null))
