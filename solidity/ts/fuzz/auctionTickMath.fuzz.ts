import { beforeAll, describe, setDefaultTimeout, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { type Address } from '@zoltar/shared/ethereum'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../types/contractArtifact'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { ensureInfraDeployed } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { getUniformPriceDualCapBatchAuctionAddress } from '../testSupport/simulator/utils/contracts/deployments'
import { deployUniformPriceDualCapBatchAuction } from '../testSupport/simulator/utils/contracts/auction'
import { ensureZoltarDeployed } from '../testSupport/simulator/utils/contracts/zoltar'
import { priceToClosestTick, tickToPrice } from '../testSupport/simulator/utils/tickMath'
import { createWriteClient, WriteClient } from '../testSupport/simulator/utils/clients'
import { contractExists, setupTestAccounts } from '../testSupport/simulator/utils/utilities'

const MIN_TICK = -524288n
const MAX_TICK = 524288n
const FUZZ_CASES = 2_000
const INDEPENDENT_PRICE_VECTORS = [
	[-1000n, 904841941932768878n],
	[-511n, 950186074977093008n],
	[-255n, 974823621782212824n],
	[-100n, 990050328741209481n],
	[-10n, 999000549780071479n],
	[-3n, 999700059990001499n],
	[-1n, 999900009999000099n],
	[0n, 1000000000000000000n],
	[1n, 1000100000000000000n],
	[3n, 1000300030001000000n],
	[10n, 1001000450120021002n],
	[100n, 1010049662092876568n],
	[255n, 1025826598427886555n],
	[511n, 1052425442063132635n],
	[1000n, 1105165392603232697n],
] as const

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
		const sortedTicks = buildFuzzTicks().sort((left, right) => {
			if (left < right) return -1
			if (left > right) return 1
			return 0
		})
		let previousPrice: bigint | undefined
		for (const tick of sortedTicks) {
			const solidityPrice = await client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'tickToPrice',
				address: auctionAddress,
				args: [tick],
			})
			const typescriptPrice = tickToPrice(tick)
			assert.strictEqual(solidityPrice, typescriptPrice, `tickToPrice mismatch at tick ${tick.toString()}`)
			if (previousPrice !== undefined) assert.ok(solidityPrice >= previousPrice, `tickToPrice is not monotonic at tick ${tick.toString()}`)
			previousPrice = solidityPrice
		}
	})

	test('tickToPrice stays within its documented rounding budget of independent rational-price vectors', async () => {
		for (const [tick, exactRationalPrice] of INDEPENDENT_PRICE_VECTORS) {
			const solidityPrice = await client.readContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'tickToPrice',
				address: auctionAddress,
				args: [tick],
			})
			const roundingDifference = solidityPrice > exactRationalPrice ? solidityPrice - exactRationalPrice : exactRationalPrice - solidityPrice
			assert.ok(roundingDifference <= 8n, `tickToPrice exceeded the 8 wei rounding budget at tick ${tick.toString()}`)
		}
	})

	test('priceToClosestTick inverts exact supported prices around zero', () => {
		for (let tick = -10_000n; tick <= 10_000n; tick += 137n) {
			assert.strictEqual(priceToClosestTick(tickToPrice(tick)), tick, `priceToClosestTick failed to invert tick ${tick.toString()}`)
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
