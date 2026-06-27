/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import {
	MARKET_NOT_FINALIZED_MESSAGE,
	NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE,
	NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE,
	SHARE_MIGRATION_AFTER_FORK_MESSAGE,
	convertCollateralAmountToShareAmount,
	convertShareAmountToCollateralAmount,
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
	hasRepBackedPoolWithNoActiveAllowance,
	isTradingSystemDeployed,
} from '../lib/trading.js'
import { getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '../types/contracts.js'

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
		invalid: 2n * 10n ** 18n,
		no: 4n * 10n ** 18n,
		yes: 3n * 10n ** 18n,
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
		forkThreshold: 1n,
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
		totalTheoreticalSupply: 100n,
		universeId: 0n,
	} satisfies ZoltarUniverseSummary
	const scalarForkUniverse = {
		childUniverses: [],
		forkThreshold: 1n,
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
		totalTheoreticalSupply: 100n,
		universeId: 0n,
	} satisfies ZoltarUniverseSummary

	void test('computes remaining mint capacity from total bond allowance and minted open interest', () => {
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

	void test('computes vault collateralization as a percentage using the canonical REP/ETH price', () => {
		expect(getVaultCollateralizationPercent(4n * TOKEN_PRECISION, 2n * TOKEN_PRECISION, TOKEN_PRECISION)).toBe(200n * TOKEN_PRECISION)
		expect(getVaultCollateralizationPercent(4n * TOKEN_PRECISION, undefined, TOKEN_PRECISION)).toBeUndefined()
	})

	void test('marks collateralization green when it is at or above the security multiplier threshold', () => {
		expect(getCollateralizationTone(201n * TOKEN_PRECISION, 2n)).toBe('success')
		expect(getCollateralizationTone(200n * TOKEN_PRECISION, 2n)).toBe('success')
		expect(getCollateralizationTone(199n * TOKEN_PRECISION, 2n)).toBe('danger')
		expect(getCollateralizationTone(undefined, 2n)).toBeUndefined()
	})

	void test('surfaces no active allowance separately from unavailable quotes', () => {
		expect(getCollateralizationDisplayState(0n, undefined)).toBe('noActiveAllowance')
		expect(getCollateralizationDisplayState(TOKEN_PRECISION, undefined)).toBe('unavailable')
		expect(getCollateralizationDisplayState(TOKEN_PRECISION, 150n * TOKEN_PRECISION)).toBe('value')
	})

	void test('returns zero percent when REP backing is zero but allowance is active', () => {
		expect(getPoolCollateralizationPercent(0n, TOKEN_PRECISION, TOKEN_PRECISION)).toBe(0n)
	})

	void test('detects pools that have REP backing but no active allowance', () => {
		expect(hasRepBackedPoolWithNoActiveAllowance(20n * 10n ** 18n, 0n)).toBe(true)
		expect(hasRepBackedPoolWithNoActiveAllowance(20n * 10n ** 18n, 1n)).toBe(false)
		expect(hasRepBackedPoolWithNoActiveAllowance(0n, 0n)).toBe(false)
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
		expect(getTradingGuardDisplayMessage(NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE)).toBeUndefined()
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
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Connect a wallet before minting complete sets.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: false,
				isMainnet: true,
				mintAmountInput: '1',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Load a pool before minting.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: true,
				isMainnet: false,
				mintAmountInput: '1',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Switch to Ethereum mainnet before minting complete sets.')
	})

	void test('surfaces the local mint block reasons before the transaction is sent', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: undefined,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				shareTokenSupply: undefined,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Loading mint capacity.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				shareTokenSupply: 10n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('No mint capacity remaining.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				shareTokenSupply: 0n,
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 0n,
			}),
		).toBe('No mint capacity. No active security bond allowance.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: 'abc',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('Enter a valid mint amount.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('Enter a mint amount greater than zero.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 8n * 10n ** 17n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0.3',
				shareTokenSupply: 10n ** 18n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('Max mint capacity is 0.2 ETH.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 5n * 10n ** 17n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				shareTokenSupply: 0n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBe('Need 0.5 more ETH in this wallet to mint the selected amount.')
	})

	void test('blocks minting when migrated complete-set shares have no collateral exchange rate', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				shareTokenSupply: 10n * 10n ** 18n,
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBe('Minting is unavailable because this pool has complete-set shares but no collateral.')
	})

	void test('allows minting when the pool has capacity and the wallet has enough ETH', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 4n * 10n ** 17n,
				ethBalance: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0.5',
				shareTokenSupply: 10n ** 18n,
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBeUndefined()
	})

	void test('limits complete-set redemption to the wallet minimum across yes, no, and invalid', () => {
		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '0',
				shareBalances,
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBe('Enter a redeem amount greater than zero.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: true,
				redeemAmountInput: '1',
				shareBalances: undefined,
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBe('Loading wallet share balances.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '1',
				shareBalances: {
					invalid: 0n,
					no: 2n * 10n ** 18n,
					yes: 2n * 10n ** 18n,
				},
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBe('Need matching Invalid, Yes, and No shares to redeem complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: 'abc',
				shareBalances,
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBe('Enter a valid redeem amount.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2.1',
				shareBalances,
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBe('Max redeemable amount is 2 complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n * TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2',
				shareBalances,
				shareTokenSupply: 10n * TOKEN_PRECISION,
			}),
		).toBeUndefined()
	})

	void test('converts first-mint share token amounts through the pool exchange rate', () => {
		const firstMintShareAmount = TOKEN_PRECISION * TOKEN_PRECISION
		expect(convertShareAmountToCollateralAmount(firstMintShareAmount, TOKEN_PRECISION, firstMintShareAmount)).toBe(TOKEN_PRECISION)
		expect(convertCollateralAmountToShareAmount(TOKEN_PRECISION, TOKEN_PRECISION, firstMintShareAmount)).toBe(firstMintShareAmount)
		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: TOKEN_PRECISION,
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '1.1',
				shareBalances: {
					invalid: firstMintShareAmount,
					no: firstMintShareAmount,
					yes: firstMintShareAmount,
				},
				shareTokenSupply: firstMintShareAmount,
			}),
		).toBe('Max redeemable amount is 1 complete sets.')
	})

	void test('validates share migration targets and positive balances once migration is available', () => {
		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
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
				isMainnet: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'invalid',
				shareBalances: {
					invalid: 0n,
					no: 4n * 10n ** 18n,
					yes: 3n * 10n ** 18n,
				},
				targetOutcomeIndexesInput: '0, 1, 2',
				tradingForkUniverse: binaryForkUniverse,
			}),
		).toBe('No Invalid shares available to migrate.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
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
				isMainnet: true,
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
				isMainnet: true,
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
				isMainnet: true,
				loadingTradingForkUniverse: false,
				loadingTradingDetails: false,
				selectedShareOutcome: 'yes',
				shareBalances,
				targetOutcomeIndexesInput: '5',
				tradingForkUniverse: scalarForkUniverse,
			}),
		).toBe('Select valid target child universes.')
	})

	void test('only checks local prerequisites before resolved-share redemption', () => {
		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: undefined,
				hasSelectedPool: true,
				isMainnet: true,
			}),
		).toBe('Connect a wallet before redeeming shares.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: false,
				isMainnet: true,
			}),
		).toBe('Load a pool before redeeming shares.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: false,
			}),
		).toBe('Switch to Ethereum mainnet before redeeming shares.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
			}),
		).toBeUndefined()

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
			}),
		).toBeUndefined()
	})
})
