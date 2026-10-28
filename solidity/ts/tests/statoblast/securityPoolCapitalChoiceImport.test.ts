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

describe('Statoblast: funded fork choice imports', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let owner: WriteClient
	let buyer: WriteClient
	let harness: Address
	let ledger: Address
	let index: Address
	const account = (holder: Address) => owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [holder] })
	const position = (id: bigint) => owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
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

	test('imported choices preserve personal collateral, retirement cohorts and execution budgets', async () => {
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, { rep: 126n * E, commitment: 100n * E, batch: 0n, executionReserveAttoEth: reserve, remainingCommitment: 0n }, 12_000n], value: 2n * reserve }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [owner.account.address, { rep: 158n * E, commitment: 100n * E, batch: 1n, executionReserveAttoEth: reserve, remainingCommitment: 0n }, 15_000n], value: reserve }))
		expect(await position(1n)).toMatchObject({ rep: 126n * E, commitment: 100n * E, batch: 0n })
		expect(await position(2n)).toMatchObject({ rep: 158n * E, commitment: 100n * E, batch: 1n })
		expect((await account(buyer.account.address)).executionReserveAttoEth).toBe(reserve)
		expect((await account(owner.account.address)).targetHealthFactorBps).toBe(15_000n)
		await expect(finish()).rejects.toThrow('Fork principal unfunded')
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [ledger, 284n * E] }))
		await finish()
		await expect(finish()).rejects.toThrow('Fork import unavailable')
	})

	test('choice import requires actual execution funding and authenticated authority', async () => {
		const imported = { rep: 126n * E, commitment: 100n * E, batch: 0n, executionReserveAttoEth: reserve, remainingCommitment: 0n }
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n], value: reserve - 1n }))).rejects.toThrow('Fork execution reserve unfunded')
		expect((await account(buyer.account.address)).positionId).toBe(0n)
		await expect(buyer.writeContract({ abi: artifact.abi, address: ledger, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n], value: reserve })).rejects.toThrow('Only fork authority')
	})
	test('a fork import preserves a partial retirement stop and keeps all collateral behind the residual', async () => {
		const imported = { rep: 126n * E, commitment: 100n * E, batch: 1n, executionReserveAttoEth: reserve, remainingCommitment: 60n * E }
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n], value: reserve }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [ledger, imported.rep] }))
		await finish()
		expect(await position(1n)).toMatchObject({ commitment: 100n * E, remainingCommitment: 60n * E, batch: 1n })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [60n * E] }))
		expect(await position(1n)).toMatchObject({ rep: 126n * E, commitment: 60n * E, remainingCommitment: 0n, batch: 0n, releasedRep: 0n })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [0n] }))
		expect(await position(1n)).toMatchObject({ rep: 126n * E, commitment: 60n * E, batch: 0n })
		expect((await account(buyer.account.address)).targetHealthFactorBps).toBe(12_000n)
	})
})
