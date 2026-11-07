/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createTradingSuccessPresentation, createTradingTransactionIntent } from '@zoltar/ui-statoblast-shared/features/transactionPresentations.js'
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createReportingSuccessPresentation, createReportingTransactionIntent } from '@zoltar/ui-statoblast-shared/features/reportingTransactionPresentations.js'

const _transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

describe('transaction presentations', () => {
	test('uses resolved token symbols in OpenOracle approval and withdrawal titles', () => {
		const context = {
			token1Symbol: 'WETH',
			token2Symbol: 'REP',
			withdrawalTokenSymbol: 'WETH',
		}

		expect(createOpenOracleTransactionIntent('approveToken1', context).submittedTitle).toBe('Approving WETH')
		expect(createOpenOracleSuccessPresentation({ action: 'approveToken1', hash: '0x1234' }, context).title).toBe('WETH approved')
		expect(createOpenOracleTransactionIntent('withdrawBalance', context).submittedTitle).toBe('Withdrawing WETH')
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
		expect(createOpenOracleTransactionIntent('createReportInstance').submittedTitle).toBe('Creating standalone OpenOracle report')
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
		expect(createOpenOracleSuccessPresentation({ action: 'settle', hash: '0x1234' }).title).toBe('Report settled')
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
	for (const [_action, _title] of [
		['initializeChildHistory', 'Initialize dispute history'],
		['prepareForkClaim', 'Prepare inherited claim'],
	] as const) {
	}
})
