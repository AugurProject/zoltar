import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerTestComponents as componentsArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const E = 10n ** 18n
const reserve = 10n * E

describe('Statoblast: atomic recap capital ownership', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let owner: WriteClient
	let buyer: WriteClient
	let harness: Address
	let ledger: Address
	let index: Address
	const account = (holder: Address) => owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [holder] })
	const position = (id: bigint) => owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const fill = (holder: Address, rep: bigint, commitment: bigint, target: bigint, value = 0n) => writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importAuction', args: [holder, rep, commitment, target], value }))
	const finish = () => writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [100n * E] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		buyer = createWriteClient(ethereum, TEST_ADDRESSES[1])
		const componentsReceipt = await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: `0x${componentsArtifact.evm.bytecode.object}` }) })
		if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
		const receipt = await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
		harness = receipt.contractAddress
		ledger = await owner.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		index = await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'commitmentIndex' })
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [E, Number(now + 100_000n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'beginImport' }))
		await setBaselineSnapshot()
	})

	test('recap fills merge into the chosen active slot without changing closed retirement authorization', async () => {
		await writeContractAndWait(owner, () =>
			owner.writeContract({
				abi: harnessArtifact.abi,
				address: harness,
				functionName: 'importChoice',
				args: [
					buyer.account.address,
					[
						{ rep: 126n * E, commitment: 100n * E, batch: 0n, executionReserveAttoEth: reserve },
						{ rep: 126n * E, commitment: 100n * E, batch: 1n, executionReserveAttoEth: reserve },
						{ rep: 0n, commitment: 0n, batch: 2n, executionReserveAttoEth: 0n },
					],
					12_000n,
				],
				value: 3n * reserve,
			}),
		)
		await fill(buyer.account.address, 63n * E, 50n * E, 12_000n)
		await fill(buyer.account.address, 63n * E, 50n * E, 12_000n)
		expect((await account(buyer.account.address)).positions).toEqual([1n, 2n, 0n])
		expect(await position(1n)).toMatchObject({ rep: 252n * E, commitment: 200n * E, batch: 0n })
		expect(await position(2n)).toMatchObject({ rep: 126n * E, commitment: 100n * E, batch: 1n })
		expect(await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'positionExecutionReserveAttoEth', args: [1n] })).toBe(2n * reserve)
		await expect(finish()).rejects.toThrow('Fork principal unfunded')
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [ledger, 378n * E] }))
		await finish()
		await expect(fill(buyer.account.address, 63n * E, 50n * E, 12_000n)).rejects.toThrow('Auction import unavailable')
	})

	test('every new buyer funds their own selected health and execution reserve before becoming an owner', async () => {
		await expect(fill(buyer.account.address, 105n * E, 100n * E, 15_000n, reserve)).rejects.toThrow('Auction collateral below chosen health')
		await expect(fill(buyer.account.address, 158n * E, 100n * E, 15_000n)).rejects.toThrow('Fund execution reserve')
		expect((await account(buyer.account.address)).positions).toEqual([0n, 0n, 0n])
		await fill(buyer.account.address, 158n * E, 100n * E, 15_000n, 3n * reserve)
		expect(await position(1n)).toMatchObject({ owner: buyer.account.address, rep: 158n * E, commitment: 100n * E, batch: 0n })
		expect(await account(buyer.account.address)).toMatchObject({ targetHealthFactorBps: 15_000n, executionReserveAttoEth: 2n * reserve })
		await expect(fill(buyer.account.address, 21n * E, 10n * E, 20_000n)).rejects.toThrow('Combined auction health below target')
		await expect(buyer.writeContract({ abi: artifact.abi, address: ledger, functionName: 'importAuctionPosition', args: [buyer.account.address, 158n * E, 100n * E, 15_000n], value: reserve })).rejects.toThrow('Only fork authority')
	})
})
