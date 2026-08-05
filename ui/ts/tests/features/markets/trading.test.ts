/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import {
	MARKET_NOT_FINALIZED_MESSAGE,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_COVERAGE_COMMITMENT_MESSAGE,
	SHARE_MIGRATION_AFTER_FORK_MESSAGE,
	convertSettlementCollateralAttoEthToAttoShares,
	convertAttoSharesToSettlementCollateralAttoEth,
	formatStatoblastSecurityMultiplier,
	getCollateralizationDisplayState,
	getCollateralizationTone,
	getDefaultShareMigrationTargetOutcomeIndexes,
	getMaxRedeemableCompleteSets,
	getPoolCollateralizationPercent,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingGuardDisplayMessage,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	getVaultCollateralizationPercent,
	hasRepBackedPoolWithNoActiveCoverageCommitment,
	isTradingSystemDeployed,
} from '../../../features/markets/lib/trading.js'
import { getScalarOutcomeIndex } from '../../../features/markets/lib/scalarOutcome.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '../../../types/contracts.js'

const TOKEN_PRECISION = 10n ** 18n

void describe('trading helpers', () => {
	const createDeploymentStep = (id: DeploymentStatus['id'], deployed: boolean): DeploymentStatus => ({
		address: zeroAddress,
		dependencies: [],
		deploy: async () => {
			throw new Error('Not implemented in test helper')
		},
		deployed,
		id,
		label: id,
	})

	const shareBalances = {
		invalidAttoShares: 2n * 10n ** 18n,
		noAttoShares: 4n * 10n ** 18n,
		yesAttoShares: 3n * 10n ** 18n,
	}
	const binaryForkUniverse = {
		childUniverses: [
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 0n,
				outcomeLabel: 'Invalid',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 10n,
			},
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 1n,
				outcomeLabel: 'Yes',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 11n,
			},
			{
				exists: true,
				forkTime: 1n,
				outcomeIndex: 2n,
				outcomeLabel: 'No',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 12n,
			},
		],
		forkThresholdAttoRep: 1n,
		forkQuestionDetails: {
			answerUnit: '',
			createdAt: 1n,
			description: '',
			displayValueMax: 0n,
			displayValueMin: 0n,
			endTime: 1n,
			exists: true,
			marketType: 'binary',
			numTicks: 0n,
			outcomeLabels: ['Yes', 'No'],
			questionId: '0x0000000000000000000000000000000000000000000000000000000000000001',
			startTime: 0n,
			title: 'Binary fork',
		},
		forkTime: 1n,
		forkingOutcomeIndex: 1n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 100n,
		universeId: 0n,
	} satisfies ZoltarUniverseSummary
	const scalarForkUniverse = {
		childUniverses: [],
		forkThresholdAttoRep: 1n,
		forkQuestionDetails: {
			answerUnit: 'km',
			createdAt: 1n,
			description: '',
			displayValueMax: 10n,
			displayValueMin: 0n,
			endTime: 1n,
			exists: true,
			marketType: 'scalar',
			numTicks: 10n,
			outcomeLabels: [],
			questionId: '0x0000000000000000000000000000000000000000000000000000000000000002',
			startTime: 0n,
			title: 'Scalar fork',
		},
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 100n,
		universeId: 0n,
	} satisfies ZoltarUniverseSummary

	void test('computes remaining mint capacity from fee-eligible coverage commitment and minted open interest', () => {
		expect(getRemainingMintCapacity(10n, 4n)).toBe(6n)
		expect(getRemainingMintCapacity(10n, 10n)).toBe(0n)
		expect(getRemainingMintCapacity(10n, 12n)).toBe(0n)
		expect(getRemainingMintCapacity(undefined, 12n)).toBeUndefined()
	})

	void test('treats the trading system as deployed only when every deterministic deployment step is deployed', () => {
		expect(isTradingSystemDeployed([])).toBe(false)
		expect(isTradingSystemDeployed([createDeploymentStep('proxyDeployer', true), createDeploymentStep('zoltar', true), createDeploymentStep('securityPoolFactory', true)])).toBe(true)
		expect(isTradingSystemDeployed([createDeploymentStep('proxyDeployer', true), createDeploymentStep('zoltar', true), createDeploymentStep('securityPoolFactory', false)])).toBe(false)
	})

	void test('computes pool collateralization as a percentage using the canonical REP/ETH price', () => {
		expect(getPoolCollateralizationPercent(3n * TOKEN_PRECISION, 2n * TOKEN_PRECISION, TOKEN_PRECISION)).toBe(150n * TOKEN_PRECISION)
		expect(getPoolCollateralizationPercent(undefined, 2n * TOKEN_PRECISION, TOKEN_PRECISION)).toBeUndefined()
		expect(getPoolCollateralizationPercent(3n * TOKEN_PRECISION, 2n * TOKEN_PRECISION, undefined)).toBeUndefined()
		expect(getPoolCollateralizationPercent(3n * TOKEN_PRECISION, 2n * TOKEN_PRECISION, 0n)).toBeUndefined()
	})

	void test('computes vault REP-backing collateralization as a percentage using the canonical REP/ETH price', () => {
		expect(getVaultCollateralizationPercent(4n * TOKEN_PRECISION, 2n * TOKEN_PRECISION, TOKEN_PRECISION)).toBe(200n * TOKEN_PRECISION)
		expect(getVaultCollateralizationPercent(4n * TOKEN_PRECISION, undefined, TOKEN_PRECISION)).toBeUndefined()
	})

	void test('marks collateralization green when it is at or above the security multiplier threshold', () => {
		expect(getCollateralizationTone(201n * TOKEN_PRECISION, 20_000n)).toBe('success')
		expect(getCollateralizationTone(200n * TOKEN_PRECISION, 20_000n)).toBe('success')
		expect(getCollateralizationTone(199n * TOKEN_PRECISION, 20_000n)).toBe('danger')
		expect(getCollateralizationTone(undefined, 20_000n)).toBeUndefined()
	})

	void test('formats Statoblast security multiplier basis points as fractional x values', () => {
		expect(formatStatoblastSecurityMultiplier(20_000n)).toBe('2')
		expect(formatStatoblastSecurityMultiplier(25_000n)).toBe('2.5')
		expect(formatStatoblastSecurityMultiplier(20_001n)).toBe('2.0001')
	})

	void test('surfaces no active coverage commitment separately from unavailable quotes', () => {
		expect(getCollateralizationDisplayState(0n, undefined)).toBe('noActiveCoverageCommitment')
		expect(getCollateralizationDisplayState(TOKEN_PRECISION, undefined)).toBe('unavailable')
		expect(getCollateralizationDisplayState(TOKEN_PRECISION, 150n * TOKEN_PRECISION)).toBe('value')
	})

	void test('returns zero percent when REP backing is zero but coverage commitment is active', () => {
		expect(getPoolCollateralizationPercent(0n, TOKEN_PRECISION, TOKEN_PRECISION)).toBe(0n)
	})

	void test('detects pools that have REP backing but no active coverage commitment', () => {
		expect(hasRepBackedPoolWithNoActiveCoverageCommitment(20n * 10n ** 18n, 0n)).toBe(true)
		expect(hasRepBackedPoolWithNoActiveCoverageCommitment(20n * 10n ** 18n, 1n)).toBe(false)
		expect(hasRepBackedPoolWithNoActiveCoverageCommitment(0n, 0n)).toBe(false)
	})

	void test('derives the max redeemable complete sets from wallet share balances', () => {
		expect(getMaxRedeemableCompleteSets(shareBalances)).toBe(2n * 10n ** 18n)
		expect(getMaxRedeemableCompleteSets(undefined)).toBeUndefined()
		expect(getSelectedOutcomeShareBalance(shareBalances, 'yes')).toBe(3n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'no')).toBe(4n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'invalid')).toBe(2n * 10n ** 18n)
		expect(getDefaultShareMigrationTargetOutcomeIndexes(binaryForkUniverse)).toBe('0, 1, 2')
		expect(getDefaultShareMigrationTargetOutcomeIndexes(scalarForkUniverse)).toBe('')
	})

	void test('suppresses only the targeted trading guard copy in the UI', () => {
		expect(getTradingGuardDisplayMessage(NO_MINT_CAPACITY_NO_ACTIVE_COVERAGE_COMMITMENT_MESSAGE)).toBeUndefined()
		expect(getTradingGuardDisplayMessage(NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE)).toBeUndefined()
		expect(getTradingGuardDisplayMessage(SHARE_MIGRATION_AFTER_FORK_MESSAGE)).toBe(SHARE_MIGRATION_AFTER_FORK_MESSAGE)
		expect(getTradingGuardDisplayMessage(MARKET_NOT_FINALIZED_MESSAGE)).toBe(MARKET_NOT_FINALIZED_MESSAGE)
		expect(getTradingGuardDisplayMessage('Loading wallet share balances.')).toBe('Loading wallet share balances.')
		expect(getTradingGuardDisplayMessage(undefined)).toBeUndefined()
	})

	void test('blocks minting until a pool is loaded and the wallet is connected on mainnet', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: undefined,
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n,
			}),
		).toBe('Connect a wallet before minting complete sets.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: false,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n,
			}),
		).toBe('Select a pool before minting.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: true,
				isOnActiveAppChain: false,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n,
			}),
		).toBe('Switch to Ethereum mainnet.')
	})

	void test('surfaces the local mint block reasons before the transaction is sent', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: undefined,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: undefined,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n,
			}),
		).toBe('Loading mint capacity.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: 10n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n,
			}),
		).toBe('No mint capacity remaining.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				feeEligibleCoverageCommitmentAttoEth: 0n,
			}),
		).toBe('No mint capacity. No active coverage commitment.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: 'abc',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n ** 18n,
			}),
		).toBe('Enter a valid mint amount.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n ** 18n,
			}),
		).toBe('Enter a mint amount greater than zero.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 8n * 10n ** 17n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0.3',
				shareTokenSupplyAttoShares: 10n ** 18n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 10n ** 18n,
			}),
		).toBe('Max mint capacity is 0.2 ETH.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 5n * 10n ** 17n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		).toBe('Need 0.5 more ETH in this wallet to mint the selected amount.')
	})

	void test('blocks minting when migrated complete-set shares have no collateral exchange rate', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 10n * 10n ** 18n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				feeEligibleCoverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		).toBe('Minting is unavailable because this pool has complete-set shares but no collateral.')
	})

	void test('allows minting when the pool has capacity and the wallet has enough ETH', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 4n * 10n ** 17n,
				ethBalanceAttoEth: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0.5',
				shareTokenSupplyAttoShares: 10n ** 18n,
				totalPoolHeldAttoRep: 0n,
				feeEligibleCoverageCommitmentAttoEth: 2n * 10n ** 18n,
			}),
		).toBeUndefined()
	})

	void test('limits complete-set redemption to the wallet minimum across yes, no, and invalid', () => {
		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: '0',
				shareBalances,
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBe('Enter a redeem amount greater than zero.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: true,
				redeemAmountInput: '1',
				shareBalances: undefined,
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBe('Loading wallet share balances.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: '1',
				shareBalances: {
					invalidAttoShares: 0n,
					noAttoShares: 2n * 10n ** 18n,
					yesAttoShares: 2n * 10n ** 18n,
				},
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBe('Need matching Invalid, Yes, and No shares to redeem complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: 'abc',
				shareBalances,
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBe('Enter a valid redeem amount.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2.1',
				shareBalances,
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBe('Max redeemable amount is 2 complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2',
				shareBalances,
				shareTokenSupplyAttoShares: 10n * TOKEN_PRECISION,
			}),
		).toBeUndefined()
	})

	void test('converts first-mint share token amounts through the pool exchange rate', () => {
		const firstMintShareAmount = TOKEN_PRECISION * TOKEN_PRECISION
		expect(convertAttoSharesToSettlementCollateralAttoEth(firstMintShareAmount, TOKEN_PRECISION, firstMintShareAmount)).toBe(TOKEN_PRECISION)
		expect(convertSettlementCollateralAttoEthToAttoShares(TOKEN_PRECISION, TOKEN_PRECISION, firstMintShareAmount)).toBe(firstMintShareAmount)
		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingDetails: false,
				redeemAmountInput: '1.1',
				shareBalances: {
					invalidAttoShares: firstMintShareAmount,
					noAttoShares: firstMintShareAmount,
					yesAttoShares: firstMintShareAmount,
				},
				shareTokenSupplyAttoShares: firstMintShareAmount,
			}),
		).toBe('Max redeemable amount is 1 complete set.')
	})

	void test('validates share migration targets and positive balances once migration is available', () => {
		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '0, 1, 2',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBeUndefined()

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '0, 1, 1',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBe('Select each target child universe only once.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'invalid',
				shareBalances: {
					invalidAttoShares: 0n,
					noAttoShares: 4n * 10n ** 18n,
					yesAttoShares: 3n * 10n ** 18n,
				},
				targetOutcomeIndexesInput: '0, 1, 2',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBe('No Invalid shares available to migrate.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBe('Select at least one target child universe.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '9',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBe('Select valid target child universes.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: getScalarOutcomeIndex(scalarForkUniverse.forkQuestionDetails, 5n).toString(),
				tradingForkUniverse: scalarForkUniverse,
			}),
		).toBeUndefined()

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '5',
				tradingForkUniverse: scalarForkUniverse,
			}),
		).toBe('Select valid target child universes.')
	})

	void test('checks local and network prerequisites before resolved-share redemption', () => {
		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: undefined,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
			}),
		).toBe('Connect a wallet before redeeming shares.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: false,
				isOnActiveAppChain: true,
			}),
		).toBe('Select a pool before redeeming shares.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: false,
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
			}),
		).toBeUndefined()

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isOnActiveAppChain: true,
			}),
		).toBeUndefined()
	})
})
