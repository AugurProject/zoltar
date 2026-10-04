import { expect, test } from 'bun:test'
import { genesisUniswapV3SeederAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { evaluateSelectableOperationDefinition, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { address, snapshotFixture } from './fixture.ts'

const options = { allowHighRisk: true, maximumBlockIntervalSeconds: 15, maxEthSpendAttoEth: '100', maxRepSpendAttoRep: '100', minimumRepReserveAttoRep: '1000', seed: 1 }

for (const scope of ['genesis', 'universe'] as const) {
	test(`${scope} REP/WETH top-up mints a bounded wallet position only in a funded pool`, () => {
		const snapshot = snapshotFixture()
		const genesis = snapshot.universes[0]
		if (genesis === undefined) throw new Error('Missing genesis fixture')
		const rep = scope === 'genesis' ? genesis.repToken : address(43)
		if (scope === 'universe') {
			snapshot.universes.push({ ...genesis, id: '2', repToken: rep })
			snapshot.wallet.tokens.push({ address: rep, allowances: {}, balance: '1010', openOracleCredit: '0', openOracleInternalAllowanceToSelf: '0', symbol: 'REP' })
		}
		const inventory = snapshot.wallet.tokens.find(token => token.address === rep)
		if (inventory === undefined) throw new Error('Missing REP inventory')
		inventory.balance = '1010'
		snapshot.genesisUniswap = { factory: true, initialized: true, liquidity: '1', pool: address(41), proxy: true, seeder: true }
		const childPool = { initialized: true, liquidity: '1', pool: address(45), repToken: rep, universeId: '2' }
		snapshot.universeUniswap = { factory: true, pools: [childPool], proxy: true, seeder: true }
		const id = `trading.${scope}-uniswap.add-liquidity`
		const plan = evaluateSelectableOperationDefinition(id, snapshot, options).plan
		if (plan === undefined) throw new Error('Missing top-up plan')
		expect(plan.maximumCleanupTransactionCount).toBe(2)
		const mint = plan.steps.at(-1)
		if (mint === undefined) throw new Error('Missing mint step')
		const call = decodeFunctionData({ abi: genesisUniswapV3SeederAbi, data: mint.data })
		if (call.functionName !== 'seed') throw new Error('Expected seed helper')
		const token0 = rep.toLowerCase() < snapshot.deployments.weth.toLowerCase() ? rep : snapshot.deployments.weth
		const token1 = token0 === rep ? snapshot.deployments.weth : rep
		expect(call.args).toEqual([scope === 'genesis' ? address(41) : address(45), token0, token1, -887_200n, 887_200n, 5n, token0 === rep ? 10n : 100n, token1 === rep ? 10n : 100n, snapshot.wallet.address])
		expect(mint.walletAssetDebits.map(debit => debit.amount)).toEqual(token0 === rep ? ['10', '100'] : ['100', '10'])
		expect(evaluateSelectableOperationDefinition(`trading.${scope}-uniswap.seed-pool`, snapshot, options).plan).toBeUndefined()
		// Reordering candidates must not redirect a partially approved child workflow.
		if (scope === 'universe') snapshot.universeUniswap.pools.unshift({ ...childPool, pool: address(46), universeId: '1' })
		expect(reevaluateOperationContinuation(snapshot, plan, options).plan?.metadata).toEqual(plan.metadata)
		snapshot.genesisUniswap.liquidity = '0'
		childPool.liquidity = '0'
		if (scope === 'universe') snapshot.universeUniswap.pools = [childPool]
		expect(evaluateSelectableOperationDefinition(id, snapshot, options).plan).toBeUndefined()
		childPool.liquidity = '1'
		snapshot.genesisUniswap.liquidity = '1'
		childPool.initialized = false
		snapshot.genesisUniswap.initialized = false
		expect(evaluateSelectableOperationDefinition(id, snapshot, options).plan).toBeUndefined()
		childPool.initialized = true
		snapshot.genesisUniswap.initialized = true
		snapshot.genesisUniswap.seeder = false
		snapshot.universeUniswap.seeder = false
		expect(evaluateSelectableOperationDefinition(id, snapshot, options).plan).toBeUndefined()
		snapshot.genesisUniswap.seeder = true
		snapshot.universeUniswap.seeder = true
		inventory.balance = '1000'
		expect(evaluateSelectableOperationDefinition(id, snapshot, options).plan).toBeUndefined()
		inventory.balance = (10n ** 18n).toString()
		const capped = evaluateSelectableOperationDefinition(id, snapshot, { ...options, maxRepSpendAttoRep: (10n ** 18n).toString(), maxEthSpendAttoEth: (10n ** 18n).toString() }).plan
		expect(capped?.metadata['maximum0']).toBe((10n ** 15n).toString())
		expect(capped?.metadata['maximum1']).toBe((10n ** 15n).toString())
	})
}
