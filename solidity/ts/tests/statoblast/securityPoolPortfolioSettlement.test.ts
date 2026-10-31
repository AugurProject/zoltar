import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact, statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as artifact, ReputationToken_ReputationToken as tokenArtifact } from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

describe('Statoblast: central settlement ETH custody', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let client: WriteClient
	let address: Address
	let book: Address
	const target = () => ({ abi: artifact.abi, address })
	const nativePool = addressString(TEST_ADDRESSES[2])
	const childPool = addressString(TEST_ADDRESSES[3])
	const otherPool = addressString(TEST_ADDRESSES[4])
	const finalPool = addressString(TEST_ADDRESSES[5])
	const register = (pool: Address, universe: bigint, question: bigint) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'registerQuestion', args: [pool, universe, question] }))
	const mint = (pool: Address, cash: bigint, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'mint', args: [pool, 0n, timestamp], value: cash }))
	const redeem = (pool: Address, shares: bigint, timestamp = 0) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'redeem', args: [pool, addressString(TEST_ADDRESSES[1]), shares, 0n, timestamp] }))
	const checkpoint = (universe: bigint, timestamp: number) => writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'checkpointUniverse', args: [universe, timestamp] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		await ethereum.advanceTime(1_000_000n)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const engineReceipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (engineReceipt.contractAddress === undefined) throw new Error('Settlement engine deployment address missing')
		address = engineReceipt.contractAddress
		const bookReceipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [address, 10n ** 12n] }) }) })
		if (bookReceipt.contractAddress === undefined) throw new Error('Settlement book deployment address missing')
		book = bookReceipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'initialize', args: [book] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'registerUniverse', args: [0n, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'setFeesEnabled', args: [0n, true, 0] }))
		await register(nativePool, 0n, 1n)
		await setBaselineSnapshot()
	})

	test('earned fees are transferred once and redemptions pay the exact actual cash', async () => {
		await mint(nativePool, 100n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [nativePool, 2n, 10, 0] }))
		await checkpoint(0n, 5)
		expect(await client.getBalance({ address })).toBe(90n)
		expect((await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [1n] })).slice(0, 3)).toEqual([90n, 90n, 0n])
		const before = await client.getBalance({ address: addressString(TEST_ADDRESSES[1]) })
		await redeem(nativePool, 50n, 5)
		expect(await client.getBalance({ address: addressString(TEST_ADDRESSES[1]) })).toBe(before + 45n)
		await checkpoint(0n, 10)
		expect(await client.getBalance({ address })).toBe(40n)
		await redeem(nativePool, 50n, 10)
		expect(await client.getBalance({ address })).toBe(0n)
	})

	test('only the bound service can account for questions and receive the fees it settles', async () => {
		const service = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		await expect(writeContractAndWait(service, () => service.writeContract({ ...target(), functionName: 'authorizeServices', args: [service.account.address] }))).rejects.toThrow('Only portfolio')
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'authorizeServices', args: [service.account.address] }))
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'authorizeServices', args: [client.account.address] }))).rejects.toThrow('Settlement services initialized')
		await expect(writeContractAndWait(service, () => service.writeContract({ ...target(), functionName: 'authorizeServices', args: [client.account.address] }))).rejects.toThrow('Only portfolio')
		await writeContractAndWait(service, () => service.writeContract({ ...target(), functionName: 'mint', args: [nativePool, 0n, 0], value: 100n }))
		await writeContractAndWait(service, () => service.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [nativePool, 2n, 10, 0] }))
		const rootBefore = await client.getBalance({ address: client.account.address })
		const serviceBefore = await client.getBalance({ address: service.account.address })
		const hash = await writeContractAndWait(service, () => service.writeContract({ ...target(), functionName: 'checkpointUniverse', args: [0n, 5] }))
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Service checkpoint receipt is missing its gas price')
		expect(await client.getBalance({ address: service.account.address })).toBe(serviceBefore + 10n - receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await client.getBalance({ address: client.account.address })).toBe(rootBefore)
		const serviceAfter = await client.getBalance({ address: service.account.address })
		await checkpoint(0n, 10)
		expect(await client.getBalance({ address: service.account.address })).toBe(serviceAfter)
		expect(await client.getBalance({ address })).toBe(80n)
	})

	test('fork source cash, final parent claims and child funding cannot spend each other', async () => {
		await register(otherPool, 0n, 2n)
		await register(finalPool, 0n, 3n)
		await mint(nativePool, 200n)
		await mint(otherPool, 300n)
		await mint(finalPool, 100n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'scheduleFinality', args: [finalPool, 99, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealUniverse', args: [0n, 100] }))
		expect(await client.readContract({ ...target(), functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(500n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildUniverse', args: [0n, 1n, 200n, zeroAddress, 0n] }))
		await register(childPool, 1n, 1n)
		await register(addressString(TEST_ADDRESSES[6]), 1n, 2n)
		expect(await client.readContract({ ...target(), functionName: 'snapshotQuestion', args: [childPool] })).toMatchObject({ demandAttoEth: 200n })
		await expect(writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildUniverse', args: [0n, 2n, 301n, zeroAddress, 0n] }))).rejects.toThrow('Fork settlement cash insufficient')
		await redeem(childPool, 200n, 100)
		expect(await client.readContract({ ...target(), functionName: 'snapshotQuestion', args: [childPool] })).toMatchObject({ demandAttoEth: 120n })
		expect(await client.getBalance({ address })).toBe(520n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'withdrawForkRecoveryCash', args: [0n, 300n] }))
		await redeem(finalPool, 100n, 100)
		await register(addressString(0x900n), 1n, 3n)
		expect(await client.readContract({ ...target(), functionName: 'snapshotQuestion', args: [addressString(0x900n)] })).toMatchObject({ outcomeSupplyAttoShares: 0n, questionCashAttoEth: 0n })
		expect(await client.getBalance({ address })).toBe(120n)
		await redeem(addressString(TEST_ADDRESSES[6]), 300n, 100)
		expect(await client.getBalance({ address })).toBe(0n)
	})

	test('the inherited fork question freezes after its child response window without a native pool', async () => {
		await mint(nativePool, 100n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealUniverse', args: [0n, 100] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildUniverse', args: [0n, 1n, 100n, zeroAddress, 0n] }))
		const deadline = 100 + 3 * 24 * 60 * 60
		const inheritedAbi = parseAbi(['function fixInheritedQuestionFinality(uint248 universeId,uint256 questionId,uint48 finalAfter)'])
		await writeContractAndWait(client, () => client.writeContract({ address, abi: inheritedAbi, functionName: 'fixInheritedQuestionFinality', args: [1n, 1n, deadline] }))
		expect(await client.readContract({ ...target(), functionName: 'poolsByQuestion', args: [1n, 1n] })).toBe(addressString(0n))
		await checkpoint(1n, deadline)
		expect((await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [2n] })).slice(0, 2)).toEqual([100n, 100n])
		await checkpoint(1n, deadline + 1)
		expect((await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [2n] })).slice(0, 2)).toEqual([0n, 0n])
		await register(childPool, 1n, 1n)
		expect(await client.readContract({ ...target(), functionName: 'snapshotQuestion', args: [childPool] })).toMatchObject({ questionCashAttoEth: 100n, outcomeSupplyAttoShares: 100n })
		await redeem(childPool, 100n, deadline + 1)
		expect(await client.getBalance({ address })).toBe(0n)
	})

	test('forced ETH cannot create virtual claims and direct native callers cannot bypass the portfolio', async () => {
		await expect(register(otherPool, 0n, 1n)).rejects.toThrow('Settlement question already canonical')
		await getAnvilWindowEthereum().setBalance(address, 1_000n)
		expect(await client.readContract({ ...target(), functionName: 'quoteMint', args: [nativePool, 10n] })).toBe(10n)
		await mint(nativePool, 10n)
		await redeem(nativePool, 10n)
		expect(await client.getBalance({ address })).toBe(1_000n)
		const outsider = createWriteClient(getAnvilWindowEthereum(), TEST_ADDRESSES[1])
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'mint', args: [nativePool, 0n, 0], value: 100n }))).rejects.toThrow('Only portfolio')
		await expect(writeContractAndWait(outsider, () => outsider.writeContract({ ...target(), functionName: 'registerQuestion', args: [childPool, 0n, 99n] }))).rejects.toThrow('Only portfolio')
	})

	test('a zero-ETH branch pays REP proportionally before rounding nearly exhausted ETH units', async () => {
		const shares = 10n ** 18n
		const rep = 1_000n * shares
		const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [client.account.address] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Recovery token deployment missing')
		const token = receipt.contractAddress
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'initialize', args: [1n, rep, 1n] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [client.account.address, rep] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [address, rep] }))
		await mint(nativePool, shares)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'replaceFeeStream', args: [nativePool, shares - 1n, 1, 0] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'sealUniverse', args: [0n, 1] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'createChildUniverse', args: [0n, 1n, 0n, token, rep] }))
		await register(childPool, 1n, 1n)
		expect(await client.readContract({ ...target(), functionName: 'snapshotQuestion', args: [childPool] })).toMatchObject({ demandAttoEth: 0n, outcomeSupplyAttoShares: shares, questionRecoveryAttoRep: rep })
		await redeem(childPool, shares / 2n, 1)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [addressString(TEST_ADDRESSES[1])] })).toBe(rep / 2n)
		await redeem(childPool, shares / 2n, 1)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [addressString(TEST_ADDRESSES[1])] })).toBe(rep)
		expect(await client.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [address] })).toBe(0n)
		await writeContractAndWait(client, () => client.writeContract({ ...target(), functionName: 'withdrawForkRecoveryCash', args: [0n, 1n] }))
		expect(await client.getBalance({ address })).toBe(0n)
	})
})
