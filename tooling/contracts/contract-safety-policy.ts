export type ContractReference = {
	sourcePath: string
	contractName: string
}

export type ExactLayoutPair = {
	host: ContractReference
	delegate: ContractReference
	reason: string
}

type StorageAnchor = {
	label: string
	slot: string
	offset: number
	typeLabel: string
}

export type AnchoredLayout = {
	host: ContractReference
	consumer: ContractReference
	anchors: readonly StorageAnchor[]
	reason: string
}

const runtimeLimitBytes = 24_576
const initcodeLimitBytes = 49_152

export const contractSafetyPolicy = {
	runtimeLimitBytes,
	initcodeLimitBytes,
	excludedSourcePrefixes: ['contracts/test/', 'contracts/trading/test/'],
	exactLayoutPairs: [
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolCapitalLedger.sol', contractName: 'SecurityPoolCapitalLedger' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolCapitalAuctionDelegate.sol', contractName: 'SecurityPoolCapitalAuctionDelegate' },
			reason: 'Auction winners detach exact funded positions in the original capital ledger without changing custody or health history.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolCapitalLedger.sol', contractName: 'SecurityPoolCapitalLedger' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolCapitalLifecycleDelegate.sol', contractName: 'SecurityPoolCapitalLifecycleDelegate' },
			reason: 'Owner registration and fork choices mutate the original capital custody ledger through a fixed delegate.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/EscalationGame.sol', contractName: 'EscalationGame' },
			delegate: { sourcePath: 'contracts/statoblast/EscalationGameDepositDelegate.sol', contractName: 'EscalationGameDepositDelegate' },
			reason: 'Deposits mutate EscalationGame storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/EscalationGame.sol', contractName: 'EscalationGame' },
			delegate: { sourcePath: 'contracts/statoblast/EscalationGameClaimDelegate.sol', contractName: 'EscalationGameClaimDelegate' },
			reason: 'Claim accounting reads and mutates EscalationGame storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolEventEmitter' },
			reason: 'Native fee accounting and portfolio credits mutate SecurityPool storage through this fixed delegate.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolSettlementDelegate.sol', contractName: 'SecurityPoolSettlementDelegate' },
			reason: 'Settlement operations mutate SecurityPool storage through delegatecall.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolOperationsDelegate.sol', contractName: 'SecurityPoolOperationsDelegate' },
			reason: 'Native trading operations mutate SecurityPool storage through delegatecall.',
		},
	] satisfies readonly ExactLayoutPair[],
	anchoredLayouts: [
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPool.sol', contractName: 'SecurityPool' },
			consumer: { sourcePath: 'contracts/statoblast/SecurityPoolEventEmitter.sol', contractName: 'SecurityPoolEventEmitter' },
			reason: 'Pool accounting events and fee accrual read these exact SecurityPool slots through the shared storage base.',
			anchors: [
				{ label: 'settlementCollateralAttoEth', slot: '1', offset: 0, typeLabel: 'uint256' },
				{ label: 'lastUpdatedFeeAccumulator', slot: '4', offset: 0, typeLabel: 'uint256' },
			],
		},
	] satisfies readonly AnchoredLayout[],
} as const
