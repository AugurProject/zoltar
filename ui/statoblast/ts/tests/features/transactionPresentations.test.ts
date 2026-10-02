/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import {
	createForkAuctionSuccessPresentation,
	createForkAuctionTransactionIntent,
	createLiquidationSuccessPresentation,
	createLiquidationTransactionIntent,
	createSecurityPoolCreationSuccessPresentation,
	createSecurityPoolCreationTransactionIntent,
	createSecurityVaultSuccessPresentation,
	createSecurityVaultTransactionIntent,
	createTradingSuccessPresentation,
	createTradingTransactionIntent,
	getSecurityVaultActionRepAmount,
} from '@zoltar/ui-statoblast-shared/features/transactionPresentations.js'
import { createMarketCreationSuccessPresentation } from '@zoltar/ui-zoltar-shared/features/zoltarTransactionPresentations.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createReportingSuccessPresentation, createReportingTransactionIntent } from '@zoltar/ui-statoblast-shared/features/reportingTransactionPresentations.js'
import type { ForkAuctionActionResult } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionPrepared, markTransactionRequested, markTransactionSubmitted } from '@zoltar/ui-core-shared/transactions/transactionTray.js'

const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

function createForkAuctionResult(action: ForkAuctionActionResult['action'], overrides: Partial<ForkAuctionActionResult> = {}): ForkAuctionActionResult {
	return {
		action,
		hash: '0x1234',
		securityPoolAddress: '0x0000000000000000000000000000000000000123',
		universeId: 1n,
		...overrides,
	}
}

