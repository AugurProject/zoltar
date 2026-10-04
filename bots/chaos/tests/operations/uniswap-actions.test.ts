import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { genesisUniswapV3SeederAbi } from '@zoltar/bot-shared/contracts/abi'
import { chaosUniswapV3RouterAbi } from '../../src/contracts/uniswap-abi.ts'
import { retirementUniswapV3PositionAbi } from '../../src/contracts/retirement-abi.ts'
import { UNISWAP_POSITION_RANGES } from '../../src/core/uniswap-ranges.ts'
import { collectableUniswapFees } from '../../src/core/uniswap-fees.ts'
import { evaluateSelectableOperationDefinition, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { reconcileV3PositionJournal } from '../../src/runtime/retirement-v3-positions.ts'
import { initialRetirementState } from '../../src/state/retirement.ts'
import { createDurableWorkflow } from '../../src/runtime/workflows.ts'
import { address, hash } from './fixture.ts'
import { uniswapActionsFixture } from './uniswap-fixture.ts'

const options = { seed: 1, maximumBlockIntervalSeconds: 15, maxRepSpendAttoRep: 10000n.toString(), maxEthSpendAttoEth: 10000n.toString(), minimumRepReserveAttoRep: 1000n.toString() }

test.each(['rep-for-weth', 'weth-for-rep'] as const)('bounded %s swap preserves exact calldata after approvals and cleans up on expiry', direction => {
	const snapshot = uniswapActionsFixture()
	const plan = evaluateSelectableOperationDefinition(`trading.uniswap.swap-${direction}`, snapshot, options).plan
	if (plan === undefined) throw new Error('Swap missing')
	const swap = plan.steps.at(-1)
	if (swap === undefined) throw new Error('Swap step missing')
	const call = decodeFunctionData({ abi: chaosUniswapV3RouterAbi, data: swap.data })
	if (call.functionName !== 'exactInputSingle') throw new Error('Expected swap')
	expect(call.args[0]).toMatchObject({ fee: 10000n, recipient: snapshot.wallet.address, amountIn: 10000n, amountOutMinimum: 9801n })
	expect(call.args[0].deadline).toBeGreaterThan(BigInt(snapshot.anchor.timestamp))
	expect(swap.walletAssetDebits[0]?.amount).toBe('10000')
	for (const token of snapshot.wallet.tokens) token.allowances[address(44)] = '10000'
	snapshot.universeUniswap?.pools.reverse()
	const continued = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['approve-uniswap-swap'] }).plan
	expect(continued?.steps.map(step => step.data)).toEqual([swap.data])
	expect(reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['approve-uniswap-swap', 'swap-uniswap'] }).plan?.steps.some(step => step.id === 'swap-uniswap')).not.toBe(true)
	snapshot.anchor.timestamp = call.args[0].deadline.toString()
	const cleanup = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['approve-uniswap-swap'] }).plan
	expect(cleanup?.continuationDisposition).toBe('cleanup-only')
	expect(cleanup?.steps[0]?.id).toBe('revoke-approve-uniswap-swap')
})

test('swaps respect REP reserves, tiny output, pool depth and router authentication', () => {
	const snapshot = uniswapActionsFixture()
	const rep = snapshot.universes[0]?.repToken
	const inventory = snapshot.wallet.tokens.find(token => token.address === rep)
	if (inventory === undefined || snapshot.universeUniswap === undefined) throw new Error('Fixture missing')
	inventory.balance = '1000'
	expect(evaluateSelectableOperationDefinition('trading.uniswap.swap-rep-for-weth', snapshot, options).plan).toBeUndefined()
	const pool = snapshot.universeUniswap.pools[0]
	if (pool === undefined) throw new Error('Pool missing')
	pool.wethBalanceAttoEth = '99'
	expect(evaluateSelectableOperationDefinition('trading.uniswap.swap-weth-for-rep', snapshot, options).plan).toBeUndefined()
	pool.wethBalanceAttoEth = '1000000'
	pool.sqrtPriceX96 = '1'
	expect(evaluateSelectableOperationDefinition('trading.uniswap.swap-weth-for-rep', snapshot, options).plan).toBeUndefined()
	snapshot.universeUniswap.routerAuthenticated = false
	expect(evaluateSelectableOperationDefinition('trading.uniswap.swap-weth-for-rep', snapshot, options).plan).toBeUndefined()
})

test.each(['remove-liquidity', 'collect-fees'] as const)('%s preserves liquidity and continues with collect only after burn', action => {
	const snapshot = uniswapActionsFixture()
	const plan = evaluateSelectableOperationDefinition(`trading.uniswap.${action}`, snapshot, options).plan
	if (plan === undefined) throw new Error('Recovery plan missing')
	const update = plan.steps[0]
	if (update === undefined) throw new Error('Update missing')
	const call = decodeFunctionData({ abi: retirementUniswapV3PositionAbi, data: update.data })
	if (call.functionName !== 'burn') throw new Error('Expected burn')
	expect(call.args[2]).toBe(action === 'remove-liquidity' ? 25n : 0n)
	const continued = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['update-uniswap-position'] }).plan
	expect(continued?.steps.map(step => step.id)).toEqual(['collect-uniswap-position'])
	expect(continued?.continuationDisposition).toBe('cleanup-only')
	expect(continued?.metadata).toEqual(plan.metadata)
	expect(reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['update-uniswap-position', 'collect-uniswap-position'] }).plan).toBeUndefined()
})

test.each(UNISWAP_POSITION_RANGES.filter(range => range.id !== 'full'))('range $id is encoded, discovered, and journaled with exact ticks', range => {
	const snapshot = uniswapActionsFixture()
	const plan = evaluateSelectableOperationDefinition('trading.uniswap.mint-range', snapshot, { ...options, operationInputs: { range: range.id } }).plan
	if (plan === undefined) throw new Error('Range plan missing')
	const step = plan.steps.at(-1)
	if (step === undefined) throw new Error('Mint missing')
	const call = decodeFunctionData({ abi: genesisUniswapV3SeederAbi, data: step.data })
	if (call.functionName !== 'seed') throw new Error('Expected mint')
	expect(call.args.slice(3, 5)).toEqual([BigInt(range.tickLower), BigInt(range.tickUpper)])
	const workflow = createDurableWorkflow(plan)
	const mint = workflow.steps.at(-1)
	if (mint === undefined) throw new Error('Workflow mint missing')
	mint.status = 'confirmed'
	mint.transactionHash = hash(1)
	const retirement = initialRetirementState()
	reconcileV3PositionJournal(retirement, [workflow], 'profile', snapshot.wallet.address)
	expect(retirement.positions[0]).toMatchObject({ tickLower: range.tickLower, tickUpper: range.tickUpper, status: 'active' })
	expect(reevaluateOperationContinuation(snapshot, plan, options).plan?.metadata).toEqual(plan.metadata)
	expect(reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['seed-universe-uniswap-pool'] }).plan).toBeUndefined()
})

test('fee discovery handles in-range, out-of-range and uint256 wraparound growth', () => {
	const q = 1n << 128n
	expect(collectableUniswapFees(10n, 3n, q, 5n * q, q, q, 0, -2000, 2000)).toBe(23n)
	expect(collectableUniswapFees(10n, 3n, q, 5n * q, 3n * q, q, -3000, -2000, 2000)).toBe(13n)
	expect(collectableUniswapFees(10n, 3n, (1n << 256n) - q, q, 0n, 0n, 0, -2000, 2000)).toBe(23n)
})
