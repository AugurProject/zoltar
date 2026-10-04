/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	estimateMintCheckpoint,
	convertAttoSharesToSettlementCollateralAttoEth,
	formatStatoblastSecurityMultiplier,
	getCompleteSetRedeemAttoShares,
	getDefaultShareMigrationTargetOutcomeIndexes,
	getMaximumMintAmount,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	hasRepBackedPoolWithNoActiveCapacityOwnership,
	isTradingSystemDeployed,
	MINTING_PAUSED_DURING_DISPUTE_MESSAGE,
} from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { ETH_GAS_RESERVE_ATTO_ETH } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { getScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

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

	void test('computes remaining mint capacity from live ETH capacity and minted open interest', () => {
		expect(getRemainingMintCapacity(10n, 4n)).toBe(6n)
		expect(getRemainingMintCapacity(10n, 10n)).toBe(0n)
		expect(getRemainingMintCapacity(10n, 12n)).toBe(0n)
		expect(getRemainingMintCapacity(undefined, 12n)).toBeUndefined()
	})

	void test('limits the maximum mint amount by both spendable wallet ETH and remaining capacity', () => {
		expect(getMaximumMintAmount(3n * TOKEN_PRECISION, 5n * TOKEN_PRECISION)).toBe(3n * TOKEN_PRECISION - ETH_GAS_RESERVE_ATTO_ETH)
		expect(getMaximumMintAmount(7n * TOKEN_PRECISION, 5n * TOKEN_PRECISION)).toBe(5n * TOKEN_PRECISION)
		expect(getMaximumMintAmount(ETH_GAS_RESERVE_ATTO_ETH, 5n * TOKEN_PRECISION)).toBe(0n)
		expect(getMaximumMintAmount(undefined, 5n)).toBeUndefined()
		expect(getMaximumMintAmount(7n, undefined)).toBeUndefined()
	})

	void test('keeps the gas reserve in the wallet when validating a mint amount', () => {
		const mintGuardInput = {
			accountAddress: '0x1234567890123456789012345678901234567890',
			settlementCollateralAttoEth: 0n,
			hasSelectedPool: true,
			isOnActiveAppChain: true,
			shareTokenSupplyAttoShares: 0n,
			totalPoolHeldAttoRep: 0n,
			mintingCapacityAttoEth: 5n * TOKEN_PRECISION,
		} as const
		expect(getTradingMintGuardMessage({ ...mintGuardInput, ethBalanceAttoEth: TOKEN_PRECISION, mintAmountInput: '1' })).toBe('Need 0.01\u00a0more\u00a0ETH in this wallet to mint the selected amount and keep 0.01\u00a0ETH for gas.')
		expect(getTradingMintGuardMessage({ ...mintGuardInput, ethBalanceAttoEth: TOKEN_PRECISION, mintAmountInput: '0.99' })).toBeUndefined()
	})

	void test('explains that an escalation game pauses minting before reporting capacity', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				escalationGameActive: true,
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: TOKEN_PRECISION,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0.1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 20n * TOKEN_PRECISION,
				mintingCapacityAttoEth: 0n,
			}),
		).toBe(MINTING_PAUSED_DURING_DISPUTE_MESSAGE)
	})

	void test('estimates the exact fee checkpoint that runs before minting', () => {
		expect(
			estimateMintCheckpoint({
				currentRetentionRate: 900_000_000_000_000_000n,
				currentTimestamp: 2n,
				totalUnderwritingLimitAttoEth: 5n * TOKEN_PRECISION,
				feeEligibleUnderwritingLimitAttoEth: 5n * TOKEN_PRECISION,
				feeEndTimestamp: 10n,
				feeIndexRemainder: 0n,
				lastUpdatedFeeAccumulator: 1n,
				settlementCollateralAttoEth: 10n * TOKEN_PRECISION,
				totalFeesOwedRemainder: 0n,
			}),
		).toEqual({ estimatedRetentionFeeAttoEth: TOKEN_PRECISION, settlementCollateralAfterFeesAttoEth: 9n * TOKEN_PRECISION })
	})

	void test('treats the trading system as deployed only when every deterministic deployment step is deployed', () => {
		expect(isTradingSystemDeployed([])).toBe(false)
		expect(isTradingSystemDeployed([createDeploymentStep('proxyDeployer', true), createDeploymentStep('zoltar', true), createDeploymentStep('securityPoolFactory', true)])).toBe(true)
		expect(isTradingSystemDeployed([createDeploymentStep('proxyDeployer', true), createDeploymentStep('zoltar', true), createDeploymentStep('securityPoolFactory', false)])).toBe(false)
	})

	void test('formats security multiplier basis points with the multiplication sign', () => {
		expect(formatStatoblastSecurityMultiplier(20_000n)).toBe('2×')
		expect(formatStatoblastSecurityMultiplier(25_000n)).toBe('2.5×')
		expect(formatStatoblastSecurityMultiplier(20_001n)).toBe('2.0001×')
	})

	void test('detects pools that have REP backing but no active underwriting commitments', () => {
		expect(hasRepBackedPoolWithNoActiveCapacityOwnership(20n * 10n ** 18n, 0n)).toBe(true)
		expect(hasRepBackedPoolWithNoActiveCapacityOwnership(20n * 10n ** 18n, 1n)).toBe(false)
		expect(hasRepBackedPoolWithNoActiveCapacityOwnership(0n, 0n)).toBe(false)
	})

	void test('reads outcome share balances and default migration targets', () => {
		expect(getSelectedOutcomeShareBalance(shareBalances, 'yes')).toBe(3n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'no')).toBe(4n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'invalid')).toBe(2n * 10n ** 18n)
		expect(getDefaultShareMigrationTargetOutcomeIndexes(binaryForkUniverse)).toBe('0, 1, 2')
		expect(getDefaultShareMigrationTargetOutcomeIndexes(scalarForkUniverse)).toBe('')
	})

	void test('blocks minting until a pool is loaded and the wallet is connected on Sepolia', () => {
		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: undefined,
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n,
			}),
		).toBe('Connect a wallet before minting complete sets.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: false,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n,
			}),
		).toBe('Select a pool before minting.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n,
				hasSelectedPool: true,
				isOnActiveAppChain: false,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n,
			}),
		).toBe('Switch to Sepolia.')
	})

	void test('surfaces the local mint block reasons before the transaction is sent', () => {
		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: undefined,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: undefined,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n,
			}),
		).toBe('Loading mint capacity…')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 10n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: 10n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n,
			}),
		).toBe('No mint capacity remaining.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '100',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				mintingCapacityAttoEth: 0n,
			}),
		).toBe('No mint capacity. No vault has an active commitment.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: 'abc',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n ** 18n,
			}),
		).toBe('Enter a valid mint amount.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n ** 18n,
			}),
		).toBe('Enter a mint amount greater than zero.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 8n * 10n ** 17n,
				ethBalanceAttoEth: 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0.3',
				shareTokenSupplyAttoShares: 10n ** 18n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 10n ** 18n,
			}),
		).toBe('Max mint capacity is 0.2\u00a0ETH.')

		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 5n * 10n ** 17n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
			}),
		).toBe('Need 0.51\u00a0more\u00a0ETH in this wallet to mint the selected amount and keep 0.01\u00a0ETH for gas.')
	})

	void test('blocks minting when migrated complete-set shares have no collateral exchange rate', () => {
		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 0n,
				ethBalanceAttoEth: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '1',
				shareTokenSupplyAttoShares: 10n * 10n ** 18n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
			}),
		).toBe('Minting is unavailable because this pool has complete-set shares but no collateral.')
	})

	void test('allows minting when the pool has capacity and the wallet has enough ETH', () => {
		expect(
			getTradingMintGuardMessage({
				currentTimestamp: 100n,
				priceValidUntilTimestamp: 400n,
				accountAddress: '0x1234567890123456789012345678901234567890',
				settlementCollateralAttoEth: 4n * 10n ** 17n,
				ethBalanceAttoEth: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isOnActiveAppChain: true,
				mintAmountInput: '0.5',
				shareTokenSupplyAttoShares: 10n ** 18n,
				totalPoolHeldAttoRep: 0n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
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
		).toBe('Loading wallet share balances…')

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
		).toBe('You need matching Yes, No, and Invalid shares to redeem complete sets.')

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
		).toBe('Max redeemable amount is 2\u00a0ETH.')

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
		const firstMintShareAmount = TOKEN_PRECISION
		expect(convertAttoSharesToSettlementCollateralAttoEth(firstMintShareAmount, TOKEN_PRECISION, firstMintShareAmount)).toBe(TOKEN_PRECISION)
		expect(getCompleteSetRedeemAttoShares({ maxRedeemableAttoShares: undefined, redeemAmountAttoEth: TOKEN_PRECISION, settlementCollateralAttoEth: TOKEN_PRECISION, shareTokenSupplyAttoShares: firstMintShareAmount })).toBe(firstMintShareAmount)
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
		).toBe('Max redeemable amount is 1\u00a0ETH.')
	})

	void test('redeems every complete-set share when the ETH amount reaches the redeemable maximum', () => {
		// 99 shares at 7 / 100 ETH per share are worth 6 ETH, but 6 ETH converts back to only 86 shares.
		expect(getCompleteSetRedeemAttoShares({ maxRedeemableAttoShares: 99n, redeemAmountAttoEth: 6n, settlementCollateralAttoEth: 7n, shareTokenSupplyAttoShares: 100n })).toBe(99n)
		expect(getCompleteSetRedeemAttoShares({ maxRedeemableAttoShares: 99n, redeemAmountAttoEth: 5n, settlementCollateralAttoEth: 7n, shareTokenSupplyAttoShares: 100n })).toBe(72n)
		expect(getCompleteSetRedeemAttoShares({ maxRedeemableAttoShares: undefined, redeemAmountAttoEth: 6n, settlementCollateralAttoEth: 7n, shareTokenSupplyAttoShares: 100n })).toBe(86n)
	})

	void test('explains that share migration waits for the pool to fork', () => {
		const guardInput = {
			accountAddress: '0x1234567890123456789012345678901234567890',
			hasSelectedPool: true,
			isOnActiveAppChain: true,
			loadingTradingForkUniverse: false,
			loadingTradingDetails: false,
			selectedShareOutcome: 'yes',
			shareBalances,
			targetOutcomeIndexesInput: '0, 1, 2',
		} as const
		expect(getTradingMigrateSharesGuardMessage({ ...guardInput, tradingForkUniverse: { ...binaryForkUniverse, hasForked: false } })).toBe('Available only after this universe forks.')
		expect(getTradingMigrateSharesGuardMessage({ ...guardInput, tradingForkUniverse: undefined })).toBe('Refresh the child universes.')
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
		).toBe('Switch to Sepolia.')

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

	void test('blocks resolved-share redemption without winning shares in the wallet', () => {
		const redeemInput = { accountAddress: '0x1234567890123456789012345678901234567890', hasSelectedPool: true, isOnActiveAppChain: true } as const
		expect(getTradingRedeemSharesGuardMessage({ ...redeemInput, questionOutcome: 'yes', shareBalances: { ...shareBalances, yesAttoShares: 0n } })).toBe('You hold no winning Yes shares to redeem.')
		expect(getTradingRedeemSharesGuardMessage({ ...redeemInput, questionOutcome: 'invalid', shareBalances: undefined })).toBe('Loading wallet share balances…')
		expect(getTradingRedeemSharesGuardMessage({ ...redeemInput, questionOutcome: 'no', shareBalances })).toBeUndefined()
		expect(getTradingRedeemSharesGuardMessage({ ...redeemInput, questionOutcome: 'none', shareBalances })).toBe('Wait for the selected pool to resolve before redeeming shares.')
	})
})