describe('transaction presentations', () => {
	test('preserves protocol acronym casing and question terminology', () => {
		expect(createSecurityVaultTransactionIntent('depositRepToVault').submittedTitle).toBe('Deposit REP')
		expect(createSecurityVaultTransactionIntent('queueWithdrawRep').submittedTitle).toBe('Withdraw REP')
		expect(createSecurityVaultSuccessPresentation({ action: 'queueWithdrawRep', hash: '0x1234' }).title).toBe('Withdraw REP')
		for (const [marketType, expectedLabel] of [
			['binary', 'Binary'],
			['categorical', 'Categorical'],
			['scalar', 'Scalar'],
		] as const) {
			const questionTypeRow = createMarketCreationSuccessPresentation({ createQuestionHash: '0x1234', marketType, questionId: '0x01' }).rows?.find(row => row.label === 'Question type')
			expect(questionTypeRow?.value).toBe(expectedLabel)
		}
	})

	test('does not describe an immediately executed target change as still queued', () => {
		const presentation = createSecurityVaultSuccessPresentation({
			action: 'setVaultUnderwritingLimit',
			hash: transactionHash,
			queuedOperation: { operation: 'setVaultUnderwritingLimit', operationId: 1n, isPendingSlot: false },
			stagedExecution: { operation: 'setVaultUnderwritingLimit', operationId: 1n, success: true, errorMessage: undefined },
		})
		expect(presentation.detail).toBeUndefined()
	})

	test('renders child REP symbols in vault transaction actions', () => {
		const context = { repTokenSymbol: 'REP2' }
		expect(createSecurityVaultTransactionIntent('depositRepToVault', context).submittedTitle).toBe('Deposit REP2')
		expect(createSecurityVaultTransactionIntent('queueWithdrawRep', context).submittedTitle).toBe('Withdraw REP2')
		expect(createSecurityVaultSuccessPresentation({ action: 'redeemRepFromVault', hash: '0x1234' }, context).title).toBe('Redeem REP2')
	})

	test('keeps vault identity in transaction intent rows', () => {
		const intent = createSecurityVaultTransactionIntent('depositRepToVault', {
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			vaultAddress: '0x0000000000000000000000000000000000000002',
		})
		expect(intent.rows?.map(row => row.label)).toEqual(['Security pool address', 'Vault'])
	})

	test('states the REP amount in vault deposit and withdrawal reviews', () => {
		const form = { depositAmount: '1200', repWithdrawAmount: '12.5' }
		const context = { repTokenSymbol: 'REP2', securityPoolAddress: '0x0000000000000000000000000000000000000001', vaultAddress: '0x0000000000000000000000000000000000000002' }
		const deposit = createSecurityVaultTransactionIntent('depositRepToVault', { ...context, repAmountAttoRep: getSecurityVaultActionRepAmount('depositRepToVault', form) })
		const withdrawal = createSecurityVaultTransactionIntent('queueWithdrawRep', { ...context, repAmountAttoRep: getSecurityVaultActionRepAmount('queueWithdrawRep', form) })
		expect(deposit.rows?.map(row => row.label)).toEqual(['Amount', 'Security pool address', 'Vault'])
		expect(deposit.rows?.[0]?.value).toBe('1 200\u00a0REP2')
		expect(withdrawal.rows?.[0]).toEqual({ label: 'Amount', value: '12.5\u00a0REP2' })
		expect(getSecurityVaultActionRepAmount('redeemFees', form)).toBeUndefined()
		expect(getSecurityVaultActionRepAmount('depositRepToVault', { depositAmount: '', repWithdrawAmount: '' })).toBeUndefined()
		expect(getSecurityVaultActionRepAmount('queueWithdrawRep', { depositAmount: '', repWithdrawAmount: 'abc' })).toBeUndefined()
	})

	test('normalizes the security multiplier in security pool creation intents', () => {
		const intent = createSecurityPoolCreationTransactionIntent({
			statoblastSecurityMultiplierBps: 25_000n,
		})

		expect(intent.rows).toEqual([{ label: 'Security multiplier', value: '2.5×' }])
		expect(intent.failedTitle).toBe('Security pool creation')
	})

	test('orders security pool creation rows like the success presentation and leads with a new question title', () => {
		const intent = createSecurityPoolCreationTransactionIntent({
			initialReportPriorityFeeNanoEth: '10',
			questionTitle: ' Will it rain? ',
			statoblastSecurityMultiplierBps: 20_000n,
		})
		const success = createSecurityPoolCreationSuccessPresentation({
			deployPoolHash: '0x1234',
			initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
			questionId: '0x0b',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			statoblastSecurityMultiplierBps: 20_000n,
			universeId: 0n,
		})

		expect(intent.rows?.[0]).toEqual({ label: 'Question', value: 'Will it rain?' })
		expect(intent.rows?.slice(1).map(row => row.label)).toEqual(['Security multiplier', 'Initial report priority fee'])
		expect(success.rows?.map(row => row.label)).toEqual(['Pool', 'Question ID', 'Security multiplier', 'Initial report priority fee'])
		// The fee is a per-gas price: review and success state it the same way, in nanoETH per gas.
		expect(intent.rows?.at(-1)?.value).toBe('10\u00a0nanoETH per gas')
		expect(success.rows?.at(-1)?.value).toBe('10\u00a0nanoETH per gas')
	})

	test('does not present a failed staged execution as a success', () => {
		const vaultPresentation = createSecurityVaultSuccessPresentation({
			action: 'queueWithdrawRep',
			hash: transactionHash,
			queuedOperation: { operation: 'withdrawRep', operationId: 3n, isPendingSlot: false },
			stagedExecution: { operation: 'withdrawRep', operationId: 3n, success: false, errorMessage: 'Price is stale' },
		})
		expect(vaultPresentation.tone).toBe('error')
		expect(vaultPresentation.detail).toBe('Price is stale')
		const liquidationPresentation = createLiquidationSuccessPresentation({
			action: 'queueLiquidation',
			hash: transactionHash,
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			queuedOperation: { operation: 'liquidation', operationId: 4n, isPendingSlot: false },
			stagedExecution: { operation: 'liquidation', operationId: 4n, success: false, errorMessage: undefined },
		})
		expect(liquidationPresentation.tone).toBe('error')
		expect(liquidationPresentation.title).toBe('Liquidation failed')
		const revertedPresentation = createLiquidationSuccessPresentation({
			action: 'queueLiquidation',
			hash: transactionHash,
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			queuedOperation: { operation: 'liquidation', operationId: 5n, isPendingSlot: false },
			stagedExecution: { operation: 'liquidation', operationId: 5n, success: false, errorMessage: 'Liquidation distance too low' },
		})
		// The contract revert string is shown in the same plain language as the liquidation modal.
		expect(revertedPresentation.detail).toBe('The oracle price has not moved far enough past the target vault’s liquidation threshold.')
	})

	test('uses resolved token symbols in OpenOracle approval and withdrawal titles', () => {
		const context = {
			token1Symbol: 'WETH',
			token2Symbol: 'REP',
			withdrawalTokenSymbol: 'WETH',
		}

		expect(createOpenOracleTransactionIntent('approveToken1', context).submittedTitle).toBe('Approve WETH')
		expect(createOpenOracleSuccessPresentation({ action: 'approveToken1', hash: '0x1234' }, context).title).toBe('WETH approved')
		expect(createOpenOracleTransactionIntent('withdrawBalance', context).submittedTitle).toBe('Withdraw WETH')
		expect(createOpenOracleSuccessPresentation({ action: 'withdrawBalance', hash: '0x1234' }, context).title).toBe('WETH withdrawn')
	})

	test('keeps unresolved token outcome titles in sentence case', () => {
		expect(createOpenOracleTransactionIntent('approveToken1').submittedTitle).toBe('Approving base token')
		expect(createOpenOracleSuccessPresentation({ action: 'approveToken1', hash: '0x1234' }).title).toBe('Base token approved')
		expect(createOpenOracleSuccessPresentation({ action: 'approveToken2', hash: '0x1234' }).title).toBe('Quote token approved')
		expect(createOpenOracleTransactionIntent('withdrawBalance').submittedTitle).toBe('Withdrawing oracle balance')
		expect(createOpenOracleSuccessPresentation({ action: 'withdrawBalance', hash: '0x1234' }).title).toBe('Oracle balance withdrawn')
	})

	test('uses the user-facing report name for OpenOracle creation', () => {
		expect(createOpenOracleTransactionIntent('createReportInstance').submittedTitle).toBe('Creating standalone oracle report')
		expect(createOpenOracleSuccessPresentation({ action: 'createReportInstance', hash: '0x1234' }).title).toBe('Report created')
	})

	test('distinguishes accepted prices and unconfirmed callbacks from report settlement', () => {
		const accepted = createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234', priceSettlement: { status: 'accepted' } })
		expect(accepted.tone).toBe('success')
		expect(accepted.detail).toBe('Pool accepted this price.')
		const unconfirmed = createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234', priceSettlement: { status: 'unconfirmed' } })
		expect(unconfirmed.tone).toBe('warning')
		expect(unconfirmed.title).toBe('Report settled; price acceptance unconfirmed')
		const rejected = createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234', priceSettlement: { status: 'rejected', reason: 'Base fee too high' } })
		expect(rejected.detail).toBe('Pool rejected this price: Base fee too high. Request a new price.')
	})

	test('shows a stale coordinator rejection as a warning after successful report settlement', () => {
		const presentation = createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234', priceSettlement: { status: 'rejected', reason: 'Report stale' } })
		expect(presentation.tone).toBe('warning')
		expect(presentation.title).toBe('Report settled; price rejected')
		expect(presentation.detail).toBe('Price expired before settlement. Request a new price.')
	})

	test('describes OpenOracle settlement as a report lifecycle action', () => {
		expect(createOpenOracleTransactionIntent('settle').submittedTitle).toBe('Settling report')
		expect(createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234' }).title).toBe('Settled report')
	})

	test('keeps pool and action context in trading and reporting intents', () => {
		const context = {
			securityPoolAddress: '0x0000000000000000000000000000000000000001' as const,
			universeId: 7n,
		}
		const tradingIntent = createTradingTransactionIntent('migrateShares', { ...context, shareOutcome: 'yes' })
		const tradingPresentation = createTradingSuccessPresentation({
			action: 'migrateShares',
			hash: '0x1234',
			securityPoolAddress: context.securityPoolAddress,
			shareOutcome: 'yes',
			universeId: context.universeId,
		})
		const reportingIntent = createReportingTransactionIntent('reportOutcome', { ...context, outcome: 'no' })

		expect(tradingIntent.rows?.map(row => row.label)).toEqual(['Pool', 'Share outcome'])
		expect(tradingIntent.rows?.map(row => row.identityKey)).toEqual(['security-pool', 'outcome'])
		expect(tradingPresentation.rows?.map(row => row.identityKey)).toEqual(['security-pool', 'outcome'])
		expect(reportingIntent.rows?.map(row => row.label)).toEqual(['Pool', 'Outcome'])
	})

	test('reuses liquidation identity and submitted values in completion presentations', () => {
		const context = {
			amount: '4.5',
			securityPoolAddress: '0x0000000000000000000000000000000000000001' as const,
			targetVault: '0x0000000000000000000000000000000000000002' as const,
			universeId: 7n,
		}
		const intent = createLiquidationTransactionIntent(context)
		const presentation = createLiquidationSuccessPresentation(
			{
				action: 'queueLiquidation',
				hash: '0x1234',
				securityPoolAddress: context.securityPoolAddress,
			},
			context,
		)

		expect(intent.rows?.map(row => row.label)).toEqual(['Pool', 'Target vault', 'Commitment to transfer'])
		expect(presentation.rows?.map(row => row.label)).toEqual(['Pool', 'Target vault', 'Commitment to transfer'])
		expect(intent.rows?.at(-1)).toMatchObject({ label: 'Commitment to transfer', value: '4.5\u00a0ETH' })
		expect(presentation.rows?.at(-1)).toMatchObject({ label: 'Commitment to transfer', value: '4.5\u00a0ETH' })
	})

	test('uses the same pool grammar without redundant universe rows in intent and success presentations', () => {
		const securityPoolAddress = '0x0000000000000000000000000000000000000001'
		const context = { securityPoolAddress, universeId: 7n }
		const cases = [
			{
				intent: createTradingTransactionIntent('createCompleteSet', context),
				presentation: createTradingSuccessPresentation({ action: 'createCompleteSet', hash: '0x1234', securityPoolAddress, universeId: 7n }),
			},
			{
				intent: createReportingTransactionIntent('reportOutcome', { ...context, outcome: 'yes' }),
				presentation: createReportingSuccessPresentation({ action: 'reportOutcome', hash: '0x1234', outcome: 'yes', securityPoolAddress, universeId: 7n }),
			},
		]

		for (const { intent, presentation } of cases) {
			expect(intent.rows?.[0]?.label).toBe('Pool')
			expect(presentation.rows?.[0]?.label).toBe('Pool')
			expect(intent.rows?.map(row => row.label)).not.toContain('Universe')
			expect(presentation.rows?.map(row => row.label)).not.toContain('Universe')
			expect(intent.universeId).toBe(7n)
			expect(presentation.universeId).toBe(7n)
		}
	})

	test('preserves representative workflow context through prepare, pending, and failure states', () => {
		const securityPoolAddress = '0x0000000000000000000000000000000000000001'
		const intents = [
			createTradingTransactionIntent('migrateShares', { securityPoolAddress, shareOutcome: 'yes', universeId: 7n }),
			createReportingTransactionIntent('reportOutcome', { outcome: 'no', securityPoolAddress, universeId: 7n }),
			createLiquidationTransactionIntent({ amount: '2', securityPoolAddress, targetVault: '0x0000000000000000000000000000000000000002', universeId: 7n }),
		]

		for (const intent of intents) {
			const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
			const prepared = markTransactionPrepared(requested, {
				account: '0x0000000000000000000000000000000000000003',
				args: [],
				chainName: 'Ethereum',
				contractAddress: securityPoolAddress,
				functionName: intent.action,
				value: 0n,
			})
			const submitted = markTransactionSubmitted(prepared, transactionHash)
			const failed = markTransactionFailed(submitted, { kind: 'reverted', message: 'Transaction reverted' })

			for (const state of [requested, prepared, submitted, failed]) {
				expect(state.active?.rows?.map(row => row.label)).toContain('Pool')
				expect(state.active?.rows?.map(row => row.label)).not.toContain('Universe')
				expect(state.active?.universeId).toBe(7n)
			}
			expect(prepared.active?.technicalRows?.map(row => row.label)).toContain('Function')
			expect(submitted.active?.technicalRows?.map(row => row.label)).toContain('Function')
			expect(failed.active?.technicalRows?.map(row => row.label)).toContain('Function')
		}
	})

	test('preserves pool oracle universe metadata through every transaction lifecycle state', () => {
		const context = {
			managerAddress: '0x0000000000000000000000000000000000000002' as const,
			securityPoolAddress: '0x0000000000000000000000000000000000000001' as const,
			universeId: 7n,
			proposedRepPerEthPrice: 3n * 10n ** 18n,
		}
		const intent = createPoolOracleTransactionIntent('requestPrice', context)
		const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
		const prepared = markTransactionPrepared(requested, {
			account: '0x0000000000000000000000000000000000000003',
			args: [],
			chainName: 'Ethereum',
			contractAddress: context.managerAddress,
			functionName: 'requestPrice',
			value: 0n,
		})
		const submitted = markTransactionSubmitted(prepared, transactionHash)
		const failed = markTransactionFailed(submitted, { kind: 'reverted', message: 'Transaction reverted' })
		const success = createPoolOracleSuccessPresentation({ action: 'requestPrice', hash: transactionHash }, context)

		for (const presentation of [requested.active, prepared.active, submitted.active, failed.active, success]) {
			expect(presentation?.universeId).toBe(7n)
			expect(presentation?.rows?.map(row => row.label)).not.toContain('Universe')
			expect(presentation?.rows?.find(row => row.label === 'Attempted REP per ETH price')?.value).toBe('3')
		}
		expect(intent.failedTitle).toBe('Price request')
		expect(failed.active?.title).toBe('Price request')
		expect(success.title).toBe('Requested new price')
	})

	test('describes truth-auction claim settlement as REP plus auctioned underwriting commitments', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds'))
		expect(presentation.detail).toBe('Selected truth-auction bids were settled. Winning bids received REP backing units plus Auctioned underwriting commitments, assigning the remaining underwriting commitments; refund-only rows credited locked ETH for withdrawal.')
	})

	test('describes finalized refund-only settlement without underwriting commitments assignment', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds', { settlementMode: 'refund' }))
		expect(presentation.title).toBe('Settle finalized refunds')
		expect(presentation.detail).toBe('Selected finalized truth-auction refund rows were settled. Locked ETH was credited for withdrawal without assigning REP backing units or Auctioned underwriting commitments.')
	})

	test('uses refund-only transaction intent copy for finalized refund settlement submissions', () => {
		const intent = createForkAuctionTransactionIntent('claimAuctionProceeds', { submittedTitle: 'Settle finalized refunds' })
		expect(intent.submittedTitle).toBe('Settle finalized refunds')
		expect(intent.submittedDetail).toBeUndefined()
	})

	test('describes unresolved escalation migration as optional parent escalation-deposit accounting cleanup', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateUnresolvedEscalation'))
		expect(presentation.title).toBe('Clear unresolved parent escalation-deposit accounting')
		expect(presentation.detail).toBe('The wallet’s unresolved parent escalation-deposit accounting was cleared in constant-size work. Child backing and proof eligibility were already available and are unchanged.')
	})

	test('describes direct parent escalation claims without calling them migration', () => {
		const intent = createForkAuctionTransactionIntent('claimParentEscalationDeposits')
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimParentEscalationDeposits'))
		expect(intent.submittedTitle).toBe('Claim parent escalation deposits')
		expect(presentation.title).toBe('Claim parent escalation deposits')
		expect(presentation.detail).toBe('Selected winning parent deposits were paid directly in child REP. Their carried proofs are now spent in current and later descendants.')
	})
})
