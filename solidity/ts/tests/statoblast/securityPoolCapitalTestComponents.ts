import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer as capitalDeployer,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerTestComponents as components,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'

export async function deployCapitalTestComponents(client: WriteClient) {
	const deployer = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${capitalDeployer.evm.bytecode.object}` }) })
	if (deployer.contractAddress === undefined) throw new Error('Capital deployer address missing')
	return client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: components.abi, bytecode: `0x${components.evm.bytecode.object}`, args: [deployer.contractAddress] }) }) })
}

/** Deploys a capital ledger harness over fresh test components and returns the harness with its ledger, commitment index, and REP token. */
export async function deployCapitalLedgerHarness(client: WriteClient) {
	const componentsReceipt = await deployCapitalTestComponents(client)
	if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
	const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
	if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
	const harness = receipt.contractAddress
	const ledger = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
	const token = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
	const index = await client.readContract({ abi: capitalArtifact.abi, address: ledger, functionName: 'commitmentIndex' })
	return { harness, ledger, token, index }
}

/** Mints `amount` harness REP to each owner and approves the ledger to pull it. */
export async function fundCapitalOwners(minter: WriteClient, deployment: { harness: Address; ledger: Address; token: Address }, owners: readonly WriteClient[], amount: bigint) {
	for (const owner of owners) {
		await writeContractAndWait(minter, () => minter.writeContract({ abi: harnessArtifact.abi, address: deployment.harness, functionName: 'mint', args: [owner.account.address, amount] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: deployment.token, functionName: 'approve', args: [deployment.ledger, amount] }))
	}
}
