import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_CapitalRepairAuctionHarness_RepairAuctionLotSizingHarness as harnessArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolRepairAuctionVault_SecurityPoolRepairAuctionVault as vaultArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

describe('Statoblast: full-deficit auction lot sizing', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let root: Address
	let implementation: Address
	let index: Address
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const components = await deployCapitalTestComponents(client)
		if (!components.contractAddress) throw new Error('Missing components')
		const rootReceipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [components.contractAddress] }) }) })
		const vaultReceipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${vaultArtifact.evm.bytecode.object}` }) })
		if (!rootReceipt.contractAddress || !vaultReceipt.contractAddress) throw new Error('Missing lot-sizing dependencies')
		root = rootReceipt.contractAddress
		implementation = vaultReceipt.contractAddress
		const ledger = await client.readContract({ abi: harnessArtifact.abi, address: root, functionName: 'ledger' })
		index = await client.readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'commitmentIndex' })
		await node.setBaselineSnapshot()
	})
	const open = async (shortfall: bigint, minimum = 1n, inventory = 11_000_000n * 10n ** 18n) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: root, functionName: 'setMinimum', args: [minimum] }))
		const deadline = (await client.getBlock()).timestamp + 3n * 86_400n
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: auctionArtifact.abi, bytecode: `0x${auctionArtifact.evm.bytecode.object}`, args: [client.account.address, root, 1n, deadline, inventory, shortfall, implementation] }) }) })
		if (!receipt.contractAddress) throw new Error('Missing auction')
		const target = { abi: auctionArtifact.abi, address: receipt.contractAddress }
		const transaction = await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'open' }))
		const lots = await client.readContract({ ...target, functionName: 'targetLots' })
		const lot = await client.readContract({ ...target, functionName: 'lotAttoEth' })
		const rounded = await client.readContract({ ...target, functionName: 'minimumCollateralAttoRepPerLot' })
		const required = await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'requiredRep', args: [lot, 10n ** 18n, 10_500n, 10_000n] })
		return { lots, lot, rounded, required, gas: (await client.waitForTransactionReceipt({ hash: transaction })).gasUsed }
	}
	const unit = 10n ** 18n
	const expectCoveringLots = (result: { lots: bigint; lot: bigint }, shortfall: bigint) => {
		expect(result.lots * result.lot).toBeGreaterThanOrEqual(shortfall)
		expect((result.lots - 1n) * result.lot).toBeLessThan(shortfall)
		expect(result.lots * result.lot - shortfall).toBeLessThan(result.lots)
	}
	test.each([
		{ shortfall: 60n, minimum: 15n, inventory: 21n },
		{ shortfall: 58n, minimum: 5n, inventory: 42n },
		{ shortfall: 61n, minimum: 20n, inventory: 21n },
	])('rejects unaffordable default lots without searching smaller lots ($shortfall, $minimum, $inventory)', async ({ shortfall, minimum, inventory }) => {
		// A 20-attoETH lot covers the configured minimum and needs exactly one
		// REP grid of collateral. Its affordability must not change lot sizing.
		const smallerRequired = await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'requiredRep', args: [20n, unit, 10_500n, 10_000n] })
		expect(20n).toBeGreaterThanOrEqual(minimum)
		expect(smallerRequired).toBe(21n)
		expect(smallerRequired).toBeLessThanOrEqual(inventory)
		await expect(open(shortfall, minimum, inventory)).rejects.toThrow('Collateral repair auction inventory cannot back one lot')
	})
	test('opens when inventory exactly backs the default lot after rounding', async () => {
		const result = await open(60n, 15n, 63n)
		expect([result.lots, result.lot, result.rounded]).toEqual([1n, 60n, 63n])
	})
	test('rejects inventory that cannot fund a lot satisfying the minimum and rounding policy', async () => {
		await expect(open(61n, 21n, 42n)).rejects.toThrow('Collateral repair auction inventory cannot back one lot')
	})
	test('#1339 enlarges tiny lots until grid rounding adds less than one percent', async () => {
		const result = await open(1_000_000n)
		expect(result.lots).toBeGreaterThan(1n)
		expectCoveringLots(result, 1_000_000n)
		expect((result.rounded - result.required) * 100n).toBeLessThan(result.required)
	})
	test('#1339 one full-deficit lot remains possible when indivisible REP exceeds the rounding target', async () => {
		const result = await open(1n)
		expect(result.lots).toBe(1n)
		expect(result.lot).toBe(1n)
		expect((result.rounded - result.required) * 100n).toBeGreaterThan(result.required)
	})
	test('#1339 six-decimal collateral covers 35 USDC in three equal lots of at least 10 USDC', async () => {
		const result = await open(35_000_000n, 10_000_000n)
		expect([result.lots, result.lot]).toEqual([3n, 11_666_667n])
		expectCoveringLots(result, 35_000_000n)
	})
	test('#1339 selecting lots remains gas bounded at a 128-bit deficit', async () => {
		const shortfall = 2n ** 127n
		const result = await open(shortfall)
		expect(result.lots * result.lot).toBe(shortfall)
		expect(result.gas).toBeLessThan(3_000_000n)
	})
	test('#1551 a deficit one attoETH above a round amount still sells about one minimum-size lot per minimum commitment', async () => {
		const shortfall = 1_000n * unit + 1n
		const result = await open(shortfall, unit)
		expect([result.lots, result.lot]).toEqual([1_000n, unit + 1n])
		expectCoveringLots(result, shortfall)
	})
	test('#1551 the lot count does not depend on how many times two divides the deficit', async () => {
		for (const remainder of [2n, 3n, 7n, 12_345_678_901n, unit / 3n, unit - 1n]) {
			const shortfall = 1_000n * unit + remainder
			const result = await open(shortfall, unit)
			expect(result.lots).toBe(1_000n)
			expect(result.lot).toBe((shortfall + 999n) / 1_000n)
			expectCoveringLots(result, shortfall)
		}
	})
})
