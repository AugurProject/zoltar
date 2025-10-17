// common contract addresses
export const MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11n // Contract for bundling bulk call transactions, deployed on every chain. https://github.com/mds1/multicall
export const ETHEREUM_LOGS_LOGGER_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeEn
export const NULL_ADDRESS = 0x0000000000000000000000000000000000000000n
export const GENESIS_REPUTATION_TOKEN = 0x221657776846890989a759BA2973e427DfF5C9bBn;

export const Multicall3ABI = [
	'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
	'function getEthBalance(address) returns (uint256)',
]

// Other
export const MOCK_ADDRESS = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefn
export const PROXY_DEPLOYER_ADDRESS = 0x7a0d94f55792c434d74a40883c6ed8545e406d12n
export const VITALIK = 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045n
export const REP_BOND = 10n**18n
export const BURN_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeFn
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

// Testing
export const TEST_ADDRESSES = [
	0x0000000000000000000000000000000000000012n,
	0x0000000000000000000000000000000000000013n,
	0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BCn,
	0x90F79bf6EB2c4f870365E785982E1f101E93b906n,
	0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65n,
	0x9965507D1a55bcC2695C58ba16FB37d819B0A4dcn,
	0x976EA74026E726554dB657fA54763abd0C3a0aa9n
]
export const YEAR_2030 = 1902074321n
export const DAY = 86400n

export const MOCK_PRIVATE_KEYS_ADDRESS = 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdfn // an address represeting 0x1 privatekey

export const QUINTILLION = 10n**18n

export const ETHEREUM_EIP1559_ELASTICITY_MULTIPLIER = 4n // Bounds the maximum gas limit an EIP-1559 block may have, Ethereum = 4, Polygon = 8, lets just default to 4
export const ETHEREUM_EIP1559_BASEFEECHANGEDENOMINATOR = 8n // Bounds the amount the base fee can change between blocks.
export const CANNOT_SIMULATE_OFF_LEGACY_BLOCK = 'Cannot simulate off a legacy block'
export const NEW_BLOCK_ABORT = 'New Block Abort'
export const DEFAULT_CALL_ADDRESS = 0x1n
export const MAX_BLOCK_CACHE = 5
export const TIME_BETWEEN_BLOCKS = 12
export const GAS_PER_BLOB = 2n**17n
export const METAMASK_ERROR_USER_REJECTED_REQUEST = 4001
export const METAMASK_ERROR_NOT_AUTHORIZED = 4100
export const METAMASK_ERROR_FAILED_TO_PARSE_REQUEST = -32700
export const METAMASK_ERROR_BLANKET_ERROR = -32603
export const ERROR_INTERCEPTOR_DISABLED = { error: { code: METAMASK_ERROR_USER_REJECTED_REQUEST, message: 'The Interceptor is disabled' } }
export const METAMASK_ERROR_ALREADY_PENDING = { error: { code: -32002, message: 'Access request pending already.' } }
export const ERROR_INTERCEPTOR_NO_ACTIVE_ADDRESS = { error: { code: 2, message: 'Interceptor: No active address' } }
export const METAMASK_ERROR_NOT_CONNECTED_TO_CHAIN = { error: { code: 4900, message: 'Interceptor: Not connected to chain' } }
export const ERROR_INTERCEPTOR_GET_CODE_FAILED = { error: { code: -40001, message: 'Interceptor: Get code failed' } } // I wonder how we should come up with these numbers?
export const ERROR_INTERCEPTOR_GAS_ESTIMATION_FAILED = -40002
