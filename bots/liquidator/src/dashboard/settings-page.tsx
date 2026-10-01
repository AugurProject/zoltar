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
		<SettingsGroup formId='market-configuration-form' summary='Source policy, child REP markets, and desired pools' title='Market and pool configuration'>
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
		<SettingsGroup formId='strategy-form' summary='Economics, inventory, vault health, timing, and automated actions' title='Strategy and automation' titleId='strategy-title'>
			<form id='strategy-form'>
				<fieldset id='strategy-fields' disabled>
					<fieldset class='settings-subgroup'>
						<legend>Economics</legend>
						<div class='field-grid'>
							<DecimalField label='Minimum liquidation debt (ETH)' name='minimumLiquidationDebtEth' />
							<DecimalField label='Maximum liquidation debt (ETH)' name='maximumLiquidationDebtEth' />
							<DecimalField label='Minimum reward (ETH)' name='minimumRewardValueEth' />
							<DecimalField label='Maximum gas cost (ETH)' name='maximumGasCostEth' />
							<DecimalField label='Maximum oracle cost (ETH)' name='maximumOracleRequestCostEth' />
							<DecimalField label='Fallback REP / ETH price' name='fallbackRepPerEthPrice' />
						</div>
					</fieldset>
					<fieldset class='settings-subgroup'>
						<legend>Inventory and vault health</legend>
						<div class='field-grid'>
							<DecimalField label='Wallet REP reserve' name='walletReserveRep' />
							<DecimalField label='REP per pool limit' name='maximumPerPoolRep' />
							<DecimalField label='Total deployed REP limit' name='maximumTotalDeployedRep' />
							<DecimalField label='Minimum REP withdrawal' name='minimumRepWithdrawalRep' />
							<DecimalField label='Redeem fees above (ETH)' name='redeemFeesAboveEth' />
							<IntegerField label='Top-up health (bps)' name='vaultTopUpHealthBps' />
							<IntegerField label='Target health (bps)' name='vaultTargetHealthBps' />
							<IntegerField label='Withdrawal health (bps)' name='vaultWithdrawHealthBps' />
						</div>
						<p id='health-policy-preview' class='policy-preview'>
							Vault health policy —
						</p>
					</fieldset>
					<fieldset id='log-scan-settings' class='settings-subgroup'>
						<legend>Timing and automation</legend>
						<div class='field-grid'>
							<IntegerField label='Stale-price funding buffer (bps)' name='stalePriceFundingBufferBps' />
							<IntegerField label='Staged timeout (seconds)' name='stagedOperationValidForSeconds' />
							<label>
								<span>Latest log window (1–256 blocks)</span>
								<input name='logLookbackBlocks' type='number' min='1' max='256' step='1' />
							</label>
							<label>
								<span>Candidate priority</span>
								<select name='candidatePriority'>
									<option value='largest-bonus'>Largest bonus</option>
									<option value='largest-debt'>Largest debt moved</option>
									<option value='lowest-top-up'>Lowest REP top-up</option>
								</select>
							</label>
							<SwitchField id='historical-log-recovery' label='Enable historical recovery backfill' name='historicalLogRecovery' />
						</div>
						<p class='section-note'>Normal recovery checks only the configured latest window, newest first. Historical backfill is off by default; when enabled, it walks older required blocks newest first and saves each successful chunk.</p>
						<div class='field-grid'>
							<SwitchField id='allow-automatic-deposits' label='Automatic REP deposits' name='allowAutomaticDeposits' />
							<SwitchField id='allow-automatic-pool-creation' label='Create missing desired pools' name='allowAutomaticPoolCreation' />
							<SwitchField id='allow-automatic-vault-migrations' label='Automatic approved-universe vault migrations' name='allowAutomaticVaultMigrations' />
							<SwitchField id='allow-automatic-withdrawals' label='Automatic REP withdrawals' name='allowAutomaticWithdrawals' />
						</div>
					</fieldset>
					<FormActions statusId='strategy-status' submitLabel='Save strategy' />
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
				<SignerPanel summary='No active signer' />
				<SubmissionPanel note='Liquidations, vault maintenance, and ETH-funded stale-price requests all use this delivery policy. Private relays are checked against the selected chain before they are saved.' />
				<ExecutionModePanel note='Enabling pauses the bot and reserves the signer for this process; it signs only after you resume through the readiness check. Dry run keeps scanning and reporting candidates without sending transactions.' />
			</SettingsSection>
		</SettingsPage>
	)
}

export const settingsPageMarkup = renderStaticMarkup(<LiquidatorSettingsPage />)
