import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { evaluateSelectableOperationDefinition, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { address, snapshotFixture } from './fixture.ts'

const options = { allowHighRisk: true, allowIrreversibleOperations: true, maximumBlockIntervalSeconds: 15, maxEthSpendAttoEth: (10n ** 15n).toString(), maxRepSpendAttoRep: (10n ** 15n).toString(), minimumEthReserveAttoEth: (10n ** 16n).toString(), minimumRepReserveAttoRep: 0n.toString(), seed: 2 }
const definitions = ['trading.genesis-uniswap.seed-pool', 'trading.universe-uniswap.seed-pool', 'statoblast.oracle.request-price', 'open-oracle.deposit', 'open-oracle.report', 'zoltar.rep.burn', 'statoblast.vault.deposit-rep', 'statoblast.escalation.deposit-wallet-rep']

function fixture(definitionId: string) {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const universe = snapshot.universes[0]
	if (pool === undefined || universe === undefined) throw new Error('Missing fixtures')
	pool.oraclePriceValid = definitionId !== 'statoblast.oracle.request-price'
	if (definitionId === 'statoblast.oracle.request-price') {
		snapshot.anchor.baseFeePerGas = '1'
		pool.oracleRequestFunding = {
			escalationHaltMultiplierBps: '10000',
			feePercentage: '0',
			gasConsumedOpenOracleReportPrice: '3',
			gasUnitsForOneDispute: '1',
			initialReportPriorityFeeAttoEthPerGas: 1n.toString(),
			openOracleSecurityMultiplierBps: '10000',
			protocolFee: '0',
			settlementCallbackGasLimit: '2',
			targetPriceErrorForDispute: '10000000',
		}
		pool.minimumToken1ReportAttoEth = '4'
		pool.requestPriceCostAttoEth = '121'
		pool.settlementCollateralAttoEth = '100'
	}
	snapshot.deployments.uniswapV3Factory = address(40)
	snapshot.genesisUniswap = { factory: true, initialized: true, liquidity: '0', pool: address(41), proxy: true, seeder: true }
	snapshot.universes.push({ ...universe, id: '2', repToken: address(43) })
	snapshot.wallet.tokens.push({ address: address(43), allowances: {}, balance: '1000000000000000000', openOracleCredit: '0', openOracleInternalAllowanceToSelf: '0', symbol: 'REP' })
	snapshot.universeUniswap = { factory: true, pools: [{ initialized: true, liquidity: '0', pool: address(45), repToken: address(43), universeId: '2' }], proxy: true, seeder: true }
	const plan = evaluateSelectableOperationDefinition(definitionId, snapshot, options).plan
	if (plan === undefined) throw new Error(`Missing ${definitionId} plan`)
	const approvals = plan.steps
		.filter(step => step.id.startsWith('approve-'))
		.map(step => {
			const call = decodeFunctionData({ abi: erc20Abi, data: step.data })
			if (call.functionName !== 'approve') throw new Error('Expected approval')
			const token = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === step.to.toLowerCase())
			if (token === undefined) throw new Error('Missing approval inventory')
			return { step, token, spender: call.args[0], amount: call.args[1] }
		})
	if (approvals.length === 0) throw new Error(`Missing ${definitionId} approvals`)
	return { snapshot, plan, approvals }
}

describe('reuse sufficient ERC-20 allowances', () => {
	for (const definitionId of definitions) {
		test(`${definitionId} omits sufficient approvals in fresh and resumed plans`, () => {
			for (const excess of [0n, 1n, (1n << 256n) - 1n]) {
				const { snapshot, plan, approvals } = fixture(definitionId)
				for (const approval of approvals) approval.token.allowances[approval.spender] = (excess > approval.amount ? excess : approval.amount + excess).toString()
				for (const pool of snapshot.pools) for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = true
				const fresh = evaluateSelectableOperationDefinition(definitionId, snapshot, options).plan
				expect(fresh?.steps.map(step => step.id)).toEqual(plan.steps.filter(step => !step.id.startsWith('approve-')).map(step => step.id))
				for (const confirmedStepIds of [[], approvals.map(approval => approval.step.id)]) {
					const resumed = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds }).plan
					expect(resumed?.continuationDisposition).toBeUndefined()
					expect(resumed?.steps.map(step => step.id)).toEqual(fresh?.steps.map(step => step.id))
					expect(resumed?.steps.at(-1)?.data).toBe(plan.steps.at(-1)?.data)
				}
				if (definitionId === 'statoblast.oracle.request-price' && excess > 0n) expect(fresh?.steps.at(-1)?.evidence.some(item => item.kind === 'storage-postcondition' && item.functionName === 'allowance')).toBe(false)
			}
		})
		test(`${definitionId} still approves an insufficient allowance`, () => {
			const { snapshot, plan, approvals } = fixture(definitionId)
			for (const approval of approvals) approval.token.allowances[approval.spender] = (approval.amount - 1n).toString()
			const rebuilt = evaluateSelectableOperationDefinition(definitionId, snapshot, options).plan
			expect(rebuilt?.steps.map(step => step.data)).toEqual(plan.steps.map(step => step.data))
		})
	}
})

for (const definitionId of definitions.slice(0, 3)) {
	test(`${definitionId} approves only the shortfall token and cleans up only its own approval`, () => {
		const { snapshot, approvals } = fixture(definitionId)
		const existing = approvals[0]
		const needed = approvals[1]
		if (existing === undefined || needed === undefined) throw new Error('Expected two approvals')
		existing.token.allowances[existing.spender] = (existing.amount + 1n).toString()
		const plan = evaluateSelectableOperationDefinition(definitionId, snapshot, options).plan
		if (plan === undefined) throw new Error('Expected partially approved plan')
		expect(plan.steps.filter(step => step.id.startsWith('approve-')).map(step => step.id)).toEqual([needed.step.id])
		needed.token.allowances[needed.spender] = needed.amount.toString()
		const cleanup = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: [needed.step.id], continuationDisposition: 'cleanup-only' }).plan
		expect(cleanup?.steps).toHaveLength(1)
		expect(cleanup?.steps[0]?.to).toBe(needed.token.address)
		const resumed = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: [needed.step.id] }).plan
		expect(resumed?.steps).toHaveLength(1)
		if (definitionId === 'statoblast.oracle.request-price') {
			const checks = resumed?.steps[0]?.evidence.filter(item => item.kind === 'storage-postcondition' && item.functionName === 'allowance')
			expect(checks).toEqual([expect.objectContaining({ contract: needed.token.address, expected: '0' })])
		}
	})
}

test('reusing an externally supplied escalation allowance still requires a successful deposit simulation', () => {
	const { snapshot, plan, approvals } = fixture('statoblast.escalation.deposit-wallet-rep')
	for (const approval of approvals) approval.token.allowances[approval.spender] = approval.amount.toString()
	for (const pool of snapshot.pools) for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = false
	expect(reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: [] }).plan).toBeUndefined()
})
