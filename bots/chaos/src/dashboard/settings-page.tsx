/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The chaos bot does not depend on Preact itself, so it uses the classic factory re-exported by the shared renderer.
import { DescribedSwitch, ExecutionModePanel, SettingsGroup, SettingsIntro, SettingsPage, SettingsSection, SignerPanel } from '@zoltar/bot-shared/dashboard/settings-markup'
import { Fragment, h, renderStaticMarkup } from '@zoltar/bot-shared/dashboard/static-markup'

function UnitField({ id, label, max, min, unit }: { id: string; label: string; max: string; min: string; unit: string }) {
	return (
		<label>
			<span>{label}</span>
			<span class='input-with-unit'>
				<input id={id} min={min} max={max} inputmode='numeric' type='number' required />
				<span>{unit}</span>
			</span>
		</label>
	)
}

function DecimalField({ id, label }: { id: string; label: string }) {
	return (
		<label>
			<span>{label}</span>
			<input id={id} inputmode='decimal' type='text' required />
		</label>
	)
}

function ConnectivityPanel() {
	return (
		<SettingsGroup id='network-connectivity' summary='Server-side endpoint and chain verification' title='Chain and RPC connectivity'>
			<form id='connectivity-form'>
				<fieldset id='connectivity-fields' disabled>
					<p class='notice'>
						RPC checks run from the chaos-bot server. Docker service URLs such as <code>http://reth:8545</code> work only when that process shares the service's container network. Saved endpoint URLs remain visible here so the active configuration can be reviewed and edited.
					</p>
					<div class='field-grid'>
						<label>
							<span>Primary read RPC</span>
							<input id='read-rpc-url' autocomplete='off' placeholder='http://reth:8545' spellcheck={false} type='url' required />
						</label>
						<label>
							<span>RPC agreement</span>
							<select id='rpc-quorum'>
								<option value='1'>One healthy reader</option>
								<option value='2'>Two agreeing readers</option>
							</select>
						</label>
						<label class='field-grid-wide'>
							<span>Independent quorum read RPCs</span>
							<textarea id='quorum-rpc-urls' autocomplete='off' placeholder='One URL per line' rows={3} spellcheck={false} />
						</label>
						<label class='field-grid-wide'>
							<span>Public submission RPCs</span>
							<textarea id='public-rpc-urls' autocomplete='off' placeholder='One URL per line' rows={3} spellcheck={false} required />
						</label>
					</div>
					<div class='form-actions'>
						<span id='connectivity-status' class='action-status muted' role='status' aria-live='polite' />
						<div class='button-group'>
							<button id='discard-connectivity' class='button button-secondary' type='button' disabled>
								Discard RPC draft
							</button>
							<button id='save-connectivity' class='button' type='submit'>
								Check and save RPCs
							</button>
						</div>
					</div>
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function PolicySwitches() {
	return (
		<>
			<DescribedSwitch description='Includes disputes, auction participation, and other economically adversarial workflows.' id='allow-high-risk' label='Allow high-risk operations' name='allowHighRiskOperations' />
			<DescribedSwitch danger description='Includes forks, REP migration, burns, and global lifecycle transitions.' id='allow-irreversible' label='Allow irreversible operations' name='allowIrreversibleOperations' />
			<DescribedSwitch
				description='Continuously completes the exact genesis topology: binary question, origin security pool, wallet vault, external REP/WETH Uniswap pool creation, initialization, and seeding, Statoblast trading roots, canonical trading pair, and initial pair liquidity. Only these initializer operations bypass the selectable allowlist.'
				id='initialize-genesis-universe'
				label='Initialize genesis universe'
				name='initializeGenesisUniverse'
			/>
			<DescribedSwitch
				description={
					<>
						Turn this off for a staged rollout, then enable operations in the{' '}
						<a id='selectable-operation-catalog-link' class='text-link' href='/catalog'>
							Operation catalog
						</a>
						. An empty allowlist runs lifecycle obligations only unless genesis initialization is enabled; only its ordered initializer operations are exempt. Lifecycle discovery, recovery, and execution are never disabled by this control.
					</>
				}
				id='all-selectable-operations'
				label='Allow every selectable operation'
				name='allSelectableOperations'
			/>
		</>
	)
}

const ECOSYSTEM_SWITCHES = [
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'Open Oracle'],
	['trading', 'Trading'],
] as const

function PolicyPanel() {
	return (
		<SettingsGroup
			badges={
				<span id='settings-draft-status' class='settings-badge' data-kind='dirty' role='status' hidden>
					Unsaved changes
				</span>
			}
			summary='Risk scope, random novelty, reserves, timing, and ecosystems · editable while paused'
			title='Execution policy'
		>
			<form id='settings-form'>
				<fieldset id='settings-fields' disabled>
					<PolicySwitches />
					<label class='selectable-operation-allowlist-label' for='selectable-operation-allowlist'>
						<span>Selectable operation allowlist</span>
						<textarea id='selectable-operation-allowlist' aria-describedby='all-selectable-operations-help' placeholder={'One exact definition ID per line, for example:\nopen-oracle.weth.wrap'} rows={5} spellcheck={false} />
					</label>
					<div class='field-grid'>
						<UnitField id='min-delay' label='Minimum random delay' max='3599' min='60' unit='seconds' />
						<UnitField id='max-delay' label='Maximum random delay' max='3600' min='60' unit='seconds' />
						<DecimalField id='reserve-eth' label='ETH reserve' />
						<DecimalField id='reserve-rep' label='REP reserve' />
						<DecimalField id='maximum-eth-operation' label='Maximum ETH per operation' />
						<DecimalField id='maximum-gas-cost' label='Maximum gas cost (ETH)' />
						<DecimalField id='maximum-rep-operation' label='Maximum REP per operation' />
						<UnitField id='workflow-valid-blocks' label='Workflow validity' max='1000000' min='243' unit='blocks' />
					</div>
					<fieldset class='ecosystem-controls'>
						<legend>Enabled ecosystems</legend>
						{ECOSYSTEM_SWITCHES.map(([id, label]) => (
							<label class='switch-field'>
								<input data-ecosystem-toggle={id} type='checkbox' />
								<span>{label}</span>
							</label>
						))}
					</fieldset>
					<div class='form-actions'>
						<span id='settings-save-status' class='action-status muted' role='status' aria-live='polite' />
						<div class='button-group'>
							<button id='discard-settings' class='button button-secondary' type='button' disabled>
								Discard changes
							</button>
							<button id='save-settings' class='button' type='submit'>
								Save execution policy
							</button>
						</div>
					</div>
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

const STEPS = [
	{ id: 'settings-connect', label: 'Connect', step: 1 },
	{ id: 'settings-policy', label: 'Execution policy', step: 2 },
	{ id: 'settings-go-live', label: 'Go live', step: 3 },
]

/** The Settings page: Connect, Execution policy, and Go live; the pause note sits under the chip row. */
function ChaosSettingsPage() {
	return (
		<SettingsPage
			intro={
				<SettingsIntro
					aside={
						<span id='settings-scope' class='badge neutral'>
							Configuration loading
						</span>
					}
					eyebrow='Safety controls'
					scopeText='Changes apply before the next selection cycle.'
				/>
			}
			notices={
				<>
					<div id='configuration-status' class='notice hidden' role='status' data-page-content='settings' />
					<div id='settings-pause-note' class='notice warning hidden' role='status' data-page-content='settings'>
						Execution policy and execution mode are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, ecosystem scope, or the live switch.
					</div>
				</>
			}
			steps={STEPS}
		>
			<SettingsSection id='settings-connect' step={1} title='Connect'>
				<ConnectivityPanel />
			</SettingsSection>
			<SettingsSection id='settings-policy' step={2} title='Execution policy'>
				<PolicyPanel />
			</SettingsSection>
			<SettingsSection id='settings-go-live' step={3} title='Go live'>
				<SignerPanel rememberLabel="Remember in the bot's owner-only state directory" summary='No signer configured' title='Transaction signer' />
				<ExecutionModePanel note='Off is dry-run mode. Live mode can spend gas and protocol assets.' switchLabel='Submit live transactions' />
			</SettingsSection>
		</SettingsPage>
	)
}

export const settingsPageMarkup = renderStaticMarkup(<ChaosSettingsPage />)
