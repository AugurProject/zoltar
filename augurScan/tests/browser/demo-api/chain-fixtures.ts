import type { ContractRecord } from '../../../browser/browser-types.ts'
import { requiredArrayItem } from '../../../browser/api-decoding.ts'

export const demoHash = `0x${'7e4b9ad70f2248c48217f9c9ef694017'.repeat(2)}`

export const demoAddress = (seed: string) => `0x${seed.repeat(40).slice(0, 40)}`

const demoManifestDeployment = (networkId: string, index: number, deploymentBlock: string | undefined): { deployment_block: string | null; deployment_timestamp: string | null } => {
	if (networkId === 'mainnet') return { deployment_block: deploymentBlock ?? null, deployment_timestamp: deploymentBlock === undefined ? null : new Date(Date.now() - (5 - index) * 86_400_000).toISOString() }
	if (index < 3) return { deployment_block: String(8_750_000 + index * 12), deployment_timestamp: networkId === 'sepolia' ? new Date(Date.now() - (3 - index) * 86_400_000).toISOString() : null }
	return { deployment_block: null, deployment_timestamp: null }
}

const DEMO_LOG_CONTRACT_LABELS = ['Security Pool 0x8c2f', 'OpenOracle', 'Genesis REP', 'Security Pool Factory'] as const

