import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../../types/contractArtifact'
import { zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { describe, expect, test } from 'bun:test'
import { buildSecurityPoolCapitalDepositRequest, buildSecurityPoolCapitalSetCommitmentRequest, buildSecurityPoolCapitalWithdrawPrincipalRequest, buildSecurityPoolMintRequest, loadSecurityPoolCapitalSnapshot, loadSecurityPoolMintQuote } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: central capital SDK against production contracts', () => {
	const fixture = useSecurityPoolFixture()
	test('an unregistered origin question is quoted and purchased without a separate registration', async () => {
		const client = fixture.owner()
		await fixture.prepare()
		const question = makeQuestion('SDK first atomic purchase', fixture.secondEndTime)
		await createQuestion(client, question, fixture.base.outcomes)
		const questionId = getQuestionId(question, fixture.base.outcomes)
		expect(await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'questionOriginIds', args: [questionId] })).toBe(zeroHash)
		const quote = await loadSecurityPoolMintQuote({ multicallAddress: getInfraContractAddresses().multicall3, client, securityPool: fixture.securityPool, universeId: fixture.base.genesisUniverse, questionId, mintAttoEth: 10n * unit })
		expect(quote.pool).toBe(zeroAddress)
		expect(quote.shares).toBe(10n * unit)
		const collateral = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const services = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		await approveToken(client, collateral, services)
		await writeContractAndWait(client, () =>
			client.sendTransaction(
				buildSecurityPoolMintRequest({ trader: client.account.address, securityPool: fixture.securityPool, universeId: fixture.base.genesisUniverse, questionId, mintAttoEth: 10n * unit, recipient: client.account.address, minimumShares: quote.shares, maximumPurchaseFeeAttoEth: quote.maximumPurchaseFeeAttoEth }),
			),
		)
		expect(await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'questionOriginIds', args: [questionId] })).not.toBe(zeroHash)
		const pool = fixture.poolFor(questionId)
		expect(await balanceOfShares(client, pool.shareToken, fixture.base.genesisUniverse, client.account.address)).toEqual([quote.shares, quote.shares, quote.shares])
	})

	test('an accrued-fee purchase accepts a minimum between stored and checkpointed shares (#1733)', async () => {
		const client = fixture.owner()
		await fixture.prepare()
		await fixture.mint(10n * unit, fixture.base.questionId, { sender: client })
		await fixture.base.mockWindow.advanceTime(60n)
		const pool = fixture.poolFor(fixture.base.questionId)
		const stored = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteQuestionMint', args: [pool.questionLedger, unit] })
		const quote = await loadSecurityPoolMintQuote({ multicallAddress: getInfraContractAddresses().multicall3, client, securityPool: fixture.securityPool, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId, mintAttoEth: unit })
		expect(quote.shares).toBeGreaterThan(stored + 1n)
		const minimum = (stored + quote.shares) / 2n
		const before = await balanceOfShares(client, pool.shareToken, fixture.base.genesisUniverse, client.account.address)
		await fixture.mint(unit, fixture.base.questionId, { sender: client, minimumShares: minimum })
		const after = await balanceOfShares(client, pool.shareToken, fixture.base.genesisUniverse, client.account.address)
		expect(after[0] - before[0]).toBeGreaterThanOrEqual(minimum)
	})

	test('snapshot and request builders preserve individual principal through authorize, mint, return and retirement', async () => {
		const client = fixture.owner()
		const owner = client.account.address
		const base = { owner, capitalLedger: fixture.capitalLedger }
		await approveToken(client, getRepTokenAddress(fixture.base.genesisUniverse), fixture.capitalLedger)
		await writeContractAndWait(client, () => client.sendTransaction(buildSecurityPoolCapitalDepositRequest({ ...base, amountAttoRep: 1_000n * unit })))
		await fixture.refreshPrice()
		await writeContractAndWait(client, () => client.sendTransaction(buildSecurityPoolCapitalSetCommitmentRequest({ ...base, commitment: 100n * unit })))
		const snapshot = await loadSecurityPoolCapitalSnapshot({ client, owner, securityPool: fixture.securityPool })
		expect(snapshot).toMatchObject({
			universeId: fixture.base.genesisUniverse,
			totalPledgedAttoRep: 1_000n * unit,
			totalCommitmentAttoEth: 100n * unit,
			ownerPrincipalAttoRep: 1_000n * unit,
			ownerCommitmentAttoEth: 100n * unit,
			withdrawableAttoRep: 789_473_684_210_526_315_600n,
			ownerConservativePrice: 1_052_631_578_947_368_422n,
			priceValid: true,
		})
		await expect(writeContractAndWait(client, () => client.sendTransaction(buildSecurityPoolCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: snapshot.withdrawableAttoRep + 1n })))).rejects.toThrow('Owner collateral too low')
		expect(snapshot.positions).toHaveLength(1)
		const position = snapshot.positions[0]
		if (position === undefined) throw new Error('SDK position missing')
		expect(position).toMatchObject({ owner, rep: 1_000n * unit, commitment: 100n * unit })
		const quote = await loadSecurityPoolMintQuote({ multicallAddress: getInfraContractAddresses().multicall3, client, securityPool: fixture.securityPool, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId, mintAttoEth: 10n * unit })
		expect(quote.availableCommitmentAttoEth).toBe(100n * unit)
		const collateral = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		const services = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'services' })
		await approveToken(client, collateral, services)
		await writeContractAndWait(client, () =>
			client.sendTransaction(
				buildSecurityPoolMintRequest({ trader: owner, securityPool: fixture.securityPool, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId, mintAttoEth: 10n * unit, recipient: owner, minimumShares: quote.shares, maximumPurchaseFeeAttoEth: quote.maximumPurchaseFeeAttoEth }),
			),
		)
		await writeContractAndWait(client, () => client.sendTransaction(buildSecurityPoolCapitalSetCommitmentRequest({ ...base, commitment: 0n })))
		const pool = fixture.poolFor(fixture.base.questionId)
		const balances = await balanceOfShares(client, pool.shareToken, fixture.base.genesisUniverse, owner)
		await redeemCompleteSet(client, pool.questionLedger, balances[0])
		const completed = await loadSecurityPoolCapitalSnapshot({ client, owner, securityPool: fixture.securityPool })
		expect(completed.withdrawableAttoRep).toBe(1_000n * unit)
		await writeContractAndWait(client, () => client.sendTransaction(buildSecurityPoolCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: completed.withdrawableAttoRep })))
		expect((await loadSecurityPoolCapitalSnapshot({ client, owner, securityPool: fixture.securityPool })).withdrawableAttoRep).toBe(0n)
	})
})
