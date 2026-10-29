import { beforeAll } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capital,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as commitments,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	ReputationToken_ReputationToken as rep,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployCapitalTestComponents } from './securityPoolCapitalTestComponents'

export const capitalUnit = 10n ** 18n

export function useCapitalTestFixture() {
	const node = useIsolatedAnvilNode()
	let clients: WriteClient[] = []
	let harness: Address
	let ledger: Address
	let index: Address
	let token: Address
	let componentsAddress: Address
	const client = (offset = 0) => {
		const selected = clients[offset]
		if (selected === undefined) throw new Error(`Capital test client ${offset} unavailable`)
		return selected
	}
	const deploy = async () => {
		const receipt = await client().waitForTransactionReceipt({ hash: await client().sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness deployment failed')
		const address = receipt.contractAddress
		const capitalAddress = await client().readContract({ abi: harnessArtifact.abi, address, functionName: 'ledger' })
		return { address, ledger: capitalAddress, index: await client().readContract({ abi: capital.abi, address: capitalAddress, functionName: 'commitmentIndex' }), token: await client().readContract({ abi: harnessArtifact.abi, address, functionName: 'token' }) }
	}
	const price = async (value: bigint) => writeContractAndWait(client(), async () => client().writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [value, Number((await client().getBlock()).timestamp + 10_000_000n)] }))
	const owner = (offset: number) => client().readContract({ abi: capital.abi, address: ledger, functionName: 'ownerAccount', args: [client(offset).account.address] })
	const position = (id: bigint) => client().readContract({ abi: commitments.abi, address: index, functionName: 'accountOf', args: [id] })
	const deposit = (offset: number, amount: bigint) => writeContractAndWait(client(offset), () => client(offset).writeContract({ abi: capital.abi, address: ledger, functionName: 'depositFor', args: [client(offset).account.address, amount] }))
	const authorize = async (offset: number, amount: bigint) => {
		await writeContractAndWait(client(offset), () => client(offset).writeContract({ abi: capital.abi, address: ledger, functionName: 'authorize', args: [amount] }))
		return (await owner(offset)).positionId
	}
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		clients = TEST_ADDRESSES.slice(0, 4).map(address => createWriteClient(node.getAnvilWindowEthereum(), address))
		const receipt = await deployCapitalTestComponents(client())
		if (receipt.contractAddress === undefined) throw new Error('Capital test components deployment failed')
		componentsAddress = receipt.contractAddress
		const deployed = await deploy()
		harness = deployed.address
		ledger = deployed.ledger
		index = deployed.index
		token = deployed.token
		await price(capitalUnit)
		await node.setBaselineSnapshot()
	})
	const fundOwners = async () => {
		for (const sender of clients) {
			await writeContractAndWait(client(), () => client().writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [sender.account.address, 10_000n * capitalUnit] }))
			await writeContractAndWait(sender, () => sender.writeContract({ abi: rep.abi, address: token, functionName: 'approve', args: [ledger, 10_000n * capitalUnit] }))
			await writeContractAndWait(sender, () => sender.writeContract({ abi: capital.abi, address: ledger, functionName: 'fundExecutionReserve', args: [sender.account.address], value: 100n * capitalUnit }))
		}
	}
	return {
		...node,
		client,
		deploy,
		price,
		owner,
		position,
		deposit,
		authorize,
		fundOwners,
		get harness() {
			return { abi: harnessArtifact.abi, address: harness }
		},
		get capital() {
			return { abi: capital.abi, address: ledger }
		},
		get commitments() {
			return { abi: commitments.abi, address: index }
		},
		get token() {
			return { abi: rep.abi, address: token }
		},
	}
}
