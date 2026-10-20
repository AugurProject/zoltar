import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getETHBalance, setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPoolPortfolioRecapAuction_SecurityPoolPortfolioRecapAuction as artifact } from '../../types/contractArtifact'

const unit = 10n ** 18n

describe('Statoblast: atomic portfolio recapitalization', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let ethereum: AnvilWindowEthereum
	let owner: WriteClient
	let buyer: WriteClient
	let auction: Address
	const choiceDeadline = 1_000n
	const recapitalizationDeadline = 2_000n

	const deploy = async (overrides: { unchosenRepAttoRep?: bigint; missingCashAttoEth?: bigint; reservePriceAttoEthPerRep?: bigint; startingPriceAttoEthPerRep?: bigint; securityMultiplierBps?: bigint; maximumCommitmentAttoEth?: bigint } = {}) => {
		auction = await deployContract(
			owner,
			encodeDeployData({
				abi: artifact.abi,
				bytecode: `0x${artifact.evm.bytecode.object}`,
				args: [
					{
						owner: owner.account.address,
						choiceDeadline: Number(choiceDeadline),
						recapitalizationDeadline: Number(recapitalizationDeadline),
						unchosenRepAttoRep: 1_000n * unit,
						missingCashAttoEth: 100n * unit,
						reservePriceAttoEthPerRep: unit,
						startingPriceAttoEthPerRep: unit,
						securityMultiplierBps: 20_000n,
						maximumCommitmentAttoEth: 100n * unit,
						...overrides,
					},
				],
			}),
		)
	}
	const quote = async (eth: bigint, rep = 2n ** 256n - 1n) => {
		const result = await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'quote', args: [eth, rep] })
		return [result[0], result[1], result[2]] as const
	}
	const fill = async (eth: bigint, maximumRep = 2n ** 256n - 1n) => {
		const result = await quote(eth, maximumRep)
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, result[0], result[1]], value: result[2] }))
		return { result, receipt: await owner.waitForTransactionReceipt({ hash }) }
	}
	const finalize = () => writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'finalize' }))

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		buyer = createWriteClient(ethereum, TEST_ADDRESSES[1])
		await setupTestAccounts(ethereum)
		await deploy()
	})

	test('a fill fixes exact principal and authorized commitment immediately with no winner claim', async () => {
		await ethereum.setTime(choiceDeadline)
		expect((await fill(unit)).result).toEqual([unit, unit / 10n, unit])
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(unit)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'assignedCommitmentAttoEth' })).toBe(unit / 10n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(100n * unit - unit / 10n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'finalized' })).toBe(false)
		expect(await getETHBalance(owner, auction)).toBe(unit)
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'withdrawProceeds' }))).rejects.toThrow('Recap auction is not final')
		await ethereum.setTime(recapitalizationDeadline)
		await finalize()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'withdrawProceeds' }))
		expect(await getETHBalance(owner, auction)).toBe(0n)
		await expect(finalize()).rejects.toThrow('Recap auction is already final')
	})

	test('the immutable price curve never rises or crosses the reserve and deadlines cannot reopen', async () => {
		await deploy({ startingPriceAttoEthPerRep: 3n * unit })
		for (const [timestamp, expected] of [
			[0n, 3n * unit],
			[1_000n, 3n * unit],
			[1_250n, (25n * unit) / 10n],
			[1_500n, 2n * unit],
			[2_000n, unit],
			[9_000n, unit],
		] as const) {
			expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'priceAt', args: [timestamp] })).toBe(expected)
		}
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await ethereum.setTime(1_500n)
		expect(await quote(2n * unit)).toEqual([unit, unit / 10n, 2n * unit])
		await expect(finalize()).rejects.toThrow('Recap purchases are still active')
		await ethereum.setTime(recapitalizationDeadline)
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await finalize()
		await deploy()
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await finalize()
	})

	test('only the authenticated coordinator can fill and each fill enforces explicit buyer limits', async () => {
		await ethereum.setTime(choiceDeadline)
		await expect(buyer.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit], value: unit })).rejects.toThrow('Only the portfolio can coordinate recapitalization')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit / 10n - 1n], value: unit })).rejects.toThrow('Recap commitment exceeds buyer consent')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit], value: unit + 1n })).rejects.toThrow('Recap payment must equal quoted cost')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, 1n, 1n], value: 1n })).rejects.toThrow('Recap purchase is too small')
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(0n)
	})

	test('both inventory and cash caps apply cumulatively without charging for unfilled REP', async () => {
		await deploy({ unchosenRepAttoRep: 10n * unit })
		await ethereum.setTime(choiceDeadline)
		expect((await fill(3n * unit)).result).toEqual([3n * unit, 30n * unit, 3n * unit])
		expect((await fill(100n * unit)).result).toEqual([2n * unit, 20n * unit, 2n * unit])
		expect(await quote(100n * unit)).toEqual([0n, 0n, 0n])
		expect(await getETHBalance(owner, auction)).toBe(5n * unit)
		await deploy({ startingPriceAttoEthPerRep: 2n * unit, reservePriceAttoEthPerRep: 2n * unit })
		expect((await fill(60n * unit)).result[0]).toBe(30n * unit)
		expect((await fill(60n * unit)).result).toEqual([20n * unit, 2n * unit, 40n * unit])
		expect(await quote(unit)).toEqual([0n, 0n, 0n])
	})

	test('cumulative commitment rounding conserves every unit and ceil cost never sells unpaid dust', async () => {
		await deploy({ unchosenRepAttoRep: 101n, missingCashAttoEth: 83n, maximumCommitmentAttoEth: 47n, reservePriceAttoEthPerRep: (15n * unit) / 10n, startingPriceAttoEthPerRep: (15n * unit) / 10n })
		await ethereum.setTime(choiceDeadline)
		let sold = 0n
		let assigned = 0n
		let paid = 0n
		for (const budget of [2n, 7n, 9n, 3n, 11n, 19n]) {
			const {
				result: [rep, commitment, cost],
			} = await fill(budget)
			expect(cost).toBe((rep * 3n + 1n) / 2n)
			expect(cost).toBeLessThanOrEqual(budget)
			sold += rep
			assigned += commitment
			paid += cost
			expect(assigned).toBe((sold * 47n) / 101n)
		}
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(47n - assigned)
		expect(await getETHBalance(owner, auction)).toBe(paid)
	})

	test('zero-sale and zero-fill auctions finalize at their original end without fabricated ownership', async () => {
		await deploy({ missingCashAttoEth: 0n })
		await ethereum.setTime(choiceDeadline)
		expect(await quote(unit)).toEqual([0n, 0n, 0n])
		await ethereum.setTime(recapitalizationDeadline)
		await finalize()
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(100n * unit)
		await deploy({ unchosenRepAttoRep: 0n, maximumCommitmentAttoEth: 0n })
		await finalize()
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(0n)
		await expect(deploy({ unchosenRepAttoRep: 0n })).rejects.toThrow('Empty inventory has commitment')
		await expect(deploy({ startingPriceAttoEthPerRep: unit - 1n })).rejects.toThrow('Recap starting price is below reserve')
	})

	test('fill and finalization gas are constant after hundreds of prior buyers', async () => {
		await deploy({ unchosenRepAttoRep: 1_000_000n, missingCashAttoEth: 100_000n, maximumCommitmentAttoEth: 100_000n })
		await ethereum.setTime(choiceDeadline)
		const first = await fill(10n)
		for (let index = 0; index < 256; index++) await fill(10n)
		const last = await fill(10n)
		expect(last.receipt.gasUsed).toBeLessThanOrEqual(first.receipt.gasUsed)
		expect(last.receipt.gasUsed).toBeLessThan(100_000n)
		await ethereum.setTime(recapitalizationDeadline)
		const receipt = await owner.waitForTransactionReceipt({ hash: await finalize() })
		expect(receipt.gasUsed).toBeLessThan(75_000n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(2_580n)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ recapFillGas: last.receipt.gasUsed, recapFinalizeGas: receipt.gasUsed })
	})
})
