import type { SubmissionSettings } from '../../src/execution/transaction-submission.ts'
import { expect, test } from 'bun:test'
import { decodeConnectivity, decodeDeployment, decodeExecutorDeployment, decodePrediction, decodeSettings, decodeSubmission } from '../../src/dashboard/api-validation.ts'
import { isSnapshot } from '../../src/dashboard/snapshot-validation.ts'

const address = `0x${'1'.repeat(40)}`
const hash = `0x${'2'.repeat(64)}`
const settings = { maxSpotTwapTicks: '100', minimumProfitBps: '5', minimumProfitWeth: '0.01', minimumRemainingBlocks: '3', minimumRemainingSeconds: '30', pollMilliseconds: 1000, twapSeconds: 60 }

test('validates settings and submission envelopes before populating forms', () => {
	expect(decodeSettings({ settings }).settings).toEqual(settings)
	expect(() => decodeSettings({ settings: { ...settings, pollMilliseconds: '1000' } })).toThrow('invalid strategy response')
	expect(() => decodeSettings({ settings: { ...settings, twapSeconds: Infinity } })).toThrow('invalid strategy response')
	const submission: SubmissionSettings = { mode: 'public', minimumBundleRelaySuccesses: 1, relayUrls: [] }
	expect(decodeSubmission({ submission }).submission).toEqual(submission)
	expect(() => decodeSubmission({ submission: { ...submission, relayUrls: [null] } })).toThrow('invalid submission response')
})

test('rejects malformed chain and deployment responses before changing local configuration', () => {
	const connectivity = { publicRpcUrls: ['https://rpc.example'], readRpcUrl: 'https://rpc.example' }
	expect(decodeConnectivity({ connectivity, network: 'sepolia', rpcQuorum: 2 }).network).toBe('sepolia')
	for (const value of [
		{ connectivity, network: 'other', rpcQuorum: 1 },
		{ connectivity, network: 'mainnet', rpcQuorum: '1' },
		{ connectivity: { ...connectivity, publicRpcUrls: [3] }, network: 'mainnet', rpcQuorum: 1 },
	])
		expect(() => decodeConnectivity(value)).toThrow('invalid connectivity response')
	const deployment = { uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: false, quorumRpcUrls: [] }
	expect(decodeDeployment({ deployment }).deployment).toEqual(deployment)
	expect(() => decodeDeployment({ deployment: { ...deployment, uniswapV2Enabled: 'false' } })).toThrow('invalid deployment response')
})

test('validates executor responses before confirmation or showing deployment success', () => {
	expect(decodePrediction({ address }).address).toBe(address)
	expect(decodeExecutorDeployment({ address, alreadyDeployed: false, transactionHash: hash }).transactionHash).toBe(hash)
	expect(decodeExecutorDeployment({ address, alreadyDeployed: true }).alreadyDeployed).toBe(true)
	for (const value of [{}, { address: 'not-an-address' }, { address: 1 }]) expect(() => decodePrediction(value)).toThrow('invalid executor prediction')
	for (const value of [
		{ address, alreadyDeployed: 'false' },
		{ address, alreadyDeployed: false, transactionHash: 'garbage' },
	])
		expect(() => decodeExecutorDeployment(value)).toThrow('invalid executor deployment response')
})

test('rejects snapshots whose field names exist but whose values are invalid', () => {
	expect(isSnapshot({ status: 'running', submission: {}, opportunities: [], executionHistory: [], positions: [], transactionActivity: [] })).toBe(false)
})
