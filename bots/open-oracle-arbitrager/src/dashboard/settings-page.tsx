/** @jsxImportSource preact */
import { rpcConnectivityFields } from '@zoltar/bot-shared/dashboard/rpc-connectivity'
import { ExecutionModePanel, FormActions, SettingsGroup, SettingsIntro, SettingsPage, SettingsSection, SignerPanel, SubmissionPanel, SwitchField } from '@zoltar/bot-shared/dashboard/settings-markup'
import { RawMarkup, renderStaticMarkup } from '@zoltar/bot-shared/dashboard/static-markup'

// Everything here is repository-owned markup rendered once on the server, never request or runtime data.

type NumberFieldProps = { label: string; max?: string; min: string; name: string; step?: string }

function NumberField({ label, max, min, name, step }: NumberFieldProps) {
	return (
		<label>
			<span>{label}</span>
			<input name={name} type='number' min={min} max={max} step={step} required />
		</label>
	)
}

function ConnectivityPanel() {
	return (
		<SettingsGroup formId='connectivity-form' id='network-connectivity' summary='Unknown network' summaryId='network-value' title='Chain and RPC connectivity'>
			<p id='network-target-status' class='muted' role='status' aria-live='polite' hidden />
			<p class='section-note'>Every endpoint is checked against the selected chain before it is accepted.</p>
			<form id='connectivity-form'>
				<fieldset id='connectivity-fieldset' disabled>
					<RawMarkup html={rpcConnectivityFields({ independentQuorum: true, statusId: 'connectivity-status', statusText: '', submissionLimit: 8, submitLabel: 'Save RPC endpoints' })} />
				</fieldset>
				<div id='profile-switch-retry-actions' class='form-actions' hidden>
					<button id='profile-switch-retry-button' class='button button-secondary' type='button' hidden>
						Retry profile load
					</button>
				</div>
			</form>
			<div id='endpoint-checks' class='endpoint-checks' role='group' aria-label='Endpoint health checks' />
		</SettingsGroup>
	)
}

