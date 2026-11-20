import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_CapitalAuctionHarness_AuctionLotSizingHarness as harnessArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolAuctionVault_SecurityPoolAuctionVault as vaultArtifact,
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
	const open = async (shortfall: bigint, minimum = 1n) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: harnessArtifact.abi, address: root, functionName: 'setMinimum', args: [minimum] }))
		const deadline = (await client.getBlock()).timestamp + 3n * 86_400n
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: auctionArtifact.abi, bytecode: `0x${auctionArtifact.evm.bytecode.object}`, args: [client.account.address, root, 1n, deadline, 11_000_000n * 10n ** 18n, shortfall, implementation] }) }) })
		if (!receipt.contractAddress) throw new Error('Missing auction')
		const target = { abi: auctionArtifact.abi, address: receipt.contractAddress }
		const transaction = await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'open' }))
		const lots = await client.readContract({ ...target, functionName: 'targetLots' })
		const lot = await client.readContract({ ...target, functionName: 'lotAttoEth' })
		const rounded = await client.readContract({ ...target, functionName: 'minimumCollateralAttoRepPerLot' })
		const required = await client.readContract({ abi: indexArtifact.abi, address: index, functionName: 'requiredRep', args: [lot, 10n ** 18n, 10_500n, 10_000n] })
		return { lots, lot, rounded, required, gas: (await client.waitForTransactionReceipt({ hash: transaction })).gasUsed }
	}
	test('#1339 enlarges tiny lots until grid rounding adds less than one percent', async () => {
		const result = await open(1_000_000n)
		expect(result.lots).toBeGreaterThan(1n)
		expect(result.lots * result.lot).toBe(1_000_000n)
		expect((result.rounded - result.required) * 100n).toBeLessThan(result.required)
	})
	test('#1339 one full-deficit lot remains possible when indivisible REP exceeds the rounding target', async () => {
		const result = await open(1n)
		expect(result.lots).toBe(1n)
		expect(result.lot).toBe(1n)
		expect((result.rounded - result.required) * 100n).toBeGreaterThan(result.required)
	})
	test('#1339 six-decimal collateral raises exactly 35 USDC in two 17.5 USDC lots', async () => {
		const result = await open(35_000_000n, 10_000_000n)
		expect([result.lots, result.lot]).toEqual([2n, 17_500_000n])
	})
	test('#1339 selecting lots remains gas bounded at a 128-bit deficit', async () => {
		const shortfall = 2n ** 127n
		const result = await open(shortfall)
		expect(result.lots * result.lot).toBe(shortfall)
		expect(result.gas).toBeLessThan(3_000_000n)
	})
})
