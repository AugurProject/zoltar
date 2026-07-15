// SPDX-License-Identifier: MIT
pragma solidity >=0.8.28 <0.9.0;

import { ReentrancyGuard } from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { Math } from '@openzeppelin/contracts/utils/math/Math.sol';

/**
 * @title LoggedOpenOracle
 * @notice A trust-free price oracle that uses an escalating auction mechanism
 * @dev This contract enables price discovery through economic incentives where
 *      expiration serves as evidence of a good price with appropriate parameters.
 *      Participants are responsible for validating report instance parameters before participation
 *      and unsafe parameter sets including but not limited to settlementTime too high and callbackGasLimit too high
 *      will result in lost funds.
 * @author OpenOracle Team
 * @custom:version 0.1.6
 * @custom:documentation https://docs.openoracle.org
 */

contract LoggedOpenOracle is ReentrancyGuard {
	using SafeERC20 for IERC20;

	enum FeeReason {
		Token1Dispute,
		Token2Dispute
	}

	enum PayoutReason {
		SettlementPrincipal,
		DisputePayout,
		ReporterReward,
		SettlerReward,
		ProtocolFeeWithdrawal
	}

	// Constants
	uint256 public constant PRICE_PRECISION = 1e30;
	uint256 public constant PERCENTAGE_PRECISION = 1e7;
	uint256 public constant MULTIPLIER_PRECISION = 100;
	bytes4 internal constant CALLBACK_SELECTOR = bytes4(
		keccak256('openOracleCallback(uint256,uint256,uint256,uint256,address,address)')
	);

	// State variables
	uint256 public nextReportId = 1;

	mapping(uint256 => ReportMeta) public reportMeta;
	mapping(uint256 => ReportStatus) public reportStatus;
	mapping(address => mapping(address => uint256)) public protocolFees;
	mapping(address => uint256) public accruedProtocolFees;
	mapping(uint256 => extraReportData) public extraData;
	mapping(uint256 => mapping(uint256 => disputeRecord)) public disputeHistory;

	struct disputeRecord {
		uint128 amount1;
		uint128 amount2;
		address tokenToSwap;
		uint48 reportTimestamp;
	}

	struct extraReportData {
		bytes32 stateHash;
		address callbackContract;
		uint32 numReports;
		uint32 callbackGasLimit;
		address protocolFeeRecipient;
		bool trackDisputes;
	}

	struct ReportMeta {
		uint128 exactToken1Report;
		uint128 escalationHalt;
		uint96 fee;
		uint96 settlerReward;
		address token1;
		uint48 settlementTime;
		address token2;
		bool timeType;
		uint24 feePercentage;
		uint24 protocolFee;
		uint16 multiplier;
		uint24 disputeDelay;
	}

	struct ReportStatus {
		uint128 currentAmount1;
		uint128 currentAmount2;
		address payable currentReporter;
		uint48 reportTimestamp;
		uint48 settlementTimestamp;
		address payable initialReporter;
		uint48 lastReportOppoTime;
	}

	struct CreateReportParams {
		uint128 exactToken1Report; // initial oracle liquidity in token1
		uint128 escalationHalt; // amount of token1 at which escalation stops but disputes can still happen
		uint96 settlerReward; // eth paid to settler in wei
		address token1Address; // address of token1 in the oracle report instance
		uint48 settlementTime; // report instance can settle if no disputes within this timeframe
		uint24 disputeDelay; // time disputes must wait after every new report
		uint24 protocolFee; // fee paid to protocolFeeRecipient. 1000 = 0.01%
		address token2Address; // address of token2 in the oracle report instance
		uint32 callbackGasLimit; // gas the settlement callback must use
		uint24 feePercentage; // fee paid to previous reporter. 1000 = 0.01%
		uint16 multiplier; // amount by which newAmount1 must increase versus old amount1. 140 = 1.4x. 100 = no escalation.
		bool timeType; // true for block timestamp, false for block number
		bool trackDisputes; // true keeps a readable dispute history for smart contracts
		address callbackContract; // contract address for settle to call back into
		address protocolFeeRecipient; // address that receives protocol fees and initial reporter rewards if keepFee set to false
	}

	// Events
	event ReportInstanceCreated(
		uint256 indexed reportId,
		address indexed token1Address,
		address indexed token2Address,
		address creator,
		address protocolFeeRecipient,
		uint128 exactToken1Report,
		uint128 escalationHalt,
		uint96 settlerReward,
		uint96 reporterFee,
		uint48 settlementTime,
		uint24 disputeDelay,
		uint24 feePercentage,
		uint24 protocolFee,
		uint16 multiplier,
		bool timeType,
		bool trackDisputes,
		address callbackContract,
		uint32 callbackGasLimit,
		bytes32 stateHash,
		uint256 blockTimestamp
	);

	event InitialReportSubmitted(
		uint256 indexed reportId,
		address indexed reporter,
		address indexed payer,
		uint128 amount1,
		uint128 amount2,
		uint48 reportTimestamp
	);

	event ReportDisputed(
		uint256 indexed reportId,
		address indexed disputer,
		address indexed tokenToSwap,
		address payer,
		uint128 newAmount1,
		uint128 newAmount2,
		uint48 reportTimestamp
	);

	event ReportSettled(
		uint256 indexed reportId,
		uint256 amount1,
		uint256 amount2,
		uint256 settlementTimestamp,
		uint256 blockTimestamp
	);
	event SettlementCallbackExecuted(uint256 indexed reportId, address indexed callbackContract, bool success);
	/// @notice Records token-denominated protocol fees credited as a withdrawable liability. `amount` uses the
	/// token's base units and `reason` identifies which dispute direction created the fee.
	event ProtocolFeeAccrued(
		uint256 indexed reportId,
		address indexed recipient,
		address indexed token,
		uint256 amount,
		FeeReason reason
	);
	/// @notice Records every attempted token reward or refund. A false `paid` value means `amount`, in token base
	/// units, was retained as a withdrawable liability for `recipient`.
	event TokenPayoutResult(
		uint256 indexed reportId,
		address indexed recipient,
		address indexed token,
		uint256 amount,
		bool paid,
		PayoutReason reason
	);
	/// @notice Records every attempted native-ETH reward. A false `paid` value means `amount`, in wei, was retained
	/// as a withdrawable liability for `recipient`.
	event EthPayoutResult(
		uint256 indexed reportId,
		address indexed recipient,
		uint256 amount,
		bool paid,
		PayoutReason reason
	);
	/// @notice A token-denominated liability was successfully withdrawn; `amount` uses token base units.
	event TokenFeesWithdrawn(address indexed recipient, address indexed token, uint256 amount);
	/// @notice A native-ETH liability was successfully withdrawn; `amount` uses wei.
	event EthFeesWithdrawn(address indexed recipient, uint256 amount);

	constructor() ReentrancyGuard() {}

	/**
	 * @notice Withdraws accumulated protocol fees for a specific token
	 * @param tokenToGet The token address to withdraw fees for
	 */
	function getProtocolFees(address tokenToGet) external {
		uint256 amount = protocolFees[msg.sender][tokenToGet];
		if (amount > 0) {
			protocolFees[msg.sender][tokenToGet] = 0;
			if (_transferTokens(tokenToGet, address(this), msg.sender, amount, 0, PayoutReason.ProtocolFeeWithdrawal)) {
				emit TokenFeesWithdrawn(msg.sender, tokenToGet, amount);
			}
		}
	}

	/**
	 * @notice Withdraws accumulated protocol fees in ETH
	 */
	function getETHProtocolFees() external nonReentrant returns (uint256) {
		uint256 amount = accruedProtocolFees[msg.sender];
		if (amount > 0) {
			accruedProtocolFees[msg.sender] = 0;
			(bool success, ) = payable(msg.sender).call{ value: amount }('');
			if (!success) revert('ETH transfer failed');
			emit EthFeesWithdrawn(msg.sender, amount);
			return amount;
		}
		return 0;
	}

	/**
	 * @notice Settles a report after the settlement time has elapsed
	 * @param reportId The unique identifier for the report to settle
	 */
	function settle(uint256 reportId) external nonReentrant {
		ReportStatus storage status = reportStatus[reportId];
		ReportMeta storage meta = reportMeta[reportId];

		if (status.settlementTimestamp != 0) revert('Already settled');

		if (meta.timeType) {
			if (block.timestamp < status.reportTimestamp + meta.settlementTime) revert('Settle too early');
		} else {
			if (_getBlockNumber() < status.reportTimestamp + meta.settlementTime) revert('Settle too early');
		}

		if (status.reportTimestamp == 0) revert('No report yet');

		uint256 settlerReward = meta.settlerReward;
		uint256 reporterReward = meta.fee;
		uint128 currentAmount1 = status.currentAmount1;
		uint128 currentAmount2 = status.currentAmount2;
		address payable currentReporter = status.currentReporter;
		address token1 = meta.token1;
		address token2 = meta.token2;

		status.settlementTimestamp = meta.timeType ? uint48(block.timestamp) : _getBlockNumber();
		emit ReportSettled(reportId, currentAmount1, currentAmount2, status.settlementTimestamp, block.timestamp);

		extraReportData storage extra = extraData[reportId];
		address callbackContract = extra.callbackContract;
		uint32 callbackGasLimit = extra.callbackGasLimit;

		_transferTokens(
			token1,
			address(this),
			currentReporter,
			currentAmount1,
			reportId,
			PayoutReason.SettlementPrincipal
		);
		_transferTokens(
			token2,
			address(this),
			currentReporter,
			currentAmount2,
			reportId,
			PayoutReason.SettlementPrincipal
		);

		if (callbackContract != address(0)) {
			// Prepare callback data
			bytes memory callbackData = abi.encodeWithSelector(
				CALLBACK_SELECTOR,
				reportId,
				currentAmount1,
				currentAmount2,
				status.settlementTimestamp,
				token1,
				token2
			);

			// Execute callback with gas limit. Revert if not enough gas supplied to attempt callback fully.
			// Using low-level call to handle failures gracefully

			(bool success, ) = callbackContract.call{ gas: callbackGasLimit }(callbackData);
			if (gasleft() < callbackGasLimit / 63) {
				revert('Invalid gas limit');
			}

			// Emit event regardless of bool success
			emit SettlementCallbackExecuted(reportId, callbackContract, success);
		}

		// other external calls below (check-effect-interaction pattern)
		_sendEth(status.initialReporter, reporterReward, reportId, PayoutReason.ReporterReward);
		_sendEth(payable(msg.sender), settlerReward, reportId, PayoutReason.SettlerReward);
	}

	/**
	 * @notice Gets the settlement data for a settled report
	 * @param reportId The unique identifier for the report
	 * @return price The settled price
	 * @return settlementTimestamp The timestamp when the report was settled
	 */
	function getSettlementData(uint256 reportId) external view returns (uint256 price, uint256 settlementTimestamp) {
		ReportStatus storage status = reportStatus[reportId];
		if (status.settlementTimestamp == 0) revert('Report not settled');
		return (Math.mulDiv(status.currentAmount1, PRICE_PRECISION, status.currentAmount2), status.settlementTimestamp);
	}

	/**
	 * @notice Creates a new report instance for price discovery. Hard-codes certain oracle parameters.
	 * @param token1Address Address of the first token
	 * @param token2Address Address of the second token
	 * @param exactToken1Report Exact amount of token1 required for the initial report
	 * @param feePercentage Fee in thousandths of basis points (3000 = 3bps)
	 * @param multiplier Multiplier in percentage points (110 = 1.1x)
	 * @param settlementTime Time in seconds before report can be settled
	 * @param escalationHalt Threshold at which multiplier drops to 100
	 * @param disputeDelay Delay in seconds before disputes are allowed
	 * @param protocolFee Protocol fee in thousandths of basis points
	 * @param settlerReward Reward for settling the report in wei
	 * @return reportId The unique identifier for the created report instance
	 */
	function createReportInstance(
		address token1Address,
		address token2Address,
		uint128 exactToken1Report,
		uint24 feePercentage,
		uint16 multiplier,
		uint48 settlementTime,
		uint128 escalationHalt,
		uint24 disputeDelay,
		uint24 protocolFee,
		uint96 settlerReward
	) external payable returns (uint256 reportId) {
		CreateReportParams memory params = CreateReportParams({
			token1Address: token1Address,
			token2Address: token2Address,
			exactToken1Report: exactToken1Report,
			feePercentage: feePercentage,
			multiplier: multiplier,
			settlementTime: settlementTime,
			escalationHalt: escalationHalt,
			disputeDelay: disputeDelay,
			protocolFee: protocolFee,
			settlerReward: settlerReward,
			timeType: true,
			callbackContract: address(0),
			trackDisputes: false,
			callbackGasLimit: 0,
			protocolFeeRecipient: msg.sender
		});
		return _createReportInstance(params);
	}

	/**
	 * @notice Creates a new report instance for price discovery.
	 * @param params Report creation parameters:
	 *   - token1Address: Address of the first token
	 *   - token2Address: Address of the second token
	 *   - exactToken1Report: Exact amount of token1 required for the initial report.
	 *   - feePercentage: Fee in thousandths of basis points (3000 = 0.03%)
	 *   - multiplier: Dispute amount1 multiplier in percentage points (110 = 1.1x). newAmount1 = oldAmount1 * multipier / 100
	 *   - settlementTime: Time before report can be settled
	 *   - escalationHalt: Threshold at which multiplier disappears and newAmount1 = oldAmount1 + 1
	 *   - disputeDelay: Delay in time before disputes are allowed
	 *   - protocolFee: Protocol fee in thousandths of basis points (3000 = 0.03%)
	 *   - settlerReward: Reward for settling the report in wei
	 *   - timeType: If true: time in seconds, if false: blocks
	 *   - callbackContract: Settle calls back into this address (callback signature is fixed: openOracleCallback(uint256 reportId, uint256 currentAmount1, uint256 currentAmount2, uint256 settlementTimestamp, address token1, address token2))
	 *   - trackDisputes: Optional dispute tracking for smart contracts
	 *   - callbackGasLimit: How much gas the callback must use. Must be safely < block gas limit or funds will be stuck
	 *   - protocolFeeRecipient: Address that receives accrued protocol fees & initial reporter reward if keepFee false
	 * @dev Initial reporter reward is msg.value in wei minus settlerReward
	 * @return reportId The unique identifier for the created report instance
	 */
	function createReportInstance(CreateReportParams calldata params) external payable returns (uint256 reportId) {
		return _createReportInstance(params);
	}

	function _createReportInstance(CreateReportParams memory params) internal returns (uint256 reportId) {
		if (params.exactToken1Report == 0) revert('Exact token1 zero');
		if (params.token1Address == params.token2Address) revert('Tokens equal');
		if (params.settlementTime < params.disputeDelay) revert('Settlement before dispute delay');

		if (msg.value < params.settlerReward) revert('Value too low');
		if (params.feePercentage + params.protocolFee > 1e7) revert('Fees too high');
		if (params.multiplier < MULTIPLIER_PRECISION) revert('Multiplier too low');

		reportId = nextReportId++;

		ReportMeta storage meta = reportMeta[reportId];
		meta.token1 = params.token1Address;
		meta.token2 = params.token2Address;
		meta.exactToken1Report = params.exactToken1Report;

		if (params.feePercentage > 0) meta.feePercentage = params.feePercentage;
		meta.multiplier = params.multiplier;
		meta.settlementTime = params.settlementTime;

		uint96 reporterFee;
		if (msg.value > params.settlerReward) {
			if (msg.value > type(uint96).max) revert('Value too high');
			reporterFee = uint96(msg.value) - params.settlerReward;
			meta.fee = reporterFee;
		}

		meta.escalationHalt = params.escalationHalt;

		if (params.disputeDelay > 0) meta.disputeDelay = params.disputeDelay;
		if (params.protocolFee > 0) meta.protocolFee = params.protocolFee;
		meta.settlerReward = params.settlerReward;
		meta.timeType = params.timeType;

		extraReportData storage extra = extraData[reportId];
		extra.callbackContract = params.callbackContract;
		if (params.trackDisputes == true) extra.trackDisputes = params.trackDisputes;
		extra.callbackGasLimit = params.callbackGasLimit;
		if (params.protocolFeeRecipient != address(0)) extra.protocolFeeRecipient = params.protocolFeeRecipient;

		bytes32 stateHash = keccak256(
			abi.encode(
				params.timeType,
				params.settlementTime,
				params.disputeDelay,
				params.callbackContract,
				params.callbackGasLimit,
				params.feePercentage,
				params.protocolFee,
				params.settlerReward,
				reporterFee,
				params.trackDisputes,
				params.multiplier,
				params.escalationHalt,
				params.protocolFeeRecipient,
				params.token1Address,
				params.token2Address,
				params.exactToken1Report,
				msg.sender,
				_getBlockNumber(),
				uint48(block.timestamp)
			)
		);

		extra.stateHash = stateHash;

		emit ReportInstanceCreated(
			reportId,
			params.token1Address,
			params.token2Address,
			msg.sender,
			params.protocolFeeRecipient,
			params.exactToken1Report,
			params.escalationHalt,
			params.settlerReward,
			reporterFee,
			params.settlementTime,
			params.disputeDelay,
			params.feePercentage,
			params.protocolFee,
			params.multiplier,
			params.timeType,
			params.trackDisputes,
			params.callbackContract,
			params.callbackGasLimit,
			stateHash,
			block.timestamp
		);

		return reportId;
	}

	/**
	 * @notice Submits the initial price report for a given report ID. Amounts use smallest unit for a given ERC-20.
	 * @param reportId The unique identifier for the report
	 * @param amount1 Amount of token1 (must equal exactToken1Report)
	 * @param amount2 Choose the amount of token2 that equals amount1 in value
	 * @dev Tokens are pulled from msg.sender and will be returned to msg.sender when settled or disputed
	 */
	function submitInitialReport(uint256 reportId, uint128 amount1, uint128 amount2, bytes32 stateHash) external {
		_submitInitialReport(reportId, amount1, amount2, stateHash, msg.sender);
	}

	/**
	 * @notice Submits the initial price report with a custom reporter address. Amounts use smallest unit for a given ERC-20.
	 * @param reportId The unique identifier for the report
	 * @param amount1 Amount of token1 (must equal exactToken1Report)
	 * @param amount2 Choose the amount of token2 that equals amount1 in value
	 * @param reporter The address that will receive tokens back when settled or disputed
	 * @dev Tokens are pulled from msg.sender but will be returned to reporter address
	 * @dev This overload enables contracts to submit reports on behalf of users
	 */
	function submitInitialReport(
		uint256 reportId,
		uint128 amount1,
		uint128 amount2,
		bytes32 stateHash,
		address reporter
	) external {
		_submitInitialReport(reportId, amount1, amount2, stateHash, reporter);
	}

	function _submitInitialReport(
		uint256 reportId,
		uint128 amount1,
		uint128 amount2,
		bytes32 stateHash,
		address reporter
	) internal {
		if (reportStatus[reportId].currentReporter != address(0)) {
			revert('Report already submitted');
		}

		ReportMeta storage meta = reportMeta[reportId];
		ReportStatus storage status = reportStatus[reportId];
		extraReportData storage extra = extraData[reportId];
		bool trackDisputes = extra.trackDisputes;

		if (reportId >= nextReportId) revert('Invalid report ID');
		if (amount1 != meta.exactToken1Report) revert('Invalid amount1');
		if (amount2 == 0) revert('Invalid amount2');
		if (extra.stateHash != stateHash) revert('Invalid state hash');
		if (reporter == address(0) || reporter == address(this)) revert('Invalid reporter');

		_transferTokens(meta.token1, msg.sender, address(this), amount1, reportId, PayoutReason.SettlementPrincipal);
		_transferTokens(meta.token2, msg.sender, address(this), amount2, reportId, PayoutReason.SettlementPrincipal);

		uint48 reportTimestamp = meta.timeType ? uint48(block.timestamp) : _getBlockNumber();
		status.currentAmount1 = amount1;
		status.currentAmount2 = amount2;
		status.currentReporter = payable(reporter);
		status.initialReporter = payable(reporter);
		status.reportTimestamp = reportTimestamp;
		status.lastReportOppoTime = meta.timeType ? _getBlockNumber() : uint48(block.timestamp);

		if (trackDisputes) {
			disputeRecord storage initialRecord = disputeHistory[reportId][0];
			initialRecord.amount1 = amount1;
			initialRecord.amount2 = amount2;
			initialRecord.reportTimestamp = reportTimestamp;
			extra.numReports = 1;
		}

		emit InitialReportSubmitted(reportId, reporter, msg.sender, amount1, amount2, reportTimestamp);
	}

	/**
	 * @notice Disputes an existing report. Amounts use smallest unit for a given ERC-20.
	 * @param reportId The unique identifier for the report instance to dispute
	 * @param tokenToSwap Token being swapped (token1 or token2). Disputer should choose token whose amount is lower valued
	 * @param newAmount1 New amount of token1 after the dispute. Must respect contract escalation rules
	 * @param newAmount2 New amount of token2 after the dispute. Choose the amount of token2 that equals newAmount1 in value
	 * @param amt2Expected currentAmount2 of the report instance you are disputing (not newAmount2)
	 * @param stateHash state hash of the report instance you are disputing
	 * @dev Tokens are pulled from msg.sender and will be returned to msg.sender when settled or disputed
	 */
	function disputeAndSwap(
		uint256 reportId,
		address tokenToSwap,
		uint128 newAmount1,
		uint128 newAmount2,
		uint128 amt2Expected,
		bytes32 stateHash
	) external nonReentrant {
		_disputeAndSwap(reportId, tokenToSwap, newAmount1, newAmount2, msg.sender, amt2Expected, stateHash);
	}

	/**
	 * @notice Disputes an existing report with a custom disputer address. Amounts use smallest unit for a given ERC-20.
	 * @param reportId The unique identifier for the report instance to dispute
	 * @param tokenToSwap Token being swapped (token1 or token2). Disputer should choose token whose amount is lower valued
	 * @param newAmount1 New amount of token1 after the dispute. Must respect contract escalation rules
	 * @param newAmount2 New amount of token2 after the dispute. Choose the amount of token2 that equals newAmount1 in value
	 * @param disputer The address that will receive tokens back when settled or disputed
	 * @param amt2Expected currentAmount2 of the report instance you are disputing (not newAmount2)
	 * @param stateHash state hash of the report instance you are disputing
	 * @dev Tokens are pulled from msg.sender but will be returned to disputer address
	 * @dev This overload enables contracts to submit disputes on behalf of users
	 */
	function disputeAndSwap(
		uint256 reportId,
		address tokenToSwap,
		uint128 newAmount1,
		uint128 newAmount2,
		address disputer,
		uint128 amt2Expected,
		bytes32 stateHash
	) external nonReentrant {
		_disputeAndSwap(reportId, tokenToSwap, newAmount1, newAmount2, disputer, amt2Expected, stateHash);
	}

	function _disputeAndSwap(
		uint256 reportId,
		address tokenToSwap,
		uint128 newAmount1,
		uint128 newAmount2,
		address disputer,
		uint128 amt2Expected,
		bytes32 stateHash
	) internal {
		ReportMeta storage meta = reportMeta[reportId];
		ReportStatus storage status = reportStatus[reportId];
		extraReportData storage extra = extraData[reportId];

		_preValidate(newAmount1, status.currentAmount1, meta.multiplier, meta.escalationHalt);

		_validateDispute(reportId, tokenToSwap, newAmount1, newAmount2, meta, status);
		if (status.currentAmount2 != amt2Expected) revert('Unexpected amount2');
		if (stateHash != extra.stateHash) revert('Invalid state hash');
		if (disputer == address(0) || disputer == address(this)) revert('Invalid disputer');

		bool trackDisputes = extra.trackDisputes;
		if (tokenToSwap == meta.token1) {
			_handleToken1Swap(reportId, meta, status, newAmount2, disputer, extra.protocolFeeRecipient, newAmount1);
		} else if (tokenToSwap == meta.token2) {
			_handleToken2Swap(reportId, meta, status, newAmount2, extra.protocolFeeRecipient, newAmount1);
		} else {
			revert('Invalid swap token');
		}

		// Update the report status after the dispute and swap
		{
			uint48 reportTimestamp = meta.timeType ? uint48(block.timestamp) : _getBlockNumber();
			status.currentAmount1 = newAmount1;
			status.currentAmount2 = newAmount2;
			status.currentReporter = payable(disputer);
			status.reportTimestamp = reportTimestamp;
			status.lastReportOppoTime = meta.timeType ? _getBlockNumber() : uint48(block.timestamp);

			if (trackDisputes) {
				uint32 nextIndex = extra.numReports;
				disputeRecord storage record = disputeHistory[reportId][nextIndex];
				record.amount1 = newAmount1;
				record.amount2 = newAmount2;
				record.reportTimestamp = reportTimestamp;
				record.tokenToSwap = tokenToSwap;
				extra.numReports = nextIndex + 1;
			}
		}

		emit ReportDisputed(
			reportId,
			disputer,
			tokenToSwap,
			msg.sender,
			newAmount1,
			newAmount2,
			status.reportTimestamp
		);
	}

	function _preValidate(
		uint256 newAmount1,
		uint256 oldAmount1,
		uint256 multiplier,
		uint256 escalationHalt
	) internal pure {
		uint256 expectedAmount1;

		if (escalationHalt > oldAmount1) {
			expectedAmount1 = (oldAmount1 * multiplier) / MULTIPLIER_PRECISION;
			if (expectedAmount1 > escalationHalt) {
				expectedAmount1 = escalationHalt;
			}
		} else {
			expectedAmount1 = oldAmount1 + 1;
		}

		if (newAmount1 != expectedAmount1) {
			if (escalationHalt <= oldAmount1) {
				revert('Escalation halted');
			} else {
				revert('Invalid amount1');
			}
		}
	}

	/**
	 * @dev Validates that a dispute is valid according to the oracle rules
	 */
	function _validateDispute(
		uint256 reportId,
		address tokenToSwap,
		uint256 newAmount1,
		uint256 newAmount2,
		ReportMeta storage meta,
		ReportStatus storage status
	) internal view {
		if (reportId >= nextReportId) revert('Invalid report ID');
		if (newAmount1 == 0 || newAmount2 == 0) revert('Amounts zero');
		if (status.currentReporter == address(0)) revert('No report to dispute');
		if (meta.timeType) {
			if (block.timestamp > status.reportTimestamp + meta.settlementTime) revert('Dispute too late');
		} else {
			if (_getBlockNumber() > status.reportTimestamp + meta.settlementTime) revert('Dispute too late');
		}
		if (status.settlementTimestamp != 0) revert('Already settled');
		if (tokenToSwap != meta.token1 && tokenToSwap != meta.token2) revert('Invalid swap token');
		if (meta.timeType) {
			if (block.timestamp < status.reportTimestamp + meta.disputeDelay) revert('Dispute too early');
		} else {
			if (_getBlockNumber() < status.reportTimestamp + meta.disputeDelay) revert('Dispute too early');
		}

		uint256 feeSum = uint256(meta.feePercentage) + uint256(meta.protocolFee);
		if (feeSum > 0) {
			uint256 oldAmount1 = status.currentAmount1;
			uint256 oldPrice = Math.mulDiv(oldAmount1, PRICE_PRECISION, status.currentAmount2);
			uint256 feeBoundary = Math.mulDiv(oldPrice, feeSum, PERCENTAGE_PRECISION);
			uint256 lowerBoundary = Math.mulDiv(oldPrice, PERCENTAGE_PRECISION, PERCENTAGE_PRECISION + feeSum);
			uint256 upperBoundary = oldPrice + feeBoundary;
			uint256 newPrice = Math.mulDiv(newAmount1, PRICE_PRECISION, newAmount2);

			if (newPrice >= lowerBoundary && newPrice <= upperBoundary) {
				revert('Price inside fee boundary');
			}
		}
	}

	/**
	 * @dev Handles token swaps when token1 is being swapped during a dispute
	 */
	function _handleToken1Swap(
		uint256 reportId,
		ReportMeta storage meta,
		ReportStatus storage status,
		uint256 newAmount2,
		address disputer,
		address protocolFeeRecipient,
		uint256 newAmount1
	) internal {
		uint256 oldAmount1 = status.currentAmount1;
		uint256 oldAmount2 = status.currentAmount2;
		address token1 = meta.token1;
		address token2 = meta.token2;
		uint256 fee = (oldAmount1 * meta.feePercentage) / PERCENTAGE_PRECISION;
		uint256 protocolFee = (oldAmount1 * meta.protocolFee) / PERCENTAGE_PRECISION;

		if (protocolFee > 0) {
			protocolFees[protocolFeeRecipient][token1] += protocolFee;
			emit ProtocolFeeAccrued(reportId, protocolFeeRecipient, token1, protocolFee, FeeReason.Token1Dispute);
		}

		uint256 requiredToken1Contribution = newAmount1;

		uint256 netToken2Contribution = newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0;
		uint256 netToken2Receive = newAmount2 < oldAmount2 ? oldAmount2 - newAmount2 : 0;

		if (netToken2Contribution > 0) {
			IERC20(token2).safeTransferFrom(msg.sender, address(this), netToken2Contribution);
		}

		if (netToken2Receive > 0) {
			_transferTokens(token2, address(this), disputer, netToken2Receive, reportId, PayoutReason.DisputePayout);
		}

		IERC20(token1).safeTransferFrom(
			msg.sender,
			address(this),
			requiredToken1Contribution + oldAmount1 + fee + protocolFee
		);

		_transferTokens(
			token1,
			address(this),
			status.currentReporter,
			2 * oldAmount1 + fee,
			reportId,
			PayoutReason.DisputePayout
		);
	}

	/**
	 * @dev Handles token swaps when token2 is being swapped during a dispute
	 */
	function _handleToken2Swap(
		uint256 reportId,
		ReportMeta storage meta,
		ReportStatus storage status,
		uint256 newAmount2,
		address protocolFeeRecipient,
		uint256 newAmount1
	) internal {
		uint256 oldAmount1 = status.currentAmount1;
		uint256 oldAmount2 = status.currentAmount2;
		address token1 = meta.token1;
		address token2 = meta.token2;
		uint256 fee = (oldAmount2 * meta.feePercentage) / PERCENTAGE_PRECISION;
		uint256 protocolFee = (oldAmount2 * meta.protocolFee) / PERCENTAGE_PRECISION;

		if (protocolFee > 0) {
			protocolFees[protocolFeeRecipient][token2] += protocolFee;
			emit ProtocolFeeAccrued(reportId, protocolFeeRecipient, token2, protocolFee, FeeReason.Token2Dispute);
		}

		uint256 requiredToken1Contribution = newAmount1;

		uint256 netToken1Contribution =
			requiredToken1Contribution > (oldAmount1) ? requiredToken1Contribution - (oldAmount1) : 0;

		if (netToken1Contribution > 0) {
			IERC20(token1).safeTransferFrom(msg.sender, address(this), netToken1Contribution);
		}

		IERC20(token2).safeTransferFrom(msg.sender, address(this), newAmount2 + oldAmount2 + fee + protocolFee);

		_transferTokens(
			token2,
			address(this),
			status.currentReporter,
			2 * oldAmount2 + fee,
			reportId,
			PayoutReason.DisputePayout
		);
	}

	/**
	 * @dev Internal function to handle token transfers
	 */
	function _transferTokens(
		address token,
		address from,
		address to,
		uint256 amount,
		uint256 reportId,
		PayoutReason reason
	) internal returns (bool paid) {
		if (amount == 0) return true;

		if (from == address(this)) {
			(bool success, bytes memory returndata) = token.call(
				abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
			);

			if (
				success &&
				((returndata.length > 0 && abi.decode(returndata, (bool))) ||
					(returndata.length == 0 && address(token).code.length > 0))
			) {
				emit TokenPayoutResult(reportId, to, token, amount, true, reason);
				return true;
			}

			protocolFees[to][token] += amount;
			emit TokenPayoutResult(reportId, to, token, amount, false, reason);
			return false;
		} else {
			IERC20(token).safeTransferFrom(from, to, amount);
			return true;
		}
	}

	/**
	 * @dev Internal function to send ETH to a recipient
	 */
	function _sendEth(address payable recipient, uint256 amount, uint256 reportId, PayoutReason reason) internal {
		if (amount == 0) return;

		(bool success, ) = recipient.call{ value: amount, gas: 40000 }('');
		if (!success) {
			accruedProtocolFees[recipient] += amount;
		}
		emit EthPayoutResult(reportId, recipient, amount, success, reason);
	}

	/**
	 * @dev Gets the current block number (returns L1 block number for L1 deployment)
	 */
	function _getBlockNumber() internal view returns (uint48) {
		return uint48(block.number);
	}
}
