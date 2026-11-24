import { custom, sepolia } from '@zoltar/core-shared/evm/ethereum'
import { expect, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, isHex } from '@zoltar/bot-shared/ethereum'
import { securityPoolFactoryAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { discoverSecurityPoolCapital } from '../../src/monitoring/discovery-security-pools.ts'
import { address, snapshotFixture } from '../operations/fixture.ts'

test('security pool discovery authenticates question-first registration at the pinned block', async () => {
	const snapshot = snapshotFixture()
	const question = snapshot.pools[0]
	if (question === undefined) throw new Error('Missing question')
	question.questionId = '999'
	question.universeId = '17'
	let registrationChecked = false
	const client = createPublicClient({
		chain: sepolia,
		transport: custom({
			async request({ method, params }) {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC')
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string' || !isHex(call.data)) throw new Error('Missing call')
				const decoded = decodeFunctionData({ abi: [...securityPoolFactoryAbi, ...securityPoolAbi], data: call.data })
				expect(params[1]).toBe('0x64')
				if (decoded.functionName === 'securityPoolOf') return encodeAbiParameters([{ type: 'address' }], [question.securityPool])
				if (decoded.functionName === 'getQuestionLedger') {
					expect(decoded.args).toEqual([999n, 17n])
					registrationChecked = true
					return encodeAbiParameters([{ type: 'address' }], [question.address])
				}
				// A mismatched immutable factory must fail after the correctly ordered registration lookup.
				if (decoded.functionName === 'factory') return encodeAbiParameters([{ type: 'address' }], [address(999)])
				if (decoded.functionName === 'zoltar') return encodeAbiParameters([{ type: 'address' }], [snapshot.deployments.zoltar])
				throw new Error('Unexpected read')
			},
		}),
	})
	await expect(discoverSecurityPoolCapital({ anchorBlockNumber: 100n, client, deployments: snapshot.deployments, wallet: snapshot.wallet.address }, [question], 100n)).rejects.toThrow('Security pool factory binding')
	expect(registrationChecked).toBe(true)
})
