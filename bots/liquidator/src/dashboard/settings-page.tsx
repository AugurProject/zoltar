/** @jsxImportSource preact */
import { rpcConnectivityFields } from '@zoltar/bot-shared/dashboard/rpc-connectivity'
import { ExecutionModePanel, FormActions, SettingsGroup, SettingsIntro, SettingsPage, SettingsSection, SignerPanel, SubmissionPanel, SwitchField } from '@zoltar/bot-shared/dashboard/settings-markup'
import { RawMarkup, renderStaticMarkup } from '@zoltar/bot-shared/dashboard/static-markup'

// Everything here is repository-owned markup rendered once on the server, never request or runtime data.

function DecimalField({ label, name }: { label: string; name: string }) {
	return (
		<label>
			<span>{label}</span>
			<input name={name} inputmode='decimal' />
		</label>
	)
}

function IntegerField({ label, name }: { label: string; name: string }) {
	return (
		<label>
			<span>{label}</span>
			<input name={name} inputmode='numeric' />
		</label>
	)
}

function ConnectivityPanel() {
	return (
		<SettingsGroup formId='network-form' id='network-connectivity' summary='No profile selected' summaryId='network-scope-summary' title='Chain and RPC connectivity'>
			<form id='network-form'>
				<fieldset id='network-fields' disabled>
					<RawMarkup html={rpcConnectivityFields({ independentQuorum: true, statusId: 'network-status' })} />
				</fieldset>
			</form>
			<div id='rpc-endpoint-health' class='rpc-health-grid' aria-label='RPC endpoint health' />
		</SettingsGroup>
	)
}

function UniversesPanel() {
	return (
		<SettingsGroup summary='Choose one truthful path through the universe tree' title='Approved universes' titleId='universes-title'>
			<div id='universe-rows' class='universe-explorer'>
				<p class='empty'>Scanning universe registry…</p>
			</div>
		</SettingsGroup>
	)
}

function MarketPanel() {
	return (
		<SettingsGroup formId='market-configuration-form' summary='Source policy and child REP markets' title='Market configuration'>
			<form id='market-configuration-form'>
				<fieldset id='market-configuration-fields' disabled>
					<div id='market-configuration-editor' />
					<FormActions statusId='market-configuration-save-status' submitLabel='Review and save markets' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

function StrategyPanel() {
	return (
		<SettingsGroup formId='strategy-form' summary='Funded takeovers, capital limits, and recovery' title='Portfolio policy' titleId='strategy-title'>
			<form id='strategy-form'>
				<fieldset id='strategy-fields' disabled>
					<fieldset class='settings-subgroup'>
						<legend>Automation and rewards</legend>
						<div class='field-grid'>
							<SwitchField id='allow-funded-takeovers' label='Funded takeovers and earnings claims' name='allowFundedTakeovers' />
							<DecimalField label='Minimum net reward (ETH)' name='minimumNetRewardEth' />
							<DecimalField label='Maximum gas cost (ETH)' name='maximumGasCostEth' />
							<DecimalField label='Wallet ETH reserve' name='walletReserveEth' />
							<DecimalField label='Wallet REP reserve' name='walletReserveRep' />
						</div>
					</fieldset>
					<fieldset class='settings-subgroup'>
						<legend>Capital limits</legend>
						<div class='field-grid'>
							<DecimalField label='Principal per portfolio (REP)' name='maximumPrincipalRep' />
							<DecimalField label='Total managed principal (REP)' name='maximumTotalPrincipalRep' />
							<DecimalField label='Commitment per portfolio (ETH)' name='maximumCommitmentEth' />
							<DecimalField label='Own funding per takeover (REP)' name='maximumOwnFundingRep' />
							<IntegerField label='Target health (bps)' name='targetHealthFactorBps' />
						</div>
						<p id='health-policy-preview' class='policy-preview'>
							Receiver health target —
						</p>
					</fieldset>
					<fieldset id='log-scan-settings' class='settings-subgroup'>
						<legend>Scanning and recovery</legend>
						<div class='field-grid'>
							<IntegerField label='Positions per scan (1–256)' name='maximumPositionsPerScan' />
							<IntegerField label='Stalled retirement (seconds)' name='stalledRetirementSeconds' />
							<label>
								<span>Latest log window (1–256 blocks)</span>
								<input name='logLookbackBlocks' type='number' min='1' max='256' step='1' />
							</label>
							<SwitchField id='historical-log-recovery' label='Enable historical recovery backfill' name='historicalLogRecovery' />
						</div>
						<p class='section-note'>Historical recovery is off by default. When enabled, it checks older required blocks newest first and saves completed chunks.</p>
					</fieldset>
					<FormActions statusId='strategy-status' submitLabel='Save policy' />
				</fieldset>
			</form>
		</SettingsGroup>
	)
}

/** The Settings page: Connect, Markets, Liquidation policy, and Go live. */
function LiquidatorSettingsPage() {
	return (
		<SettingsPage
			intro={<SettingsIntro scopeText='Select a chain profile first. Every setting and durable recovery record is stored separately for that chain.' />}
			steps={[
				{ id: 'settings-connect', label: 'Connect', step: 1 },
				{ id: 'settings-markets', label: 'Markets', step: 2 },
				{ id: 'settings-policy', label: 'Liquidation policy', step: 3 },
				{ id: 'settings-go-live', label: 'Go live', step: 4 },
			]}
		>
			<SettingsSection id='settings-connect' step={1} title='Connect'>
				<ConnectivityPanel />
			</SettingsSection>
			<SettingsSection id='settings-markets' step={2} title='Markets'>
				<UniversesPanel />
				<MarketPanel />
			</SettingsSection>
			<SettingsSection id='settings-policy' step={3} title='Liquidation policy'>
				<StrategyPanel />
			</SettingsSection>
			<SettingsSection id='settings-go-live' step={4} title='Go live'>
				<SignerPanel summary='No active signer' title='Execution signer' />
				<SubmissionPanel note='Portfolio takeovers and earnings claims use this delivery policy. Private relays are checked against the selected chain before they are saved.' />
				<ExecutionModePanel note='Enabling pauses the bot and reserves the signer for this process; it signs only after you resume through the readiness check. Dry run keeps scanning and reporting candidates without sending transactions.' />
			</SettingsSection>
		</SettingsPage>
	)
}

export const settingsPageMarkup = renderStaticMarkup(<LiquidatorSettingsPage />)
