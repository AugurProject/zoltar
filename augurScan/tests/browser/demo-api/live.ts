import { requiredArrayItem } from '../../../browser/api-decoding.ts'
import type { LiveEventPayload } from '../../../browser/browser-types.ts'
import type { DemoEnvironment } from './environment.ts'

export const applyDemoBlock = (env: DemoEnvironment, payload: LiveEventPayload) => {
	const { context, counters } = env
	const { demoNetworks, demoLogs, demoRichList, demoPools } = env.fixtures
	if (context.pageUrl.searchParams.get('streamDemo') !== '1') return
	const chainId = String(payload.chainId)
	const network = demoNetworks.find(item => item.chain_id === chainId)
	if (network === undefined) return
	counters.liveSequence++
	const nextBlock = String(payload.blockNumber ?? BigInt(network.indexed_block) + 1n)
	const nextHash = `0x${BigInt(counters.liveSequence).toString(16).padStart(64, '0')}`
	const timestamp = new Date().toISOString()
	network.indexed_block = nextBlock
	network.indexed_hash = nextHash
	network.indexed_timestamp = timestamp
	network.observed_block = nextBlock
	network.finalized_block = String(BigInt(nextBlock) - 64n)
	network.last_poll_at = timestamp
	network.last_success_at = timestamp
	const template = demoLogs.find(item => item.chain_id === chainId) ?? requiredArrayItem(demoLogs, 0, 'Demo live log template')
	demoLogs.unshift({
		...template,
		block_number: nextBlock,
		block_hash: nextHash,
		block_timestamp: timestamp,
		transaction_index: 0,
		log_index: counters.liveSequence,
		tx_hash: `0x${(BigInt(counters.liveSequence) + 10_000n).toString(16).padStart(64, '0')}`,
		event_name: counters.liveSequence % 2 === 0 ? 'PoolAccountingCheckpoint' : 'Transfer',
		summary: counters.liveSequence % 2 === 0 ? 'New pool accounting checkpoint' : 'New token transfer',
	})
	if (demoLogs.length > 120) demoLogs.length = 120
	const account = demoRichList.find(item => item.chain_id === chainId)
	if (account !== undefined) {
		account.transaction_count = String(Number(account.transaction_count) + 1)
		account.interaction_count = String(Number(account.interaction_count) + 1)
		account.native_balance = (BigInt(account.native_balance) + 10_000_000_000_000_000n).toString()
		account.native_balance_detail = { balance: account.native_balance, blockNumber: nextBlock }
		account.last_balance_refresh = timestamp
	}
	const pool = demoPools.find(item => item.chain_id === chainId)
	if (pool !== undefined) {
		pool.snapshot_block = nextBlock
		pool.settlement_collateral_atto_eth = (BigInt(pool.settlement_collateral_atto_eth) + 10_000_000_000_000_000n).toString()
	}
}
