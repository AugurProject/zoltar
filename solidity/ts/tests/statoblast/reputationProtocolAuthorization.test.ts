import assert from '../../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import {
	statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization,
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_QuestionForker_QuestionForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, splitMigrationRep, getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbiParameters, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { PERMIT_TYPES, RECEIVE_WITH_AUTHORIZATION_TYPES, signTypedDataV4, tokenDomain } from '../../testSupport/simulator/utils/typedDataSignatures'

describe('Statoblast REP authorization entry points', () => {
	const fixture = useSecurityPoolFixture()
	const reportBond = 100n * unit
	test('#1328 protected child permit and authorization deposits retain lead and signature bounds', async () => {
		const client = fixture.owner()
		const mock = fixture.base.mockWindow
		await fixture.prepare()
		const { forks, forkTime, child } = await fixture.forkAndStartYesBranch()
		await mock.setTime(forkTime + 63n * DAY)
		await writeContractAndWait(client, () => client.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(client, () => client.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().questionForker, functionName: 'materializeSecurityPoolQuestion', args: [fixture.poolFor(fixture.secondQuestionId).questionLedger, child] }))
		await addRepToMigrationBalance(client, fixture.base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(client, fixture.base.genesisUniverse, 1_000n * unit, [1])
		const pool = await client.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'getPool', args: [fixture.secondQuestionId, child] })
		const token = { abi: tokenArtifact.abi, address: getRepTokenAddress(child) }
		const accounts = await mock.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		const signer = getAddress(accounts[0])
		const wallet = createWriteClient(mock, BigInt(signer))
		await writeContractAndWait(client, () => client.writeContract({ ...token, functionName: 'transfer', args: [signer, 500n * unit] }))
		await mock.setTime(fixture.secondEndTime + 1n)
		await approveToken(client, token.address, pool)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGameWithLead', args: [1, 100n * unit] }))
		const game = await client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
		const signed = { abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi, address: game }
		const domain = tokenDomain(token.address, await client.readContract({ ...token, functionName: 'name' }))
		const validBefore = (await client.getBlock()).timestamp + DAY
		const permit = await signTypedDataV4(mock, signer, { domain, primaryType: 'Permit', types: PERMIT_TYPES, message: { owner: signer, spender: game, value: String(110n * unit), nonce: '0', deadline: String(validBefore) } })
		await writeContractAndWait(wallet, () => wallet.writeContract({ ...signed, functionName: 'depositRepOnOutcomeWithPermitAndLead', args: [2, 110n * unit, validBefore, permit.v, permit.r, permit.s] }))
		const nonce: Hex = `0x${'12'.repeat(32)}`
		const maximum = 20n * unit
		const data = encodeFunctionData({ ...signed, functionName: 'depositRepOnOutcomeWithAuthorizationAndLead', args: [signer, 1, maximum, 0n, validBefore, nonce, 27, nonce, nonce] })
		const selector: Hex = `0x${data.slice(2, 10)}`
		const operationHash = keccak256(encodeAbiParameters(parseAbiParameters('bytes4,address,address,uint248,uint256,uint8,uint256,uint256'), [selector, signer, pool, child, fixture.secondQuestionId, 1, maximum, maximum]))
		const boundNonce = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,bytes32,address'), [nonce, operationHash, signer]))
		const authorization = await signTypedDataV4(mock, signer, { domain, primaryType: 'ReceiveWithAuthorization', types: RECEIVE_WITH_AUTHORIZATION_TYPES, message: { from: signer, to: game, value: String(maximum), validAfter: '0', validBefore: String(validBefore), nonce: boundNonce } })
		const args = [signer, 1, maximum, 0n, validBefore, nonce, authorization.v, authorization.r, authorization.s] as const
		await assert.rejects(client.writeContract({ ...signed, functionName: 'depositRepOnOutcomeWithAuthorization', args }), /invalid signer|reverted/i)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [2, maximum] }))
		const balance = await client.readContract({ ...token, functionName: 'balanceOf', args: [signer] })
		await assert.rejects(client.writeContract({ ...signed, functionName: 'depositRepOnOutcomeWithAuthorizationAndLead', args }), /Deposit does not lead/)
		assert.strictEqual(await client.readContract({ ...token, functionName: 'authorizationState', args: [signer, boundNonce] }), false)
		assert.strictEqual(await client.readContract({ ...token, functionName: 'balanceOf', args: [signer] }), balance)
		// The same operation becomes valid after the signer funds enough additional support.
		await approveToken(wallet, token.address, pool)
		await writeContractAndWait(wallet, () => wallet.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, maximum] }))
		await writeContractAndWait(client, () => client.writeContract({ ...signed, functionName: 'depositRepOnOutcomeWithAuthorizationAndLead', args }))
		assert.strictEqual(await client.readContract({ ...token, functionName: 'authorizationState', args: [signer, boundNonce] }), true)
	})
	const initializeEscalationGame = async () => {
		const client = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(client, getRepTokenAddress(fixture.base.genesisUniverse), pool)
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, reportBond] }))
		return client.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })
	}
	test.each(['depositRepOnOutcomeWithPermit', 'depositRepOnOutcomeWithPermitAndLead'] as const)('genesis REP escalation deposits reject %s routing', async functionName => {
		const client = fixture.owner()
		const escalationGame = await initializeEscalationGame()
		await assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName,
				args: [QuestionOutcome.Yes, reportBond, 9_000_000_000n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support permit/,
		)
	})

	test.each(['depositRepOnOutcomeWithAuthorization', 'depositRepOnOutcomeWithAuthorizationAndLead'] as const)('genesis REP escalation deposits reject %s routing', async functionName => {
		const client = fixture.owner()
		const escalationGame = await initializeEscalationGame()
		await assert.rejects(
			client.writeContract({
				abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi,
				address: escalationGame,
				functionName,
				args: [client.account.address, QuestionOutcome.No, reportBond * 4n, 0n, 9_000_000_000n, `0x${'00'.repeat(32)}`, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
			}),
			/Genesis REP does not support authorization/,
		)
	})
})