const demoPoolQuestionTitle = (networkId: string) => (networkId === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?')

const demoEvents = ['PoolAccountingCheckpoint', 'Transfer', 'PriceReported', 'ClaimDeposit', 'DeploySecurityPool', 'ReportSubmitted', 'UniverseInitialized', 'BidSubmitted']

export const createDemoChainFixtures = () => {
	const demoNetworks = [
		{
			chain_id: '1',
			id: 'mainnet',
			name: 'Ethereum Mainnet',
			start_block: '23180000',
			indexed_block: '23184712',
			indexed_hash: demoHash,
			indexed_timestamp: new Date(Date.now() - 19_000).toISOString(),
			observed_block: '23184712',
			finalized_block: '23184648',
			phase: 'live',
			last_poll_at: new Date().toISOString(),
			last_success_at: new Date().toISOString(),
			consecutive_failures: 0,
			last_error: null,
			explorer_base_url: 'https://etherscan.io',
		},
		{
			chain_id: '11155111',
			id: 'sepolia',
			name: 'Sepolia',
			start_block: '8970000',
			indexed_block: '8972451',
			indexed_hash: demoHash,
			indexed_timestamp: new Date(Date.now() - 46_000).toISOString(),
			observed_block: '8972466',
			finalized_block: '8972402',
			phase: 'backfilling',
			last_poll_at: new Date().toISOString(),
			last_success_at: new Date().toISOString(),
			consecutive_failures: 0,
			last_error: null,
			explorer_base_url: 'https://sepolia.etherscan.io',
		},
	]

	const demoContracts = demoNetworks.flatMap(network => {
		const manifestDefinitions: readonly (readonly [address: string, label: string, kind: string, deploymentBlock: string | undefined, exact: boolean])[] = [
			['0x7A0D94F55792C434d74a40883C6ed8545E406D12', 'Proxy Deployer', 'proxyDeployer', '22181455', true],
			['0x052c04adFF6C1BF51f52158e36441C1e99cdfDB4', 'Deployment Status Oracle', 'deploymentStatusOracle', '22181462', true],
			['0x529dcaC57677451CBfe766d88CcC133D082500df', 'OpenOracle', 'openOracle', '22181501', true],
			['0xaa280cf94Fc3531aDe40b479C17eBef53923291C', 'Zoltar', 'zoltar', undefined, true],
			['0xBea56ec12C943213408DA17f754A523A8aB38947', 'Security Pool Factory', 'securityPoolFactory', undefined, true],
			['0x221657776846890989a759ba2973e427dff5c9bb', 'Genesis REP', 'reputationToken', '7290001', true],
			['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'Wrapped Ether', 'weth', '4719568', true],
			['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin', 'usdc', '6082465', true],
			['0x1F98431c8aD98523631AE4a59f267346ea31F984', 'Uniswap V3 Factory', 'uniswapV3Factory', '12369621', true],
		]
		const manifestContracts: ContractRecord[] = manifestDefinitions.map(([address, label, kind, deploymentBlock, exact], index) => ({
			chain_id: network.chain_id,
			address,
			label,
			kind,
			provenance: 'manifest',
			discovery_block: null,
			discovery_tx_hash: null,
			...demoManifestDeployment(network.id, index, deploymentBlock),
			deployment_block_exact: deploymentBlock === undefined ? null : exact,
			deployment_checked_block: network.indexed_block,
			explorer_base_url: network.explorer_base_url,
		}))
		return [
			...manifestContracts,
			{
				chain_id: network.chain_id,
				address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				label: 'Security Pool 0',
				kind: 'securityPool',
				provenance: 'DeploySecurityPool',
				discovery_block: network.indexed_block,
				discovery_tx_hash: demoHash,
				deployment_block: network.indexed_block,
				deployment_timestamp: network.indexed_timestamp,
				deployment_block_exact: true,
				deployment_checked_block: network.indexed_block,
				explorer_base_url: network.explorer_base_url,
			},
		]
	})

	const demoLogs = Array.from({ length: 18 }, (_, index) => {
		const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo network')
		return {
			chain_id: network.chain_id,
			network_id: network.id,
			block_number: String(BigInt(network.indexed_block) - BigInt(index)),
			block_hash: network.indexed_hash,
			block_timestamp: new Date(new Date(network.indexed_timestamp).getTime() - index * 14_000).toISOString(),
			transaction_index: index % 7,
			log_index: index + 2,
			tx_hash: demoHash.slice(0, -2) + String(index).padStart(2, '0'),
			emitter_address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			contract_label: DEMO_LOG_CONTRACT_LABELS[index % DEMO_LOG_CONTRACT_LABELS.length],
			contract_kind: 'securityPool',
			event_name: demoEvents[index % demoEvents.length],
			function_name: index % 2 === 0 ? 'report' : 'checkpoint',
			function_signature: index % 2 === 0 ? 'report(uint256)' : 'checkpoint(uint8,address[])',
			action_summary: index % 2 === 0 ? 'report' : 'checkpoint',
			to_address: '0x7777777777777777777777777777777777777777',
			summary: index % 2 === 0 ? 'amount=4,250.75 REP · vault=Market maker (0x19B4…E2a0)' : `reportId=1842 · price=0.004281 ${network.id === 'sepolia' ? 'SepoliaETH' : 'ETH'} · outcomeIndex=2`,
			decode_status: index === 7 ? 'unknown' : 'decoded',
			canonical: true,
			finalized: index > 4,
			topics: [demoHash],
			data: '0x00',
			arguments: {
				['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
				vault: '0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0',
				coordinator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
			},
			display_arguments: {
				['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
				vault: 'Market maker (0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0)',
				coordinator: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
				recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
			},
			argument_schema: [
				{ index: 0, name: 'amountAttoRep', type: 'uint256' },
				{ index: 1, name: 'vault', type: 'address', indexed: true },
				{ index: 2, name: 'coordinator', type: 'address' },
				{ index: 3, name: 'recipients', type: 'address[]' },
			],
			origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
			explorer_base_url: network.explorer_base_url,
		}
	})

	const demoRichList = Array.from({ length: 64 }, (_, index) => {
		const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo rich-list network')
		const address = `0x${(BigInt(index + 1) * 0x123456789abcdefn).toString(16).padStart(40, '0')}`
		const repBalance = BigInt(920 - index * 8) * 10n ** 18n + (index === 0 ? 123_456_789n : 0n) + (index === 1 ? 1n : 0n)
		const poolCount = 1 + (index % 4)
		const vaultCount = (index + 1) % 3
		return {
			chain_id: network.chain_id,
			network_id: network.id,
			explorer_base_url: network.explorer_base_url,
			address,
			label: index === 2 ? 'Price Coordinator' : null,
			kind: index === 2 ? 'priceCoordinator' : null,
			largest_rep_token_address: requiredArrayItem(demoNetworks, 0, 'Mainnet demo network').chain_id === network.chain_id ? '0x221657776846890989a759ba2973e427dff5c9bb' : '0x754bc4ca2539560f1b48a9c3d2def5b9718f2c82',
			largest_rep_balance: repBalance.toString(),
			largest_rep_decimals: 18,
			largest_rep_symbol: 'REP',
			weth_balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
			native_balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
			rep_token_count: index <= 1 ? '2' : '1',
			sampled_rep_token_count: index === 0 ? '2' : '1',
			weth_token_count: '1',
			sampled_weth_token_count: '1',
			sampled_native_count: '1',
			returned_rep_token_count: index === 0 ? '2' : '1',
			returned_weth_token_count: '1',
			rep_balances_truncated: false,
			weth_balances_truncated: false,
			transaction_count: String(84 - index),
			interaction_count: String(102 - index),
			pool_count: String(poolCount),
			vault_count: String(vaultCount),
			active_vault_count: String(index % 2),
			oldest_balance_block: String(BigInt(network.indexed_block) - BigInt(index % 4)),
			last_balance_refresh: new Date(Date.now() - index * 17_000).toISOString(),
			rep_balances: [
				{
					address: requiredArrayItem(demoNetworks, 0, 'Mainnet demo network').chain_id === network.chain_id ? '0x221657776846890989a759ba2973e427dff5c9bb' : '0x754bc4ca2539560f1b48a9c3d2def5b9718f2c82',
					balance: repBalance.toString(),
					contractLabel: 'Genesis REP',
					universeId: '0',
					symbol: 'REP',
					decimals: 18,
					blockNumber: network.indexed_block,
				},
				...(index === 0
					? [
							{
								address: network.id === 'sepolia' ? '0x86a1c70f2d9d6a0794458c4b2d08f2a1bd9289c1' : '0x4a0f2fc79d092e999aaa1e1e86bd4f3fdb68697b',
								balance: (repBalance / 3n).toString(),
								contractLabel: 'Child REP',
								universeId: '2',
								symbol: 'REP',
								decimals: 18,
								blockNumber: network.indexed_block,
							},
						]
					: []),
			],
			weth_balances: [
				{
					address: '0x0000000000000000000000000000000000000007',
					balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
					name: 'Wrapped Ether',
					symbol: 'WETH',
					decimals: 18,
					blockNumber: network.indexed_block,
				},
			],
			native_balance_detail: {
				balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
				blockNumber: network.indexed_block,
			},
			pool_associations: Array.from({ length: poolCount }, (_, poolIndex) => ({
				address: `0x${(BigInt(index + 1) * 100n + BigInt(poolIndex + 1)).toString(16).padStart(40, 'a')}`,
				label: poolIndex === 0 ? 'Security Pool' : null,
				questionTitle: poolIndex === 0 ? demoPoolQuestionTitle(network.id) : null,
			})),
			vault_positions: Array.from({ length: vaultCount }, (_, vaultIndex) => ({
				poolAddress: `0x${(BigInt(index + 1) * 100n + BigInt(vaultIndex + 1)).toString(16).padStart(40, 'a')}`,
				questionTitle: network.id === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
				repBackingUnits: String(BigInt(120 + vaultIndex) * 10n ** 18n),
				underwritingLimitAttoEth: String(BigInt(85 + vaultIndex) * 10n ** 18n),
				claimableFeesAttoEth: String(BigInt(3 + vaultIndex) * 10n ** 16n),
				blockNumber: network.indexed_block,
			})),
		}
	})

	const demoInitialTransactionCounts = new Map(demoRichList.map(item => [`${item.chain_id}:${item.address.toLowerCase()}`, Number(item.transaction_count)]))

	const demoNetworkBaselines = new Map(demoNetworks.map(network => [network.chain_id, { blockNumber: BigInt(network.indexed_block), timestamp: new Date(network.indexed_timestamp).getTime() }]))

	return { demoNetworks, demoContracts, demoLogs, demoRichList, demoInitialTransactionCounts, demoNetworkBaselines }
}
