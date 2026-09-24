import { describedSwitch, executionModePanel, settingsGroup, settingsIntro, settingsPage, settingsSection, signerPanel } from '@zoltar/bot-shared/dashboard/settings-markup'

// All inputs are repository-owned markup, never request or runtime data.

function unitField(label: string, id: string, unit: string, attributes: string) {
	return `<label><span>${label}</span><span class="input-with-unit"><input id="${id}" ${attributes} inputmode="numeric" type="number" required /><span>${unit}</span></span></label>`
}

function decimalField(label: string, id: string) {
	return `<label><span>${label}</span><input id="${id}" inputmode="decimal" type="text" required /></label>`
}

const connectivityPanel = settingsGroup({
	body: `<form id="connectivity-form"><fieldset id="connectivity-fields" disabled><p class="notice">RPC checks run from the chaos-bot server. Docker service URLs such as <code>http://reth:8545</code> work only when that process shares the service's container network. Saved endpoint URLs remain visible here so the active configuration can be reviewed and edited.</p><div class="field-grid"><label><span>Primary read RPC</span><input id="read-rpc-url" autocomplete="off" placeholder="http://reth:8545" spellcheck="false" type="url" required /></label><label><span>RPC agreement</span><select id="rpc-quorum"><option value="1">One healthy reader</option><option value="2">Two agreeing readers</option></select></label><label class="field-grid-wide"><span>Independent quorum read RPCs</span><textarea id="quorum-rpc-urls" autocomplete="off" placeholder="One URL per line" rows="3" spellcheck="false"></textarea></label><label class="field-grid-wide"><span>Public submission RPCs</span><textarea id="public-rpc-urls" autocomplete="off" placeholder="One URL per line" rows="3" spellcheck="false" required></textarea></label></div><div class="form-actions"><span id="connectivity-status" class="action-status muted" role="status" aria-live="polite"></span><div class="button-group"><button id="discard-connectivity" class="button button-secondary" type="button" disabled>Discard RPC draft</button><button id="save-connectivity" class="button" type="submit">Check and save RPCs</button></div></div></fieldset></form>`,
	id: 'network-connectivity',
	summary: 'Server-side endpoint and chain verification',
	title: 'Chain and RPC connectivity',
})

const policySwitches = [
	describedSwitch({ description: 'Includes disputes, auction participation, and other economically adversarial workflows.', id: 'allow-high-risk', label: 'Allow high-risk operations', name: 'allowHighRiskOperations' }),
	describedSwitch({ danger: true, description: 'Includes forks, REP migration, burns, and global lifecycle transitions.', id: 'allow-irreversible', label: 'Allow irreversible operations', name: 'allowIrreversibleOperations' }),
	describedSwitch({
		description:
			'Continuously completes the exact genesis topology: binary question, origin security pool, wallet vault, external REP/WETH Uniswap pool creation, initialization, and seeding, Statoblast trading roots, canonical trading pair, and initial pair liquidity. Only these initializer operations bypass the selectable allowlist.',
		id: 'initialize-genesis-universe',
		label: 'Initialize genesis universe',
		name: 'initializeGenesisUniverse',
	}),
	describedSwitch({
		description:
			'Turn this off for a staged rollout, then enable operations in the <a id="selectable-operation-catalog-link" class="text-link" href="/catalog">Operation catalog</a>. An empty allowlist runs lifecycle obligations only unless genesis initialization is enabled; only its ordered initializer operations are exempt. Lifecycle discovery, recovery, and execution are never disabled by this control.',
		id: 'all-selectable-operations',
		label: 'Allow every selectable operation',
		name: 'allSelectableOperations',
	}),
].join('')

const policyFields = [
	unitField('Minimum random delay', 'min-delay', 'seconds', 'min="60" max="3599"'),
	unitField('Maximum random delay', 'max-delay', 'seconds', 'min="60" max="3600"'),
	decimalField('ETH reserve', 'reserve-eth'),
	decimalField('REP reserve', 'reserve-rep'),
	decimalField('Maximum ETH per operation', 'maximum-eth-operation'),
	decimalField('Maximum gas cost (ETH)', 'maximum-gas-cost'),
	decimalField('Maximum REP per operation', 'maximum-rep-operation'),
	unitField('Workflow validity', 'workflow-valid-blocks', 'blocks', 'min="243" max="1000000"'),
].join('')

const ecosystemSwitches = [
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'Open Oracle'],
	['trading', 'Trading'],
]
	.map(([id, label]) => `<label class="switch-field"><input data-ecosystem-toggle="${id}" type="checkbox" /><span>${label}</span></label>`)
	.join('')

const policyPanel = settingsGroup({
	badges: '<span id="settings-draft-status" class="settings-badge" data-kind="dirty" role="status" hidden>Unsaved changes</span>',
	body: `<form id="settings-form"><fieldset id="settings-fields" disabled>${policySwitches}<label class="selectable-operation-allowlist-label" for="selectable-operation-allowlist"><span>Selectable operation allowlist</span><textarea id="selectable-operation-allowlist" aria-describedby="all-selectable-operations-help" placeholder="One exact definition ID per line, for example:&#10;open-oracle.weth.wrap" rows="5" spellcheck="false"></textarea></label><div class="field-grid">${policyFields}</div><fieldset class="ecosystem-controls"><legend>Enabled ecosystems</legend>${ecosystemSwitches}</fieldset><div class="form-actions"><span id="settings-save-status" class="action-status muted" role="status" aria-live="polite"></span><div class="button-group"><button id="discard-settings" class="button button-secondary" type="button" disabled>Discard changes</button><button id="save-settings" class="button" type="submit">Save execution policy</button></div></div></fieldset></form>`,
	summary: 'Risk scope, random novelty, reserves, timing, and ecosystems · editable while paused',
	title: 'Execution policy',
})

/** The Settings page: Connect, Execution policy, and Go live; the pause note sits under the chip row. */
export const settingsPageMarkup = settingsPage({
	intro: settingsIntro({ aside: '<span id="settings-scope" class="badge neutral">Configuration loading</span>', eyebrow: 'Safety controls', scopeText: 'Changes apply before the next selection cycle.' }),
	notices:
		'<div id="configuration-status" class="notice hidden" role="status" data-page-content="settings"></div><div id="settings-pause-note" class="notice warning hidden" role="status" data-page-content="settings">Execution policy and execution mode are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, ecosystem scope, or the live switch.</div>',
	sections: [
		settingsSection({ groups: connectivityPanel, id: 'settings-connect', step: 1, title: 'Connect' }),
		settingsSection({ groups: policyPanel, id: 'settings-policy', step: 2, title: 'Execution policy' }),
		settingsSection({
			groups:
				signerPanel({ rememberLabel: "Remember in the bot's owner-only state directory", summary: 'No signer configured', title: 'Transaction signer' }) +
				executionModePanel({
					note: 'Off is dry-run mode. Live mode can spend gas and protocol assets.',
					switchLabel: 'Submit live transactions',
				}),
			id: 'settings-go-live',
			step: 3,
			title: 'Go live',
		}),
	].join(''),
	steps: [
		{ id: 'settings-connect', label: 'Connect', step: 1 },
		{ id: 'settings-policy', label: 'Execution policy', step: 2 },
		{ id: 'settings-go-live', label: 'Go live', step: 3 },
	],
})