function UniversesPanel() {
	return (
		<SettingsGroup formId='tokens-form' summary='Only explicitly approved universe REP can be traded' title='Approved universes'>
			{/* The explorer's search, filter, and row checkboxes stay outside the form so only the approved selection marks it unsaved. */}
			<div id='approved-universes' class='universe-explorer'>
				Universe discovery has not completed.
			</div>
			<form id='tokens-form'>
				<fieldset id='tokens-fieldset' disabled>
					<p class='section-note'>Existing positions continue recovery after a change.</p>
					<FormActions statusId='tokens-status' submitLabel='Save universe approvals' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function VenuesPanel() {
	return (
		<SettingsGroup formId='deployment-form' id='deployment-configuration' summary='Uniswap versions and the executor contract' title='Venues and executor'>
			<form id='deployment-form'>
				<fieldset id='deployment-fieldset' disabled>
					<div class='deployment-grid'>
						<div class='derived-contract'>
							<span>Derived executor</span>
							<p id='deployment-executor' class='mono'>
								Loading deployment…
							</p>
						</div>
						<div class='derived-contract'>
							<span>Pool coordinators</span>
							<p id='deployment-coordinators' class='mono' tabindex={0} aria-label='Discovered pool coordinators'>
								Discovered from approved universes.
							</p>
						</div>
						<SwitchField id='deployment-v2-enabled' label='Enable Uniswap V2 · mainnet only' />
						<SwitchField id='deployment-v3-enabled' label='Enable Uniswap V3' />
						<SwitchField id='deployment-v4-enabled' label='Enable Uniswap V4' />
					</div>
					<p class='section-note'>Uniswap addresses follow the selected network. Each enabled version supplies its own prices; the TWAP check applies to V3.</p>
					<FormActions statusId='deployment-status' submitLabel='Save venues' />
				</fieldset>
			</form>
			<form id='create2-form' class='create2-form'>
				<fieldset id='create2-fieldset' disabled>
					<p class='section-note'>Deploys through the canonical deterministic proxy with the active signer.</p>
					<div id='create2-recovery' class='notice' data-tone='danger' aria-live='polite' hidden>
						<strong>Recovery required</strong>
						<span id='create2-recovery-copy' />
					</div>
					<FormActions statusId='create2-status' submitId='deploy-executor-button' submitLabel='Deploy predictable executor' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function MarketSourceTable() {
	return (
		<>
			<div class='table-scroll' role='region' tabindex={0} aria-label='Centralized market sources'>
				<table class='market-source-table'>
					<thead>
						<tr>
							<th scope='col'>Exchange · CCXT id</th>
							<th scope='col'>REP market</th>
							<th scope='col'>ETH market · blank when quoted in ETH</th>
							<th scope='col'>
								<span class='visually-hidden'>Remove</span>
							</th>
						</tr>
					</thead>
					<tbody id='market-source-rows' />
				</table>
			</div>
			<div class='market-source-actions'>
				<p id='market-sources-empty' class='empty-state'>
					No centralized sources configured; the guard relies on DEX evidence only.
				</p>
				<button id='market-source-add' class='button button-secondary' type='button'>
					Add source
				</button>
			</div>
		</>
	)
}

const venueConsensusFields = [
	['dexProbeDepthEth', 'DEX probe depth (ETH)', '0', 'any'],
	['maximumGroupDeviationBps', 'Maximum group deviation (bps)', '1', '1'],
	['minimumDexAskDepthEth', 'Minimum DEX ask depth (ETH)', '0', 'any'],
	['minimumDexBidDepthEth', 'Minimum DEX bid depth (ETH)', '0', 'any'],
	['minimumDexSourceCount', 'Minimum DEX sources', '1', '1'],
	['minimumSourceObservationCount', 'Observations per source', '1', '1'],
	['minimumSourceObservationSpanMilliseconds', 'Observation span (ms)', '0', '1'],
	['minimumTotalSourceCount', 'Minimum total sources', '2', '1'],
] as const

function VenueConsensusForm() {
	return (
		<fieldset class='settings-subpanel'>
			<legend>Venue consensus</legend>
			<SwitchField id='venue-consensus-enabled' label='Use DEX venue consensus' />
			<div class='field-grid'>
				{venueConsensusFields.map(([name, label, min, step]) => (
					<NumberField key={name} label={label} min={min} name={`venue-${name}`} step={step} />
				))}
			</div>
			<SwitchField id='venue-allow-single-group-fallback' label='Allow one venue group when the other is unavailable' />
			<div class='table-scroll' role='region' tabindex={0} aria-label='Venue consensus DEX sources'>
				<table>
					<thead>
						<tr>
							<th scope='col'>Source ID</th>
							<th scope='col'>Pair address</th>
							<th scope='col'>Fee (bps)</th>
							<th scope='col'>Action</th>
						</tr>
					</thead>
					<tbody id='venue-dex-source-rows' />
				</table>
			</div>
			<button id='venue-dex-source-add' class='button button-secondary' type='button'>
				Add DEX source
			</button>
		</fieldset>
	)
}

function MarketPanel() {
	return (
		<SettingsGroup formId='market-form' summary='Centralized exchanges and consensus thresholds for the reference price' title='REP market sources'>
			<form id='market-form'>
				<fieldset id='market-fieldset' disabled>
					<MarketSourceTable />
					<SwitchField id='market-required' label='Require market consensus before execution' leading />
					<div class='field-grid'>
						<NumberField label='Minimum sources' name='minimumSourceCount' min='1' max='100' step='1' />
						<NumberField label='Depth band (bps)' name='depthBps' min='1' max='5000' step='1' />
						<NumberField label='Maximum venue dispersion (bps)' name='maximumVenueDispersionBps' min='1' max='10000' step='1' />
						<NumberField label='Maximum DEX deviation (bps)' name='maximumDexDeviationBps' min='1' max='10000' step='1' />
						<NumberField label='Minimum bid depth (ETH)' name='minimumBidDepthEth' min='0' step='any' />
						<NumberField label='Minimum ask depth (ETH)' name='minimumAskDepthEth' min='0' step='any' />
						<NumberField label='Observation max age (ms)' name='maximumObservationAgeMilliseconds' min='1000' max='3600000' step='1' />
						<NumberField label='Request timeout (ms)' name='requestTimeoutMilliseconds' min='250' max='60000' step='1' />
						<NumberField label='Order book depth (levels)' name='orderBookLimit' min='1' max='1000' step='1' />
					</div>
					<VenueConsensusForm />
					<p class='section-note'>Source changes discard prior evidence before a replacement source can authorize execution.</p>
					<FormActions statusId='market-status' submitLabel='Save market sources' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function StrategyPanel() {
	return (
		<SettingsGroup formId='strategy-form' summary='Profit threshold, price safety, and timing' title='Strategy'>
			<form id='strategy-form'>
				<fieldset id='strategy-fieldset' disabled>
					<div class='field-grid'>
						<NumberField label='Minimum profit (WETH)' name='minimumProfitWeth' min='0' max='1000' step='any' />
						<NumberField label='Minimum return (bps)' name='minimumProfitBps' min='0' max='100000' step='1' />
						<NumberField label='Maximum spot/TWAP ticks' name='maxSpotTwapTicks' min='0' max='100000' step='1' />
						<NumberField label='TWAP window (seconds)' name='twapSeconds' min='60' max='86400' />
						<NumberField label='Minimum remaining blocks' name='minimumRemainingBlocks' min='1' max='1000' step='1' />
						<NumberField label='Minimum remaining seconds' name='minimumRemainingSeconds' min='1' max='86400' step='1' />
					</div>
					<FormActions statusId='form-status' submitLabel='Save strategy' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function UsageMetric({ id, label }: { id: string; label: string }) {
	return (
		<div class='usage-metric'>
			<span>{label}</span>
			<strong id={id}>—</strong>
		</div>
	)
}

function RiskPanel() {
	return (
		<SettingsGroup formId='runtime-form' summary='Capital caps, gas budget, hedge slippage, event lookback, and polling' title='Risk limits and scanning'>
			<div id='risk-usage' class='usage-row' role='group' aria-label='Current risk usage'>
				<UsageMetric id='usage-locked' label='Locked now' />
				<UsageMetric id='usage-positions' label='Open positions' />
				<UsageMetric id='usage-daily-gas' label='Gas spent today' />
			</div>
			<form id='runtime-form'>
				<fieldset id='runtime-fieldset' disabled>
					<div class='field-grid'>
						<NumberField label='Maximum position notional (WETH)' name='maxPositionNotionalWeth' min='0' step='any' />
						<NumberField label='Maximum total locked (WETH)' name='maxTotalLockedWeth' min='0' step='any' />
						<NumberField label='Maximum concurrent positions' name='maxConcurrentPositions' min='1' max='1000' step='1' />
						<NumberField label='Maximum daily gas spend (ETH)' name='maxDailyGasSpendWeth' min='0' step='any' />
						<NumberField label='Lifecycle gas reserve (ETH)' name='lifecycleGasReserveWeth' min='0' step='any' />
						<NumberField label='Maximum hedge slippage (bps)' name='maxHedgeSlippageBps' min='0' max='1000' step='1' />
						<NumberField label='Event lookback (blocks · 0 disables)' name='logLookbackBlocks' min='0' max='256' step='1' />
						<NumberField label='Poll interval (milliseconds)' name='pollMilliseconds' min='1000' max='3600000' step='1' />
					</div>
					<p class='section-note'>Caps are rechecked before every entry; changing the lookback rebuilds the coordinator-free report window.</p>
					<FormActions statusId='runtime-status' submitLabel='Save risk limits' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function SettlementPanel() {
	return (
		<SettingsGroup formId='settlement-form' summary='Third-party settlement of reports the bot never disputed' summaryId='settlement-panel-summary' title='Settlement'>
			<form id='settlement-form'>
				<fieldset id='settlement-fieldset' disabled>
					<SwitchField id='settlement-enabled' label='Enable third-party settlement' leading />
					<div class='field-grid'>
						<NumberField label='Minimum net (ETH)' name='settlementMinimumProfitWeth' min='0' max='1' step='any' />
						<NumberField label='Settlement fee cap (nanoETH)' name='settlementMaxGasPriceNanoEth' min='0.000000001' max='10000' step='any' />
						<NumberField label='Reward withdraw threshold (ETH)' name='settlementRewardWithdrawThresholdEth' min='0.000000000000000001' max='100' step='any' />
					</div>
					<p class='section-note'>The fee cap also bounds the worst-case gas budget. Lower it to accept less fee exposure; settlement waits while current gas exceeds the cap. Profitability is checked each scan.</p>
					<FormActions statusId='settlement-status' submitLabel='Save settlement' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function ConfigurationPanel() {
	return (
		<SettingsGroup id='complete-configuration' open={false} summary='Copy the current operator file · save changes in the forms above' title='Complete configuration'>
			<div class='section-heading'>
				<button id='reload-configuration-button' class='button button-secondary' type='button' disabled>
					Reload configuration
				</button>
			</div>
			<form id='configuration-form'>
				<fieldset id='configuration-fieldset' disabled>
					<label>
						<span>Operator configuration JSON</span>
						<textarea id='configuration-json' class='configuration-json mono' rows={24} spellcheck={false} readOnly />
					</label>
					<span id='configuration-status' class='action-status muted' role='status' aria-live='polite' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function SettingsLoadState() {
	return (
		<div id='settings-load-state' class='notice settings-load-state' data-page-content='settings'>
			<span id='settings-load-status' role='status' aria-live='polite'>
				Loading operator configuration…
			</span>
			<button id='retry-settings-button' class='button button-secondary' type='button' hidden>
				Retry
			</button>
		</div>
	)
}

/** The Settings page: Connect, Markets, Trading policy, Go live, and Advanced, with the load-state notice under the chip row. */
function ArbitragerSettingsPage() {
	return (
		<SettingsPage
			intro={<SettingsIntro scopeText='Select a chain profile first.' />}
			notices={<SettingsLoadState />}
			steps={[
				{ id: 'settings-connect', label: 'Connect', step: 1 },
				{ id: 'settings-markets', label: 'Markets', step: 2 },
				{ id: 'settings-policy', label: 'Trading policy', step: 3 },
				{ id: 'settings-go-live', label: 'Go live', step: 4 },
				{ id: 'settings-advanced', label: 'Advanced' },
			]}
		>
			<SettingsSection id='settings-connect' step={1} title='Connect'>
				<ConnectivityPanel />
			</SettingsSection>
			<SettingsSection id='settings-markets' step={2} title='Markets'>
				<UniversesPanel />
				<VenuesPanel />
				<MarketPanel />
			</SettingsSection>
			<SettingsSection id='settings-policy' step={3} title='Trading policy'>
				<StrategyPanel />
				<RiskPanel />
				<SettlementPanel />
			</SettingsSection>
			<SettingsSection id='settings-go-live' step={4} title='Go live'>
				<SignerPanel forgetButton />
				<SubmissionPanel note='Both delivery modes submit one parent-bound atomic entry transaction and require sufficient pre-existing ERC-20 and OpenOracle internal allowances before an opportunity is eligible.' />
				<ExecutionModePanel note='Enabling pauses the bot; it activates at the next scan boundary and signs only after you resume through the readiness check.' />
			</SettingsSection>
			<SettingsSection collapsed id='settings-advanced' title='Advanced'>
				<ConfigurationPanel />
			</SettingsSection>
		</SettingsPage>
	)
}

export const settingsPageMarkup = renderStaticMarkup(<ArbitragerSettingsPage />)
