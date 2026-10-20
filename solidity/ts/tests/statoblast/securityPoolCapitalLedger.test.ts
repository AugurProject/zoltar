import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioCapitalCureRequest, buildPortfolioCapitalTakeOverRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as artifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerHarness as harnessArtifact,
	test_statoblast_CapitalLedgerHarness_CapitalLedgerTestComponents as componentsArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const E = 10n ** 18n

describe('Statoblast: individual shared-custody capital', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let alice: WriteClient
	let bob: WriteClient
	let keeper: WriteClient
	let ledger: Address
	let index: Address
	let harness: Address
	let token: Address
	const account = (client: WriteClient) => alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'ownerAccount', args: [client.account.address] })
	const position = (id: bigint) => alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
	const price = async (amount: bigint, duration = 100_000) => {
		const now = (await alice.getBlock()).timestamp
		return writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setPrice', args: [amount, Number(now) + duration] }))
	}
	const demand = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setDemand', args: [amount] }))
	const deposit = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'depositFor', args: [client.account.address, amount] }))
	const authorize = async (client: WriteClient, rep: bigint, commitment: bigint) => {
		await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'authorize', args: [rep, commitment] }))
		const owner = await account(client)
		const id = owner.positions.find(value => value !== 0n)
		if (id === undefined) throw new Error('Authorized position missing')
		return id
	}
	const withdraw = (client: WriteClient, amount: bigint) => writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'withdrawFree', args: [amount, client.account.address] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		alice = createWriteClient(ethereum, TEST_ADDRESSES[0])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[1])
		keeper = createWriteClient(ethereum, TEST_ADDRESSES[2])
		const componentsReceipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: `0x${componentsArtifact.evm.bytecode.object}` }) })
		if (componentsReceipt.contractAddress === undefined) throw new Error('Capital test components address missing')
		const receipt = await alice.waitForTransactionReceipt({ hash: await alice.sendTransaction({ data: encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}`, args: [componentsReceipt.contractAddress] }) }) })
		if (receipt.contractAddress === undefined) throw new Error('Capital harness address missing')
		harness = receipt.contractAddress
		ledger = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'ledger' })
		token = await alice.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'token' })
		index = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'commitmentIndex' })
		for (const client of [alice, bob, keeper]) {
			await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'mint', args: [client.account.address, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [ledger, 10_000n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: artifact.abi, address: ledger, functionName: 'fundExecutionReserve', args: [client.account.address], value: 100n * E }))
		}
		await price(E)
		await setBaselineSnapshot()
	})

	test('execution funding after a fork choice cannot enter an account whose reserve already moved', async () => {
		await deposit(alice, 105n * E)
		await authorize(alice, 105n * E, 100n * E)
		const forkTime = (await alice.getBlock()).timestamp
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'setFork', args: [forkTime] }))
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'exportChoice', args: [alice.account.address] }))
		expect((await account(alice)).executionReserveAttoEth).toBe(0n)
		await expect(writeContractAndWait(bob, () => bob.writeContract({ abi: artifact.abi, address: ledger, functionName: 'fundExecutionReserve', args: [alice.account.address], value: E }))).rejects.toThrow('Execution reserve follows fork choice')
		expect((await account(alice)).executionReserveAttoEth).toBe(0n)
	})

	test('personal health targets and exact principal survive other owners entering and leaving', async () => {
		await deposit(alice, 200n * E)
		await deposit(bob, 400n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setHealthTarget', args: [12_000n] }))
		await expect(authorize(alice, 110n * E, 100n * E)).rejects.toThrow('Collateral below chosen health target')
		const a = await authorize(alice, 126n * E, 100n * E)
		const b = await authorize(bob, 105n * E, 100n * E)
		await withdraw(bob, 295n * E)
		expect((await account(alice)).freeAttoRep).toBe(74n * E)
		expect((await position(a)).rep).toBe(126n * E)
		expect((await position(b)).rep).toBe(105n * E)
		expect(await alice.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [ledger] })).toBe(305n * E)
	})

	test('one unhealthy vault cannot freeze free withdrawals, deposits or collateral top-ups', async () => {
		await deposit(alice, 150n * E)
		await deposit(bob, 300n * E)
		const a = await authorize(alice, 105n * E, 100n * E)
		await authorize(bob, 210n * E, 100n * E)
		await demand(200n * E)
		await price((15n * E) / 10n)
		await withdraw(bob, 90n * E)
		await deposit(alice, 100n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'topUp', args: [a, 53n * E] }))
		expect((await position(a)).rep).toBe(158n * E)
		expect((await account(bob)).freeAttoRep).toBe(0n)
		await demand(200n * E)
	})

	test('minimal cure consumes only spare nominal commitments and never another vault principal', async () => {
		await deposit(alice, 105n * E)
		await deposit(bob, 210n * E)
		const a = await authorize(alice, 105n * E, 100n * E)
		const b = await authorize(bob, 210n * E, 100n * E)
		await demand(150n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: a })))
		expect((await position(a)).commitment).toBe(50n * E)
		expect((await position(a)).rep).toBe(105n * E)
		expect((await position(b)).rep).toBe(210n * E)
		expect((await position(b)).commitment).toBe(100n * E)
	})

	test('capacity-funded execution reserves pay partial cure progress and preserve residual funding', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		const reserved = () => alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'positionExecutionReserveAttoEth', args: [id] })
		expect(await reserved()).toBe(10n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await position(id)).commitment).toBe(50n * E)
		expect(await reserved()).toBe(5n * E)
		expect((await account(keeper)).feesAttoEth).toBe(5n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await account(keeper)).feesAttoEth).toBe(5n * E)
	})

	test('subminimum cure headroom cannot drain a reserve through repeated tiny progress', async () => {
		const minimumK = E / 1_000n
		const minimumReward = E / 10_000n
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E - minimumK + 1n)
		await price(E + 1n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await position(id)).commitment).toBe(100n * E)
		expect((await account(keeper)).feesAttoEth).toBe(0n)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBeGreaterThan(0n)
		await demand(100n * E - minimumK)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await position(id)).commitment).toBe(100n * E - minimumK)
		expect((await account(keeper)).feesAttoEth).toBe(minimumReward)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'positionExecutionReserveAttoEth', args: [id] })).toBe(10n * E - minimumReward)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [id] }))
		expect((await account(keeper)).feesAttoEth).toBe(minimumReward)
	})

	test('execution funding grows with authorized capacity and rounds the final unit upward', async () => {
		await deposit(alice, 200n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await authorize(alice, 126n * E, 120n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'positionExecutionReserveAttoEth', args: [id] })).toBe(12n * E)
		expect((await account(alice)).executionReserveAttoEth).toBe(88n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'requiredExecutionReserve', args: [E / 1_000n + 1n] })).toBe(E / 5_000n)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'withdrawExecutionReserve', args: [88n * E] }))
		await expect(authorize(alice, 127n * E, 120n * E + 1n)).rejects.toThrow('Fund execution reserve')
	})

	test('a funded takeover charges only the target, preserves residual health, and creates no free headroom', async () => {
		await deposit(alice, 105n * E)
		await deposit(bob, 210n * E)
		await deposit(keeper, 500n * E)
		const a = await authorize(alice, 105n * E, 100n * E)
		const b = await authorize(bob, 210n * E, 100n * E)
		await demand(200n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [a] }))
		await getAnvilWindowEthereum().advanceTime(3601n)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'takeOver', args: [a, 50n * E, 52n * E, 60n * E] }))
		expect((await position(b)).rep).toBe(210n * E)
		expect((await position(a)).rep).toBe((105n * E) / 2n)
		expect((await position(a)).commitment).toBe(50n * E)
		expect((await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'totals' }))[1]).toBe(200n * E)
		expect((await account(keeper)).freeAttoRep).toBe(500n * E - (105n * E) / 2n)
		expect((await account(keeper)).feesAttoEth).toBe(5n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'positionExecutionReserveAttoEth', args: [a] })).toBe(5n * E)
		await expect(demand(201n * E)).rejects.toThrow('Insufficient healthy shared commitment')
	})

	test('a takeover into an existing receiver repairs its entire chosen health target and respects maximum own REP', async () => {
		await deposit(alice, 105n * E)
		await deposit(bob, 210n * E)
		await deposit(keeper, 1_000n * E)
		const source = await authorize(alice, 105n * E, 100n * E)
		await authorize(bob, 210n * E, 100n * E)
		const receiver = await authorize(keeper, 105n * E, 100n * E)
		await demand(300n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'setHealthTarget', args: [15_000n] }))
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.writeContract({ abi: artifact.abi, address: ledger, functionName: 'cure', args: [source] }))
		await getAnvilWindowEthereum().advanceTime(3601n)
		const takeover = (maximumOwn: bigint) => writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: source, commitment: 50n * E, minimumAward: 52n * E, maximumOwnRep: maximumOwn })))
		await expect(takeover(315n * E - 1n)).rejects.toThrow('Receiver collateral insufficient')
		expect((await position(receiver)).rep).toBe(105n * E)
		await takeover(315n * E)
		expect(await position(receiver)).toMatchObject({ rep: (945n * E) / 2n, commitment: 150n * E })
		expect((await account(keeper)).freeAttoRep).toBe(580n * E)
		expect((await position(source)).rep).toBe((105n * E) / 2n)
		expect((await position(source)).commitment).toBe(50n * E)
	})

	test('healthy reauthorization requires a new liquidation interval after a later price decline', async () => {
		await deposit(alice, 315n * E)
		await deposit(keeper, 1_000n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		const previousStart = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })
		expect(previousStart).toBeGreaterThan(0n)
		expect(await authorize(alice, 210n * E, 100n * E)).toBe(id)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await price(3n * E)
		const takeover = () => writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))
		await expect(takeover()).rejects.toThrow('Takeover award below minimum')
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		const nextStart = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })
		expect(nextStart).toBeGreaterThan(previousStart + 3600n)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await takeover()
		expect((await position(id)).rep).toBe(105n * E)
	})

	test('a takeover that restores an existing receiver requires its own new liquidation interval', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 1_000n * E)
		await deposit(bob, 1_000n * E)
		const source = await authorize(alice, 105n * E, 100n * E)
		const receiver = await authorize(keeper, 105n * E, 100n * E)
		await demand(200n * E)
		await price(2n * E)
		for (const id of [source, receiver]) await writeContractAndWait(bob, () => bob.sendTransaction(buildPortfolioCapitalCureRequest({ owner: bob.account.address, capitalLedger: ledger, positionId: id })))
		const previousStart = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [receiver] })
		await getAnvilWindowEthereum().advanceTime(3601n)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: source, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))
		expect(await position(receiver)).toMatchObject({ rep: 315n * E, commitment: 150n * E })
		await price(3n * E)
		await expect(writeContractAndWait(bob, () => bob.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: bob.account.address, capitalLedger: ledger, positionId: receiver, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))).rejects.toThrow('Takeover award below minimum')
		await writeContractAndWait(bob, () => bob.sendTransaction(buildPortfolioCapitalCureRequest({ owner: bob.account.address, capitalLedger: ledger, positionId: receiver })))
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [receiver] })).toBeGreaterThan(previousStart + 3600n)
	})

	test('still-unhealthy and stale-price top-ups preserve a running liquidation interval', async () => {
		await deposit(alice, 500n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E, 20)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		const previousStart = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })
		const topUp = (amount: bigint) => writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'topUp', args: [id, amount] }))
		await topUp(E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(previousStart)
		await getAnvilWindowEthereum().advanceTime(21n)
		await topUp(104n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'isPriceValid' })).toBe(false)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(previousStart)
		await price(3n * E)
		await topUp(105n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('oracle-only recovery invalidates an old award before a later price decline', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 1_000n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		await getAnvilWindowEthereum().advanceTime(3601n)
		await price(E)
		await price(3n * E)
		await expect(writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))).rejects.toThrow('Takeover award below minimum')
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('the public liquidation timer immediately reflects a price-only recovery', async () => {
		await deposit(alice, 105n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBeGreaterThan(0n)
		await price(E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
	})

	test('same-block oracle recovery and relapse cannot retain an older liquidation interval', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 1_000n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		const now = (await alice.getBlock()).timestamp
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'cureAndSetPrices', args: [id, E, 3n * E, Number(now) + 100_000] }))
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
		await getAnvilWindowEthereum().advanceTime(3601n)
		await expect(writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))).rejects.toThrow('Takeover award below minimum')
	})

	test('oracle updates that never restore health preserve the earned takeover interval', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 1_000n * E)
		const id = await authorize(alice, 105n * E, 100n * E)
		await demand(100n * E)
		await price(2n * E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		const started = await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })
		await getAnvilWindowEthereum().advanceTime(3601n)
		await price(3n * E)
		await price(2n * E)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(started)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: (105n * E) / 2n, maximumOwnRep: 1_000n * E })))
		expect((await position(id)).rep).toBe((105n * E) / 2n)
	})

	test('partial takeover rounding that restores source health clears its previous interval', async () => {
		await deposit(alice, 105n * E)
		await deposit(keeper, 1_000n * E)
		await price(E - 1n)
		const id = await authorize(alice, 105n * E - 1n, 100n * E)
		await demand(100n * E)
		await price(E)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalCureRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id })))
		await getAnvilWindowEthereum().advanceTime(3601n)
		await writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))
		expect(await position(id)).toMatchObject({ rep: (105n * E) / 2n, commitment: 50n * E })
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'liquidationStarted', args: [id] })).toBe(0n)
		await price(2n * E)
		await expect(writeContractAndWait(keeper, () => keeper.sendTransaction(buildPortfolioCapitalTakeOverRequest({ owner: keeper.account.address, capitalLedger: ledger, positionId: id, commitment: 50n * E, minimumAward: 1n, maximumOwnRep: 1_000n * E })))).rejects.toThrow('Takeover award below minimum')
	})

	test('returned demand closes retirement into exact cash and unrelated deficits cannot seize that cash', async () => {
		await deposit(alice, 210n * E)
		await deposit(bob, 105n * E)
		const a = await authorize(alice, 210n * E, 100n * E)
		await authorize(bob, 105n * E, 100n * E)
		await demand(200n * E)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'requestRetirement', args: [a] }))
		await demand(100n * E)
		expect((await position(a)).releasedRep).toBe(210n * E)
		await price(2n * E)
		await withdraw(alice, 210n * E)
		expect((await account(alice)).freeAttoRep).toBe(0n)
	})

	test('old-price eligibility checkpoints atomically and stale vested income never backdates', async () => {
		await deposit(alice, 105n * E)
		await deposit(bob, 210n * E)
		const a = await authorize(alice, 105n * E, 100n * E)
		const b = await authorize(bob, 210n * E, 100n * E)
		await price(E, 1000)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: harnessArtifact.abi, address: harness, functionName: 'fundFees', value: 86400n * E }))
		await getAnvilWindowEthereum().advanceTime(1100n)
		await price(2n * E)
		const oldA = (await position(a)).ethFees
		const oldB = (await position(b)).ethFees
		expect(oldA).toBeGreaterThan(0n)
		expect(oldA).toBe(oldB)
		expect(await alice.readContract({ abi: artifact.abi, address: ledger, functionName: 'maintenanceAttoEth' })).toBeGreaterThan(99n * E)
		await getAnvilWindowEthereum().advanceTime(100n)
		await writeContractAndWait(alice, () => alice.writeContract({ abi: artifact.abi, address: ledger, functionName: 'checkpoint' }))
		expect((await position(a)).ethFees).toBe(oldA)
		expect((await position(b)).ethFees).toBeGreaterThan(oldB + 99n * E)
	})
})
