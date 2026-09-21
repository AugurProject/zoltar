import { rpcConnectivityFields } from '@zoltar/bot-shared/dashboard/rpc-connectivity'
import { executionModePanel, formActions, settingsGroup, settingsIntro, settingsPage, settingsSection, signerPanel, submissionPanel, switchField } from '@zoltar/bot-shared/dashboard/settings-markup'

// All inputs are repository-owned markup, never request or runtime data.

function decimalField(label: string, name: string) {
	return `<label><span>${label}</span><input name="${name}" inputmode="decimal" /></label>`
}

function integerField(label: string, name: string) {
	return `<label><span>${label}</span><input name="${name}" inputmode="numeric" /></label>`
}

const connectivityPanel = settingsGroup({
	body: `<form id="network-form"><fieldset id="network-fields" disabled>${rpcConnectivityFields({ independentQuorum: true, statusId: 'network-status' })}</fieldset></form><div id="rpc-endpoint-health" class="rpc-health-grid" aria-label="RPC endpoint health"></div>`,
	formId: 'network-form',
	id: 'network-connectivity',
	summary: 'No profile selected',
	summaryId: 'network-scope-summary',
	title: 'Chain and RPC connectivity',
})

const universesPanel = settingsGroup({
	body: '<div id="universe-rows" class="universe-explorer"><p class="empty">Scanning universe registry…</p></div>',
	summary: 'Choose one truthful path through the universe tree',
	title: 'Approved universes',
	titleId: 'universes-title',
})

const marketPanel = settingsGroup({
	body: `<form id="market-configuration-form"><fieldset id="market-configuration-fields" disabled><label><span>Pool targets and per-universe market JSON</span><textarea id="market-configuration-json" class="configuration-json mono" rows="18" spellcheck="false" required></textarea></label><p class="section-note">Root REP belongs under <code>root</code>; exact child assets belong under <code>children</code>; missing origin pools belong under <code>desiredPools</code>.</p>${formActions({ statusId: 'market-configuration-save-status', submitLabel: 'Validate &amp; save markets' })}</fieldset></form>`,
	formId: 'market-configuration-form',
	summary: 'Source policy, child REP markets, and desired pools',
	title: 'Market and pool configuration',
})

const economicsFields = [
	decimalField('Minimum liquidation debt (ETH)', 'minimumLiquidationDebtEth'),
	decimalField('Maximum liquidation debt (ETH)', 'maximumLiquidationDebtEth'),
	decimalField('Minimum reward (ETH)', 'minimumRewardValueEth'),
	decimalField('Maximum gas cost (ETH)', 'maximumGasCostEth'),
	decimalField('Maximum oracle cost (ETH)', 'maximumOracleRequestCostEth'),
	decimalField('Fallback REP / ETH price', 'fallbackRepPerEthPrice'),
].join('')

const inventoryFields = [
	decimalField('Wallet REP reserve', 'walletReserveRep'),
	decimalField('REP per pool limit', 'maximumPerPoolRep'),
	decimalField('Total deployed REP limit', 'maximumTotalDeployedRep'),
	decimalField('Minimum REP withdrawal', 'minimumRepWithdrawalRep'),
	decimalField('Redeem fees above (ETH)', 'redeemFeesAboveEth'),
	integerField('Top-up health (bps)', 'vaultTopUpHealthBps'),
	integerField('Target health (bps)', 'vaultTargetHealthBps'),
	integerField('Withdrawal health (bps)', 'vaultWithdrawHealthBps'),
].join('')

const timingFields = [
	integerField('Stale-price funding buffer (bps)', 'stalePriceFundingBufferBps'),
	integerField('Staged timeout (seconds)', 'stagedOperationValidForSeconds'),
	'<label><span>Latest log window (1–256 blocks)</span><input name="logLookbackBlocks" type="number" min="1" max="256" step="1" /></label>',
	'<label><span>Candidate priority</span><select name="candidatePriority"><option value="largest-bonus">Largest bonus</option><option value="largest-debt">Largest debt moved</option><option value="lowest-top-up">Lowest REP top-up</option></select></label>',
	switchField({ id: 'historical-log-recovery', label: 'Enable historical recovery backfill', name: 'historicalLogRecovery' }),
].join('')

const automationSwitches = [
	switchField({ id: 'allow-automatic-deposits', label: 'Automatic REP deposits', name: 'allowAutomaticDeposits' }),
	switchField({ id: 'allow-automatic-pool-creation', label: 'Create missing desired pools', name: 'allowAutomaticPoolCreation' }),
	switchField({ id: 'allow-automatic-vault-migrations', label: 'Automatic approved-universe vault migrations', name: 'allowAutomaticVaultMigrations' }),
	switchField({ id: 'allow-automatic-withdrawals', label: 'Automatic REP withdrawals', name: 'allowAutomaticWithdrawals' }),
].join('')

const strategyPanel = settingsGroup({
	body: `<form id="strategy-form"><fieldset id="strategy-fields" disabled><fieldset class="settings-subgroup"><legend>Economics</legend><div class="field-grid">${economicsFields}</div></fieldset><fieldset class="settings-subgroup"><legend>Inventory and vault health</legend><div class="field-grid">${inventoryFields}</div><p id="health-policy-preview" class="policy-preview">Vault health policy —</p></fieldset><fieldset id="log-scan-settings" class="settings-subgroup"><legend>Timing and automation</legend><div class="field-grid">${timingFields}</div><p class="section-note">Normal recovery checks only the configured latest window, newest first. Historical backfill is off by default; when enabled, it walks older required blocks newest first and saves each successful chunk.</p><div class="field-grid">${automationSwitches}</div></fieldset>${formActions({ statusId: 'strategy-status', submitLabel: 'Save strategy' })}</fieldset></form>`,
	formId: 'strategy-form',
	summary: 'Economics, inventory, vault health, timing, and automated actions',
	title: 'Strategy and automation',
	titleId: 'strategy-title',
})

/** The Settings page: Connect, Markets, Liquidation policy, and Go live. */
export const settingsPageMarkup = settingsPage({
	intro: settingsIntro({ scopeText: 'Select a chain profile first. Every setting and durable recovery record is stored separately for that chain.' }),
	sections: [
		settingsSection({ groups: connectivityPanel, id: 'settings-connect', step: 1, title: 'Connect' }),
		settingsSection({ groups: universesPanel + marketPanel, id: 'settings-markets', step: 2, title: 'Markets' }),
		settingsSection({ groups: strategyPanel, id: 'settings-policy', step: 3, title: 'Liquidation policy' }),
		settingsSection({
			groups:
				signerPanel({ summary: 'No active signer' }) +
				submissionPanel({ note: 'Liquidations, vault maintenance, and ETH-funded stale-price requests all use this delivery policy. Private relays are checked against the selected chain before they are saved.' }) +
				executionModePanel({ note: 'Enabling pauses the bot and reserves the signer for this process; it signs only after you resume through the readiness check. Dry run keeps scanning and reporting candidates without sending transactions.' }),
			id: 'settings-go-live',
			step: 4,
			title: 'Go live',
		}),
	].join(''),
	steps: [
		{ id: 'settings-connect', label: 'Connect', step: 1 },
		{ id: 'settings-markets', label: 'Markets', step: 2 },
		{ id: 'settings-policy', label: 'Liquidation policy', step: 3 },
		{ id: 'settings-go-live', label: 'Go live', step: 4 },
	],
})
