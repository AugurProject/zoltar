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
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolCapitalRepairAuctionDelegate.sol', contractName: 'SecurityPoolCapitalRepairAuctionDelegate' },
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
			host: { sourcePath: 'contracts/statoblast/QuestionLedger.sol', contractName: 'QuestionLedger' },
			delegate: { sourcePath: 'contracts/statoblast/QuestionLedgerDelegate.sol', contractName: 'QuestionLedgerDelegate' },
			reason: 'Native fee accounting, security pool credits, settlement and trading operations mutate QuestionLedger storage through this fixed delegate.',
		},
		{
			host: { sourcePath: 'contracts/statoblast/SecurityPoolSettlementBook.sol', contractName: 'SecurityPoolSettlementBook' },
			delegate: { sourcePath: 'contracts/statoblast/SecurityPoolSettlementState.sol', contractName: 'SecurityPoolSettlementWriter' },
			reason: 'Question snapshots and maturity corrections are written to the settlement book through its fixed delegate.',
		},
	] satisfies readonly ExactLayoutPair[],
	anchoredLayouts: [
		{
			host: { sourcePath: 'contracts/statoblast/QuestionLedger.sol', contractName: 'QuestionLedger' },
			consumer: { sourcePath: 'contracts/statoblast/QuestionLedgerDelegate.sol', contractName: 'QuestionLedgerDelegate' },
			reason: 'Pool accounting events and fee accrual read these exact QuestionLedger slots through the shared storage base.',
			anchors: [
				{ label: 'settlementCollateralAttoEth', slot: '1', offset: 0, typeLabel: 'uint256' },
				{ label: 'lastSettlementSecurityPoolTime', slot: '3', offset: 0, typeLabel: 'uint256' },
			],
		},
	] satisfies readonly AnchoredLayout[],
} as const
