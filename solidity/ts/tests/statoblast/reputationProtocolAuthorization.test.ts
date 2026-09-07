import { beforeEach, describe, test } from 'bun:test'
import { encodeAbiParameters, getAddress, isHex, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { ReputationToken_ReputationToken, statoblast_EscalationGame_EscalationGame, statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization } from '../../types/contractArtifact'
import { useStatoblastVaultAccountingFixture, type StatoblastVaultAccountingFixture } from './fixture'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'

function splitSignature(signature: Hex) {
	if (signature.length !== 132) throw new Error('Expected a 65-byte signature')
	return { r: `0x${signature.slice(2, 66)}` as Hex, s: `0x${signature.slice(66, 130)}` as Hex, v: Number.parseInt(signature.slice(130, 132), 16) }
}

function functionSelector(signature: string) {
	return keccak256(new TextEncoder().encode(signature)).slice(0, 10) as Hex
}

describe('Statoblast REP authorization entry points', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, QuestionOutcome, addressString, createWriteClient, depositToEscalationGame, getAnvilWindowEthereum, getEscalationGameDeposits, getQuestionEndDate, manipulatePriceOracle, repDeposit, reportBond, transferRepToAddress } = fixture

	let mockWindow: StatoblastVaultAccountingFixture['mockWindow']
	let client: StatoblastVaultAccountingFixture['client']
	let securityPoolAddresses: StatoblastVaultAccountingFixture['securityPoolAddresses']
	let questionId: bigint

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	const getNodeSigner = async () => {
		const accounts = await mockWindow.request({ method: 'eth_accounts' })
		if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('Anvil signer missing')
		const owner = getAddress(accounts[0])
		return { owner, ownerClient: createWriteClient(mockWindow, BigInt(owner), 0) }
	}

	const signTypedData = async (owner: Address, typedData: object) => {
		const signature = await mockWindow.request({ method: 'eth_signTypedData_v4', params: [owner, JSON.stringify(typedData)] })
		if (typeof signature !== 'string' || !isHex(signature)) throw new Error('Typed-data signature missing')
		return splitSignature(signature)
	}

	const initializeEscalationGame = async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10_000n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		return securityPoolAddresses.escalationGame
	}

	test('atomic permit and pre-submitted exact permit both accept a capped escalation deposit', async () => {
		const escalationGame = await initializeEscalationGame()
		const { owner, ownerClient } = await getNodeSigner()
		const token = addressString(GENESIS_REPUTATION_TOKEN)
		const nonDecisionThresholdAttoRep = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'nonDecisionThresholdAttoRep' })
		await transferRepToAddress(client, owner, nonDecisionThresholdAttoRep)
		const deadline = 9_000_000_000n

		const firstMaximum = reportBond * 4n
		const [firstAccepted] = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.Yes, firstMaximum] })
		const firstPermitNonce = await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'nonces', args: [owner] })
		const firstPermit = await signTypedData(owner, {
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'Permit',
			types: {
				Permit: [
					{ name: 'owner', type: 'address' },
					{ name: 'spender', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'nonce', type: 'uint256' },
					{ name: 'deadline', type: 'uint256' },
				],
			},
			message: { owner, spender: escalationGame, value: firstAccepted.toString(), nonce: firstPermitNonce.toString(), deadline: deadline.toString() },
		})
		await writeContractAndWait(ownerClient, () =>
			ownerClient.writeContract({ abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi, address: escalationGame, functionName: 'depositRepOnOutcomeWithPermit', args: [QuestionOutcome.Yes, firstMaximum, firstAccepted, deadline, firstPermit.v, firstPermit.r, firstPermit.s] }),
		)

		const secondMaximum = nonDecisionThresholdAttoRep
		const [secondAccepted] = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.Yes, secondMaximum] })
		if (secondAccepted >= secondMaximum) throw new Error('Test requires a capped accepted deposit below the requested maximum')
		const secondPermitNonce = await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'nonces', args: [owner] })
		const secondPermit = await signTypedData(owner, {
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'Permit',
			types: {
				Permit: [
					{ name: 'owner', type: 'address' },
					{ name: 'spender', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'nonce', type: 'uint256' },
					{ name: 'deadline', type: 'uint256' },
				],
			},
			message: { owner, spender: escalationGame, value: secondAccepted.toString(), nonce: secondPermitNonce.toString(), deadline: deadline.toString() },
		})
		await writeContractAndWait(client, () => client.writeContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'permit', args: [owner, escalationGame, secondAccepted, deadline, secondPermit.v, secondPermit.r, secondPermit.s] }))
		await writeContractAndWait(ownerClient, () =>
			ownerClient.writeContract({ abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi, address: escalationGame, functionName: 'depositRepOnOutcomeWithPermit', args: [QuestionOutcome.Yes, secondMaximum, secondMaximum, 0n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] }),
		)

		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.Yes)
		const ownerDeposits = deposits.filter(deposit => deposit.depositor.toLowerCase() === owner.toLowerCase())
		fixture.strictEqualTypeSafe(ownerDeposits.length, 2, 'both permit paths should record the owner as depositor')
		fixture.strictEqualTypeSafe(ownerDeposits[1]?.amountAttoRep, secondAccepted, 'fallback should transfer only the capped accepted amount')
		fixture.strictEqualTypeSafe(await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'allowance', args: [owner, escalationGame] }), 0n, 'exact pre-submitted allowance should be fully consumed')
	})

	test('relayed escalation authorization binds pool, universe, question, outcome, maximum, actual amount, and owner', async () => {
		const escalationGame = await initializeEscalationGame()
		const { owner } = await getNodeSigner()
		const relayer = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const token = addressString(GENESIS_REPUTATION_TOKEN)
		await transferRepToAddress(client, owner, repDeposit)
		const maximumDepositAttoRep = reportBond * 4n
		const [acceptedAmountAttoRep] = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGame, functionName: 'previewDepositOnOutcome', args: [QuestionOutcome.No, maximumDepositAttoRep] })
		const nonce = `0x${'81'.repeat(32)}` as Hex
		const validBefore = 9_000_000_000n
		const operationHash = keccak256(
			encodeAbiParameters(
				[{ type: 'bytes4' }, { type: 'address' }, { type: 'address' }, { type: 'uint248' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }],
				[functionSelector('depositRepOnOutcomeWithAuthorization(address,uint8,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'), owner, securityPoolAddresses.securityPool, 0n, questionId, QuestionOutcome.No, maximumDepositAttoRep, acceptedAmountAttoRep],
			),
		)
		const boundNonce = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }], [nonce, operationHash, owner]))
		const signature = await signTypedData(owner, {
			domain: { chainId: 1, name: 'Reputation', version: '1', verifyingContract: token },
			primaryType: 'ReceiveWithAuthorization',
			types: {
				ReceiveWithAuthorization: [
					{ name: 'from', type: 'address' },
					{ name: 'to', type: 'address' },
					{ name: 'value', type: 'uint256' },
					{ name: 'validAfter', type: 'uint256' },
					{ name: 'validBefore', type: 'uint256' },
					{ name: 'nonce', type: 'bytes32' },
				],
			},
			message: { from: owner, to: escalationGame, value: acceptedAmountAttoRep.toString(), validAfter: '0', validBefore: validBefore.toString(), nonce: boundNonce },
		})
		const relayerRepBefore = await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'balanceOf', args: [relayer.account.address] })
		await fixture.assert.rejects(
			relayer.writeContract({ abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi, address: escalationGame, functionName: 'depositRepOnOutcomeWithAuthorization', args: [owner, QuestionOutcome.Yes, maximumDepositAttoRep, 0n, validBefore, nonce, signature.v, signature.r, signature.s] }),
			/invalid signer|reverted/i,
			'altering the outcome must invalidate the operation-bound signature',
		)
		await writeContractAndWait(relayer, () =>
			relayer.writeContract({ abi: statoblast_interfaces_IEscalationGame_IEscalationGameAuthorization.abi, address: escalationGame, functionName: 'depositRepOnOutcomeWithAuthorization', args: [owner, QuestionOutcome.No, maximumDepositAttoRep, 0n, validBefore, nonce, signature.v, signature.r, signature.s] }),
		)

		const deposits = await getEscalationGameDeposits(client, escalationGame, QuestionOutcome.No)
		fixture.strictEqualTypeSafe(deposits.at(-1)?.depositor, owner, 'relayed escalation deposit should credit the REP owner')
		fixture.strictEqualTypeSafe(await client.readContract({ abi: ReputationToken_ReputationToken.abi, address: token, functionName: 'balanceOf', args: [relayer.account.address] }), relayerRepBefore, 'relayer must receive no REP')
	})
})
