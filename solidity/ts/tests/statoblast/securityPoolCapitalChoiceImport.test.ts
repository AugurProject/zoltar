import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact, test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

const E = 10n ** 18n

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
		const componentsReceipt = await deployCapitalTestComponents(owner)
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

	test('imported choices preserve personal collateral, retirement cohorts without ETH funding', async () => {
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, { rep: 126n * E, commitment: 100n * E, batch: 0n, remainingCommitment: 0n }, 12_000n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [owner.account.address, { rep: 158n * E, commitment: 100n * E, batch: 1n, remainingCommitment: 0n }, 15_000n] }))
		expect(await position(1n)).toMatchObject({ rep: 126n * E, commitment: 100n * E, batch: 0n })
		expect(await position(2n)).toMatchObject({ rep: 158n * E, commitment: 100n * E, batch: 1n })
		expect((await account(owner.account.address)).targetHealthFactorBps).toBe(15_000n)
		await expect(finish()).rejects.toThrow('Fork principal unfunded')
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [ledger, 284n * E] }))
		await finish()
		await expect(finish()).rejects.toThrow('Fork import unavailable')
	})

	test('choice import requires authenticated authority without an ETH payment', async () => {
		const imported = { rep: 126n * E, commitment: 100n * E, batch: 0n, remainingCommitment: 0n }
		await expect(buyer.writeContract({ abi: artifact.abi, address: ledger, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n] })).rejects.toThrow('Only fork authority')
		expect((await account(buyer.account.address)).positionId).toBe(0n)
	})

	test('a fresh child price is cached during import without starting liquidation observations', async () => {
		const imported = { rep: 126n * E, commitment: 100n * E, batch: 0n, remainingCommitment: 0n }
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [ledger, imported.rep] }))
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [2n * E, Number(now + 100_000n)] }))
		expect(await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'conservativePrice' })).toBe(2n * E)
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'healthObservationEpoch' })).toBe(1n)
		expect(await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [1n] })).toBe(0n)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await finish()
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'healthObservationEpoch' })).toBe(2n)
		expect(await owner.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [1n] })).toBe((await owner.getBlock()).timestamp)
	})
	test('an expired preparation price does not block activation or start a liquidation clock', async () => {
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [2n * E, Number(now + 20n)] }))
		await getAnvilWindowEthereum().advanceTime(21n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'finishImport', args: [0n] }))
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'healthObservationEpoch' })).toBe(1n)
	})
	test('a fork import preserves a partial retirement stop and keeps all collateral behind the residual', async () => {
		const imported = { rep: 126n * E, commitment: 100n * E, batch: 1n, remainingCommitment: 60n * E }
		await writeContractAndWait(owner, () => owner.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'importChoice', args: [buyer.account.address, imported, 12_000n] }))
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
