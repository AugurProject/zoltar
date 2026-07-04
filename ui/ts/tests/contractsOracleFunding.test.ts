/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { loadOracleManagerQueueOperationEthValue } from '../contracts.js'
import { addOpenOracleBountyBuffer } from '../lib/openOracle.js'

const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const TARGET_VAULT_ADDRESS = getAddress('0x0000000000000000000000000000000000000003')
const SECURITY_POOL_ADDRESS = getAddress('0x0000000000000000000000000000000000000004')

describe('oracle manager queue funding helpers', () => {
	test('converts pool ownership into REP deposit share for liquidation funding', async () => {
		const readContract: Parameters<typeof loadOracleManagerQueueOperationEthValue>[0]['readContract'] = async request => {
			if (request.address === MANAGER_ADDRESS && request.functionName === 'lastPrice') return (10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPendingSettlementOperationIds') return [] as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'pendingReportId') return 0n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getQueuedOperationEthCost') return 2n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getRequestPriceEthCost') return 10n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'isPriceValid') return true as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPriceRoundRemainingNotional') return (3n * 10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'securityPool') return SECURITY_POOL_ADDRESS as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'securityVaults') return [10n * 10n ** 18n, 4n * 10n ** 18n, 0n, 0n] as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'getTotalRepBalance') return (50n * 10n ** 18n) as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'poolOwnershipDenominator') return (100n * 10n ** 18n) as never
			throw new Error(`Unexpected read: ${request.address}.${request.functionName}`)
		}
		const client = { readContract }

		const ethValue = await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS, 'liquidation', TARGET_VAULT_ADDRESS, 2n * 10n ** 18n)

		expect(ethValue).toBe(0n)
	})

	test('buffers queued-operation fees for pending-report joins', async () => {
		const readContract: Parameters<typeof loadOracleManagerQueueOperationEthValue>[0]['readContract'] = async request => {
			if (request.address === MANAGER_ADDRESS && request.functionName === 'lastPrice') return (10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPendingSettlementOperationIds') return [1n] as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'pendingReportId') return 7n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getQueuedOperationEthCost') return 2n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getRequestPriceEthCost') return 10n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'isPriceValid') return false as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPriceRoundRemainingNotional') return 0n as never
			throw new Error(`Unexpected read: ${request.address}.${request.functionName}`)
		}
		const client = { readContract }

		const ethValue = await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS, 'withdrawRep', TARGET_VAULT_ADDRESS, 10n ** 18n)

		expect(ethValue).toBe(addOpenOracleBountyBuffer(2n))
	})

	test('treats zero ownership denominator as zero REP deposit share', async () => {
		const readContract: Parameters<typeof loadOracleManagerQueueOperationEthValue>[0]['readContract'] = async request => {
			if (request.address === MANAGER_ADDRESS && request.functionName === 'lastPrice') return (10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPendingSettlementOperationIds') return [] as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 4n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'pendingReportId') return 0n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getQueuedOperationEthCost') return 2n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getRequestPriceEthCost') return 10n as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'isPriceValid') return true as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'getPriceRoundRemainingNotional') return (3n * 10n ** 18n) as never
			if (request.address === MANAGER_ADDRESS && request.functionName === 'securityPool') return SECURITY_POOL_ADDRESS as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'securityVaults') return [10n * 10n ** 18n, 4n * 10n ** 18n, 0n, 0n] as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'getTotalRepBalance') return (50n * 10n ** 18n) as never
			if (request.address === SECURITY_POOL_ADDRESS && request.functionName === 'poolOwnershipDenominator') return 0n as never
			throw new Error(`Unexpected read: ${request.address}.${request.functionName}`)
		}
		const client = { readContract }

		const ethValue = await loadOracleManagerQueueOperationEthValue(client, MANAGER_ADDRESS, 'liquidation', TARGET_VAULT_ADDRESS, 2n * 10n ** 18n)

		expect(ethValue).toBe(0n)
	})
})
