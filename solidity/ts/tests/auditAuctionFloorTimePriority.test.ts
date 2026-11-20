import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact, test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact } from '../types/contractArtifact'

const LOT = 10n ** 15n
const TARGET = 100n
const GRID = 10n ** 12n
const FLOOR = 10n ** 16n
const honest = addressString(0xb001n)
const attacker = addressString(0xb002n)

// #1256: bids at the health floor cannot be outranked. Under pro-rata sharing a last-block
// bid many times the target took almost the whole fill. Equal limits now fill in
// submission order, so earlier floor bids keep their lots.
describe('audit: collateral repair auction equal-limit bids fill in submission order', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let controller: Address
	let token: Address

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		controller = addressString(TEST_ADDRESSES[0])
		await ethereum.impersonateAccount(controller)
		await ethereum.setBalance(controller, 10n ** 24n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		token = await deployContract(client, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [18] }))
		await setBaselineSnapshot()
	})

	const startEngine = async () => {
		const engine = await deployContract(client, encodeDeployData({ abi: engineArtifact.abi, bytecode: `0x${engineArtifact.evm.bytecode.object}`, args: [controller, token] }))
		const now = (await client.getBlock()).timestamp
		await writeContractAndWait(client, () => client.writeContract({ abi: engineArtifact.abi, address: engine, functionName: 'startAuction', args: [now, now + 1_000n, LOT, TARGET, TARGET * FLOOR * 10n, GRID, controller] }))
		const bid = async (bidder: Address, lots: bigint) => {
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [engine, lots * LOT] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: engineArtifact.abi, address: engine, functionName: 'submitBid', args: [bidder, bidder, 12_000n, lots, FLOOR] }))
			return await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bidCount' })
		}
		const finalize = async () => {
			await getAnvilWindowEthereum().advanceTime(2_000n)
			await writeContractAndWait(client, () => client.writeContract({ abi: engineArtifact.abi, address: engine, functionName: 'finalize', args: [TARGET, FLOOR] }))
		}
		const filled = async (bidId: bigint) => (await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'previewBid', args: [bidId] })).filledLots
		return { engine, bid, finalize, filled }
	}

	test('a late oversized floor bid fills only what earlier floor bids leave', async () => {
		const { bid, finalize, filled } = await startEngine()
		const first = await bid(honest, 60n)
		const late = await bid(attacker, 10_000n)
		await finalize()
		expect(await filled(first)).toBe(60n)
		expect(await filled(late)).toBe(TARGET - 60n)
	})

	test('a floor bid after equal demand that already covers the target is refused', async () => {
		const { engine, bid, finalize, filled } = await startEngine()
		const first = await bid(honest, TARGET)
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [engine, 10_000n * LOT] }))
		await expect(client.simulateContract({ abi: engineArtifact.abi, address: engine, functionName: 'submitBid', args: [attacker, attacker, 12_000n, 10_000n, FLOOR] })).rejects.toThrow('Better bids already exclude this bid')
		await finalize()
		expect(await filled(first)).toBe(TARGET)
	})
	test('#1331 an undersubscribed bid buys only its clearing-price REP', async () => {
		const { engine, bid, finalize } = await startEngine()
		await bid(honest, 1n)
		await finalize()
		const clearing = await client.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'clearing' })
		expect(clearing.filledLots).toBe(1n)
		expect(clearing.attoRepPerLot).toBe(FLOOR)
		expect(clearing.soldAttoRep).toBe(FLOOR)
		expect(clearing.roundingAttoRep).toBe(0n)
	})
})
