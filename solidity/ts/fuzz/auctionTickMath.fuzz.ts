import { beforeAll, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { type Address } from 'viem'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../types/contractArtifact'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { ensureInfraDeployed } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { getUniformPriceDualCapBatchAuctionAddress } from '../testsuite/simulator/utils/contracts/deployments'
import { deployUniformPriceDualCapBatchAuction } from '../testsuite/simulator/utils/contracts/auction'
import { ensureZoltarDeployed } from '../testsuite/simulator/utils/contracts/zoltar'
import { tickToPrice } from '../testsuite/simulator/utils/tickMath'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { contractExists, setupTestAccounts } from '../testsuite/simulator/utils/utilities'

const MIN_TICK = -524288n
const MAX_TICK = 524288n
const FUZZ_CASES = 2_000

setDefaultTimeout(TEST_TIMEOUT_MS)

const nextRandomUint32 = (state: bigint): bigint => (state * 1664525n + 1013904223n) & 0xffffffffn

const buildFuzzTicks = () => {
	const ticks = new Set<bigint>([MIN_TICK, MIN_TICK + 1n, -1n, 0n, 1n, MAX_TICK - 1n, MAX_TICK])
	let state = 0xdecafbadn
	const tickDomainSize = MAX_TICK - MIN_TICK + 1n
	while (ticks.size < FUZZ_CASES) {
		state = nextRandomUint32(state)
		ticks.add(MIN_TICK + (state % tickDomainSize))
	}
	return [...ticks]
}

describe('Auction tick math fuzz', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let auctionAddress: Address

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		await setupTestAccounts(mockWindow)
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await deployUniformPriceDualCapBatchAuction(client, client.account.address)
		auctionAddress = getUniformPriceDualCapBatchAuctionAddress(client.account.address)
		assert.ok(await contractExists(client, auctionAddress), 'auction exists')
		await setBaselineSnapshot()
	})

	test('tickToPrice matches the TypeScript model across deterministic fuzz ticks', async () => {
		for (const tick of buildFuzzTicks()) {
			const solidityPrice = await client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'tickToPrice',
				address: auctionAddress,
				args: [tick],
			})
			const typescriptPrice = tickToPrice(tick)
			assert.strictEqual(solidityPrice, typescriptPrice, `tickToPrice mismatch at tick ${tick.toString()}`)
		}
	})

	test('tickToPrice rejects ticks outside the finite domain', async () => {
		for (const tick of [MIN_TICK - 1n, MAX_TICK + 1n]) {
			await assert.rejects(
				async () =>
					await client.readContract({
						abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
						functionName: 'tickToPrice',
						address: auctionAddress,
						args: [tick],
					}),
				/Auction tick is outside the supported price range/,
			)
		}
	})
})
