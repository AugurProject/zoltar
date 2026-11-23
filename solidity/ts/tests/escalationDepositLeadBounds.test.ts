import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, parseAbi, parseAbiItem, parseAbiParameters, toFunctionSelector } from '@zoltar/core-shared/evm/ethereum'
import { ReputationToken_ReputationToken as tokenArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createE2E, NO, YES } from './auditE2EHarness'
import { RECEIVE_WITH_AUTHORIZATION_TYPES, signTypedDataV4, tokenDomain } from '../testSupport/simulator/utils/typedDataSignatures'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const guardedPoolAbi = parseAbi(['function depositWalletRepToEscalationGameWithLead(uint8 outcome, uint256 maximumDepositAttoRep)'])
const authorizationSignature = 'function depositRepOnOutcomeWithAuthorizationAndLead(address owner, uint8 outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)'
const guardedAuthorizationAbi = parseAbi([authorizationSignature, 'function depositRepOnOutcomeWithAuthorization(address owner, uint8 outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)'])
const guardedGameAbi = parseAbi(['function depositRepOnOutcomeWithLead(uint8 outcome, uint256 maximumDepositAttoRep)'])

describe('escalation deposit lead bounds', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	for (const throughPool of [true, false]) {
		for (const frontRun of [true, false]) {
			test(`#1328 ${throughPool ? 'pool' : 'game'} leading reply ${frontRun ? 'rejects a changed leader' : 'raises the median and the curve deadline'}`, async () => {
				const honest = e2e.account(2)
				const attacker = e2e.account(3)
				const pool = fixture.poolFor(fixture.base.questionId).questionLedger
				await fixture.prepare()
				await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
				await e2e.deposit(honest, pool, YES, 1_000n * unit)
				await e2e.deposit(attacker, pool, NO, 900n * unit)
				const gameAddress = await e2e.gameOf(pool)
				const game = e2e.game(gameAddress)
				const read = <const Name extends 'getEscalationGameEndDate' | 'getOutcomeBalancesAttoRep'>(functionName: Name) => fixture.owner().readContract({ ...game, functionName })
				await fixture.base.mockWindow.setTime((await read('getEscalationGameEndDate')) - 2n)
				// The flip raises the median to Yes's stake, which moves the curve deadline later.
				await e2e.deposit(attacker, pool, NO, 200n * unit)
				const end = await read('getEscalationGameEndDate')
				await approveToken(honest, getRepTokenAddress(fixture.base.genesisUniverse), throughPool ? pool : gameAddress)
				await fixture.base.mockWindow.setTime(end - 61n)
				const balances = await read('getOutcomeBalancesAttoRep')
				const target = balances[NO] + 10n * unit
				const amount = target - balances[YES]
				if (frontRun) await e2e.deposit(attacker, pool, NO, target + 1n - balances[NO])
				const guarded = throughPool
					? () => writeContractAndWait(honest, () => honest.writeContract({ abi: guardedPoolAbi, address: pool, functionName: 'depositWalletRepToEscalationGameWithLead', args: [YES, amount] }))
					: () => writeContractAndWait(honest, () => honest.writeContract({ abi: guardedGameAbi, address: gameAddress, functionName: 'depositRepOnOutcomeWithLead', args: [YES, amount] }))
				if (frontRun) {
					// Ordinary support remains possible, but a reply can explicitly refuse it.
					await honest.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, amount] })
					await expect(guarded()).rejects.toThrow('Deposit does not lead')
					expect(await read('getOutcomeBalancesAttoRep')).toEqual([balances[0], balances[YES], target + 1n])
					// A top-up on the leader adds no time.
					expect(await read('getEscalationGameEndDate')).toBe(end)
				} else {
					await guarded()
					expect((await read('getOutcomeBalancesAttoRep'))[YES]).toBe(target)
					// The new median is No's stake: the deadline is the later curve crossing, not a fresh period.
					expect(await read('getEscalationGameEndDate')).toBeGreaterThan(end)
				}
			})
		}
	}
	test('#1328 signed leading deposits bind the guard and cannot be downgraded', async () => {
		const owner = fixture.owner()
		const source = fixture.base.genesisUniverse
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await e2e.deposit(owner, pool, YES, 1_000n * unit)
		await e2e.deposit(fixture.other(), pool, NO, 900n * unit)
		await e2e.forkOn(owner, source, await e2e.unrelatedQuestion('Signed leading reply'))
		await e2e.choose(owner, source, YES)
		await e2e.migrateWalletRep(owner, source, 1_000n * unit, [YES])
		const child = await e2e.materialize(pool, await e2e.activateBranch(source, YES))
		const token = { abi: tokenArtifact.abi, address: getRepTokenAddress(child.universe) }
		const accounts = await fixture.base.mockWindow.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer unavailable')
		const signer = getAddress(accounts[0])
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'transfer', args: [signer, 1_000n * unit] }))
		const maximum = 500n * unit
		const nonce = keccak256('0x1328')
		const selector = toFunctionSelector(parseAbiItem(authorizationSignature))
		const operationHash = keccak256(encodeAbiParameters(parseAbiParameters('bytes4, address, address, uint248, uint256, uint8, uint256, uint256'), [selector, signer, child.pool, child.universe, fixture.base.questionId, NO, maximum, maximum]))
		const boundNonce = keccak256(encodeAbiParameters(parseAbiParameters('bytes32, bytes32, address'), [nonce, operationHash, signer]))
		const validBefore = (await owner.getBlock()).timestamp + DAY
		const signature = await signTypedDataV4(fixture.base.mockWindow, signer, {
			domain: tokenDomain(token.address, await owner.readContract({ ...token, functionName: 'name' })),
			primaryType: 'ReceiveWithAuthorization',
			types: RECEIVE_WITH_AUTHORIZATION_TYPES,
			message: { from: signer, to: child.game, value: maximum.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce: boundNonce },
		})
		const args = [signer, NO, maximum, 0n, validBefore, nonce, signature.v, signature.r, signature.s] as const
		await expect(owner.writeContract({ abi: guardedAuthorizationAbi, address: child.game, functionName: 'depositRepOnOutcomeWithAuthorization', args })).rejects.toThrow()
		expect(await owner.readContract({ ...token, functionName: 'authorizationState', args: [signer, boundNonce] })).toBe(false)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: guardedAuthorizationAbi, address: child.game, functionName: 'depositRepOnOutcomeWithAuthorizationAndLead', args }))
		expect(await owner.readContract({ ...token, functionName: 'authorizationState', args: [signer, boundNonce] })).toBe(true)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [signer] })).toBe(500n * unit)
		await expect(owner.writeContract({ abi: guardedAuthorizationAbi, address: child.game, functionName: 'depositRepOnOutcomeWithAuthorizationAndLead', args })).rejects.toThrow()
	})
})
