// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { Errors } from './libraries/Errors.sol';
import { ISignatureTransfer } from './interfaces/ISignatureTransfer.sol';

/**
 * @title openOracle
 * @notice A trust-minimized token price oracle
 * @dev A price report is two limit orders, a buy and a sell, at the same price.
 *      The orders are locked until either the timer runs out or one is taken.
 *      To take one of the limit orders, you replace them with larger ones at a new price.
 *      When the timer runs out without a dispute, the price is settled. Any disputes reset the timer.
 *
 *      Participants are responsible for validating oracle game parameters before participation
 *      and unsafe parameter sets including but not limited to settlementTime too high and callbackGasLimit too high
 *      will result in lost funds.
 *
 *      Vanilla ERC20, USDC, and USDT-style return value tokens only.
 *      Fee-on-transfer, rebasing tokens etc are explicitly not supported.
 * @author OpenOracle Team
 * @custom:version 0.2.0
 * @custom:documentation https://docs.openoracle.org
 */
contract OpenOracle {
	using SafeERC20 for IERC20;

	// Constants
	uint256 internal constant PRICE_PRECISION = 1e30;
	uint256 internal constant PERCENTAGE_PRECISION = 1e7;
	uint256 internal constant MULTIPLIER_PRECISION = 100;
	address internal constant ETH_SENTINEL = address(0);
	address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
	uint8 internal constant FLAGS_MAX = 0x0F; // FLAG_TIME_TYPE | FLAG_TRACK_DISPUTES | FLAG_STORE_ALL | FLAG_STORE_PRICE

	bytes32 internal constant WITNESS_TYPEHASH = keccak256(
		'Witness(address beneficiary,address relayer,address swapper,bytes32 intent)'
	);
	string internal constant WITNESS_TYPE_STRING =
		'Witness witness)TokenPermissions(address token,uint256 amount)Witness(address beneficiary,address relayer,address swapper,bytes32 intent)';

	uint8 internal constant FLAG_TIME_TYPE = 1 << 0; // = 1
	uint8 internal constant FLAG_TRACK_DISPUTES = 1 << 1; // = 2
	uint8 internal constant FLAG_STORE_ALL = 1 << 2; // = 4
	uint8 internal constant FLAG_STORE_PRICE = 1 << 3; // = 8

	bytes4 internal constant CALLBACK_SELECTOR = bytes4(
		keccak256('openOracleCallback(uint256,uint256,uint256,uint256,address,address)')
	);

	uint256 public nextReportId = 1;

	mapping(uint256 => bytes32) public oracleGame; // reportId => state hash
	mapping(uint256 => uint256) public finalPrice;
	mapping(address => mapping(address => uint256)) public tokenHolder; // owner => token => amount
	mapping(uint256 => mapping(uint256 => DisputeRecord)) public disputeHistory; // reportId => numReports => dispute data
	mapping(uint256 => OracleGame) public storedGame; // reportId => optional storage
	mapping(uint256 => StoredHelper) public storedHelper; // reportId => optional stored helper
	mapping(address => mapping(address => mapping(address => uint256))) public internalAllowance; // owner => spender => token => amount

	struct DisputeRecord {
		uint128 amount1;
		uint128 amount2;
		uint128 baseFee;
		uint48 reportTimestamp;
	}

	struct OracleGame {
		uint128 currentAmount1; // current amount of token1 in the report
		uint128 currentAmount2; // current amount of token2 in the report
		address currentReporter;
		uint48 reportTimestamp; // time of last report or dispute. respects timeType
		uint48 settlementTimestamp; // when the game settled. respects timeType
		address token1;
		uint48 lastReportOppoTime; // opposite time. respects timeType
		uint48 settlementTime; // per-round timer. respects timeType
		uint128 escalationHalt; // point at which disputes can continue but amounts stop growing.
		address protocolFeeRecipient; // receives per-round protocolFee
		uint96 settlerReward; // wei paid to settler
		address token2;
		uint24 numReports;
		uint24 disputeDelay; // time after report where nobody can swap against the limit orders. respects timeType.
		uint24 feePercentage; //1000 = 0.01%, portion per swap going to previous reporter
		uint16 multiplier; // 140 = 1.4x, how much currentAmount1 must grow by each round
		address callbackContract; // settlement callback calls into this address
		uint32 callbackGasLimit; // Gas forwarded to settlement callback. Values above practical tx gas limits can make settlement impossible,
		// leaving the current reporter's two-sided limit-order amounts locked. Every disputer inherits this parameter.
		uint24 protocolFee; // 1000 = 0.01%, portion per swap going to protocolFeeRecipient
		uint8 flags; // see flags above. timeType true means the game's clock uses timestamps, false, block numbers.
	}

	struct PreimageHelper {
		uint256 reportId;
		address creator;
		uint256 blockTimestamp;
		uint256 blockNumber;
	}

	struct StoredHelper {
		address creator;
		uint48 blockTimestamp;
		uint48 blockNumber;
	}

	struct TimingBoundaries {
		uint256 blockNumber;
		uint256 blockNumberBound;
		uint256 blockTimestamp;
		uint256 blockTimestampBound;
	}

	// Events

	bytes32 private constant REPORT_SUBMITTED_SIG = keccak256('ReportSubmitted(uint256,bytes)');
	bytes32 private constant REPORT_DISPUTED_SIG = keccak256('ReportDisputed(uint256,bytes)');

	// Emitted via raw log2. `packed` is 235 raw bytes from _packMem,
	// not ABI-encoded dynamic bytes.
	event ReportSubmitted(uint256 indexed reportId, bytes packed);
	event ReportDisputed(uint256 indexed reportId, bytes packed);
	event ReportSettled(uint256 indexed reportId);
	event InternalApproval(address indexed owner, address indexed spender, address indexed token, uint256 amount);

	/**
	 * @notice Creates a price report. Caller must pass reportTimestamp / lastReportOppoTime /
	 *         settlementTimestamp / numReports as zero.
	 * @dev Only the keccak256 state hash is stored on-chain. All future callers
	 *      (dispute, settle) must supply the exact OracleGame + PreimageHelper that
	 *      reconstructs the current hash; off-chain indexing of report state is the
	 *      caller's responsibility (events + tx data, or via the FLAG_STORE_ALL opt-in).
	 * @param params OracleGame to commit. currentReporter decides who receives the report tokens when the round completes
	 * @param tryInternalBalance1 If true, fund token1 from params.currentReporter's internal balance first
	 * @param tryInternalBalance2 If true, fund token2 from params.currentReporter's internal balance first
	 * @param timing Optional timing bounds. If timing.blockTimestamp is zero, timing validation is skipped
	 * @return reportId The unique identifier for the created report instance
	 */
	function report(
		OracleGame calldata params,
		bool tryInternalBalance1,
		bool tryInternalBalance2,
		TimingBoundaries calldata timing
	) external payable returns (uint256 reportId) {
		if (params.flags > FLAGS_MAX) revert Errors.InvalidMode();
		bool timeType = _hasFlag(params.flags, FLAG_TIME_TYPE);
		uint48 blockNumber = _getBlockNumber();
		uint48 reportTimestamp = timeType ? uint48(block.timestamp) : blockNumber;
		uint48 oppoTime = timeType ? blockNumber : uint48(block.timestamp);
		address token1 = params.token1;
		address token2 = params.token2;
		address protocolFeeRecipient = params.protocolFeeRecipient;
		uint128 amount1 = params.currentAmount1;
		uint128 amount2 = params.currentAmount2;
		address reporter = params.currentReporter;

		if (amount1 == 0) revert Errors.InvalidAmount1();
		if (token1 == token2) revert Errors.TokensCannotBeSame();
		if (params.settlementTime <= params.disputeDelay) revert Errors.SettleVsDisputeDelayTiming();
		if (params.feePercentage + params.protocolFee > 1e7) revert Errors.FeesTooHigh();
		if (params.multiplier < MULTIPLIER_PRECISION) revert Errors.MultiplierTooLow();
		if (timing.blockTimestamp > 0) _validateTiming(timing);
		if (amount2 == 0) revert Errors.InvalidAmount2();
		if (reporter == address(0)) revert Errors.AddressCannotBeZero();
		if (msg.value > params.settlerReward && token1 != ETH_SENTINEL && token2 != ETH_SENTINEL) {
			revert Errors.NeitherTokenIsETH();
		}
		if (params.settlementTimestamp != 0) revert Errors.TimestampsMustBeZero();
		if (params.numReports != 0) revert Errors.NumReportsMustBeZero();
		if (params.reportTimestamp != 0 || params.lastReportOppoTime != 0) revert Errors.TimestampsMustBeZero();

		reportId = nextReportId++;

		bool trackDisputes = _hasFlag(params.flags, FLAG_TRACK_DISPUTES);
		if (trackDisputes) {
			DisputeRecord storage initialRecord = disputeHistory[reportId][0];
			initialRecord.amount1 = amount1;
			initialRecord.amount2 = amount2;
			initialRecord.baseFee = uint128(block.basefee);
			initialRecord.reportTimestamp = reportTimestamp;
		}

		// Force typed calldata loads for fields only used by later dispute/settle paths.
		// The raw calldata hash below relies on dirty-calldata regression tests for the
		// exact deployment compiler/optimizer/EVM target.
		uint128 escalationHalt = params.escalationHalt;
		address callbackContract = params.callbackContract;
		uint32 callbackGasLimit = params.callbackGasLimit;

		PreimageHelper memory helper = PreimageHelper({
			reportId: reportId,
			creator: msg.sender,
			blockTimestamp: block.timestamp,
			blockNumber: blockNumber
		});

		// Hash via calldatacopy + override mstores + mcopy(helper). Layout matches abi.encode(OracleGame, PreimageHelper):
		//   0x000..0x280  OracleGame (20 slots)        0x280..0x300  PreimageHelper (4 slots)
		// Overrides (slot N at N*0x20): 0x060 reportTimestamp · 0x0C0 lastReportOppoTime · 0x180 numReports (if trackDisputes)
		bytes32 stateHash;
		uint256 stagedMem;
		OracleGame memory staged;
		assembly ('memory-safe') {
			let mem := mload(0x40)
			calldatacopy(mem, params, 0x280)
			pop(escalationHalt)
			pop(callbackContract)
			pop(callbackGasLimit)
			mstore(add(mem, 0x60), reportTimestamp)
			mstore(add(mem, 0xC0), oppoTime)
			if trackDisputes {
				mstore(add(mem, 0x180), 1)
			}
			mcopy(add(mem, 0x280), helper, 0x80)
			stateHash := keccak256(mem, 0x300)
			staged := mem
			stagedMem := mem
			mstore(0x40, add(mem, 0x300))
		}

		oracleGame[reportId] = stateHash;
		if (_hasFlag(params.flags, FLAG_STORE_ALL)) {
			storedGame[reportId] = staged;
			storedHelper[reportId] = StoredHelper({
				creator: helper.creator,
				blockTimestamp: uint48(helper.blockTimestamp),
				blockNumber: uint48(helper.blockNumber)
			});
		}

		if (params.protocolFee > 0 && protocolFeeRecipient != address(0)) {
			_getDustAmounts(protocolFeeRecipient, token1, token2);
		}

		_getDustAmounts(reporter, token1, token2);

		uint256 ethRequired = params.settlerReward;
		ethRequired += _tryInternalBalanceFull(reporter, token1, amount1, tryInternalBalance1);
		ethRequired += _tryInternalBalanceFull(reporter, token2, amount2, tryInternalBalance2);

		if (msg.value < ethRequired) revert Errors.MsgValueTooLow();
		uint256 excess = msg.value - ethRequired;
		if (excess > 0) _credit(reporter, ETH_SENTINEL, excess);

		uint256 packedLen = _packMem(stagedMem);
		bytes32 sig = REPORT_SUBMITTED_SIG;
		assembly ('memory-safe') {
			log2(stagedMem, packedLen, sig, reportId)
		}
	}

	/**
	 * @notice Swaps against and replaces the current report with new amounts.
	 * @dev For delegated disputes where msg.sender != disputer, set both tryInternalBalance flags
	 *      true when the disputer is intended to fund via approveInternal; any false flag makes
	 *      that token's required contribution come from msg.sender externally.
	 * @param reportId The report instance to dispute
	 * @param newAmount1 New token1 amount; must equal oldAmount1 * multiplier / 100 unless at escalationHalt where it must equal oldAmount1 + 1
	 * @param newAmount2 New token2 amount proposed by the disputer. Ratio of newAmount1 and newAmount2 is the new price disputer is quoting.
	 * @param disputer Address recorded as the new currentReporter, credited for any ETH excess. Also receives tokens back when the round completes.
	 * @param tryInternalBalance1 If true, draw token1 contributions from disputer's internal balance before pulling externally
	 * @param tryInternalBalance2 If true, draw token2 contributions from disputer's internal balance before pulling externally
	 * @param params OracleGame matching the current stored state hash
	 * @param helper PreimageHelper matching the current stored state hash
	 * @param timing Optional timing bounds; validation is skipped when timing.blockTimestamp is zero
	 */
	function dispute(
		uint256 reportId,
		uint128 newAmount1,
		uint128 newAmount2,
		address disputer,
		bool tryInternalBalance1,
		bool tryInternalBalance2,
		OracleGame calldata params,
		PreimageHelper calldata helper,
		TimingBoundaries calldata timing
	) external payable {
		OracleGame memory oracle;
		uint256 stagedMem;
		bytes32 preStateHash;
		assembly ('memory-safe') {
			stagedMem := mload(0x40)
			calldatacopy(stagedMem, params, 0x280)
			calldatacopy(add(stagedMem, 0x280), helper, 0x80)
			preStateHash := keccak256(stagedMem, 0x300)
			oracle := stagedMem
			mstore(0x40, add(stagedMem, 0x300))
		}

		if (preStateHash != oracleGame[reportId]) revert Errors.InvalidStateHash();

		(uint256 oldAmount1, uint256 oldAmount2) = (oracle.currentAmount1, oracle.currentAmount2);
		address token1 = oracle.token1;
		address token2 = oracle.token2;
		address previousReporter = oracle.currentReporter;
		bool timeType = _hasFlag(oracle.flags, FLAG_TIME_TYPE);
		uint48 blockNumber = _getBlockNumber();
		uint48 currentTime = timeType ? uint48(block.timestamp) : blockNumber;
		uint48 oppoTime = timeType ? blockNumber : uint48(block.timestamp);
		bool isSelfDispute = (disputer == previousReporter && msg.sender == previousReporter);

		{
			uint48 prevReportTimestamp = oracle.reportTimestamp;
			uint256 escalationHalt = oracle.escalationHalt;
			uint256 expectedAmount1;
			if (escalationHalt > oldAmount1) {
				expectedAmount1 = (oldAmount1 * oracle.multiplier) / MULTIPLIER_PRECISION;
				if (expectedAmount1 > escalationHalt) {
					expectedAmount1 = escalationHalt;
				}
			} else {
				expectedAmount1 = oldAmount1 + 1;
			}

			if (newAmount1 != expectedAmount1) {
				if (escalationHalt <= oldAmount1) {
					revert Errors.EscalationHalted();
				} else {
					revert Errors.InvalidAmount1();
				}
			}

			if (newAmount1 == 0 || newAmount2 == 0) revert Errors.AmountsCannotBeZero();
			if (previousReporter == address(0)) revert Errors.NoReportToDispute();
			if (currentTime >= prevReportTimestamp + oracle.settlementTime) revert Errors.DisputeTooLate();
			if (oracle.settlementTimestamp != 0) revert Errors.AlreadySettled();
			if (currentTime < prevReportTimestamp + oracle.disputeDelay) revert Errors.DisputeTooEarly();
			if (disputer == address(0)) revert Errors.AddressCannotBeZero();
			if (timing.blockTimestamp > 0) _validateTiming(timing);
			if (msg.value > 0 && token1 != ETH_SENTINEL && token2 != ETH_SENTINEL) revert Errors.NeitherTokenIsETH();
		}

		bool swapToken2 = uint256(newAmount2) * oldAmount1 > uint256(oldAmount2) * newAmount1;

		{
			oracle.currentAmount1 = newAmount1;
			oracle.currentAmount2 = newAmount2;
			oracle.currentReporter = disputer;
			oracle.reportTimestamp = currentTime;
			oracle.lastReportOppoTime = oppoTime;

			if (_hasFlag(oracle.flags, FLAG_TRACK_DISPUTES)) {
				uint24 nextIndex = oracle.numReports;
				DisputeRecord storage record = disputeHistory[reportId][nextIndex];
				record.amount1 = newAmount1;
				record.amount2 = newAmount2;
				record.reportTimestamp = currentTime;
				record.baseFee = uint128(block.basefee);
				if (nextIndex < type(uint24).max) oracle.numReports = nextIndex + 1;
			}

			bytes32 nextStateHash;
			assembly ('memory-safe') {
				nextStateHash := keccak256(stagedMem, 0x300)
			}
			oracleGame[reportId] = nextStateHash;
			if (_hasFlag(oracle.flags, FLAG_STORE_ALL)) {
				OracleGame storage stored = storedGame[reportId];
				stored.currentAmount1 = newAmount1;
				stored.currentAmount2 = newAmount2;
				stored.currentReporter = disputer;
				stored.reportTimestamp = currentTime;
				stored.lastReportOppoTime = oppoTime;
				if (_hasFlag(oracle.flags, FLAG_TRACK_DISPUTES)) {
					stored.numReports = oracle.numReports;
				}
			}
		}

		_getDustAmounts(disputer, token1, token2);

		uint256 ethRequired = 0;

		if (!swapToken2) {
			uint256 fee = (oldAmount1 * oracle.feePercentage) / PERCENTAGE_PRECISION;
			uint256 protocolFee = (oldAmount1 * oracle.protocolFee) / PERCENTAGE_PRECISION;
			uint256 netToken2Contribution = newAmount2 >= oldAmount2 ? newAmount2 - oldAmount2 : 0;
			uint256 netToken2Receive = newAmount2 < oldAmount2 ? oldAmount2 - newAmount2 : 0;

			if (protocolFee > 0 && oracle.protocolFeeRecipient != address(0)) {
				tokenHolder[oracle.protocolFeeRecipient][token1] += protocolFee;
			}

			if (netToken2Contribution > 0) {
				ethRequired += _tryInternalBalanceFull(disputer, token2, netToken2Contribution, tryInternalBalance2);
			}

			if (netToken2Receive > 0) {
				tokenHolder[disputer][token2] += netToken2Receive;
			}

			if (isSelfDispute) {
				uint256 token1Contribution = newAmount1 - oldAmount1 + protocolFee;
				ethRequired += _tryInternalBalanceFull(disputer, token1, token1Contribution, tryInternalBalance1);
			} else {
				ethRequired += _tryInternalBalanceFull(
					disputer,
					token1,
					newAmount1 + oldAmount1 + fee + protocolFee,
					tryInternalBalance1
				);

				tokenHolder[previousReporter][token1] += 2 * oldAmount1 + fee;
			}
		} else {
			uint256 fee = (oldAmount2 * oracle.feePercentage) / PERCENTAGE_PRECISION;
			uint256 protocolFee = (oldAmount2 * oracle.protocolFee) / PERCENTAGE_PRECISION;
			uint256 netToken1Contribution = newAmount1 > (oldAmount1) ? newAmount1 - oldAmount1 : 0;

			if (protocolFee > 0 && oracle.protocolFeeRecipient != address(0)) {
				tokenHolder[oracle.protocolFeeRecipient][token2] += protocolFee;
			}

			if (netToken1Contribution > 0) {
				ethRequired += _tryInternalBalanceFull(disputer, token1, netToken1Contribution, tryInternalBalance1);
			}

			if (isSelfDispute) {
				uint256 token2Needed = newAmount2 + protocolFee;

				if (token2Needed >= oldAmount2) {
					ethRequired += _tryInternalBalanceFull(
						disputer,
						token2,
						token2Needed - oldAmount2,
						tryInternalBalance2
					);
				} else {
					tokenHolder[disputer][token2] += oldAmount2 - token2Needed;
				}
			} else {
				ethRequired += _tryInternalBalanceFull(
					disputer,
					token2,
					newAmount2 + oldAmount2 + fee + protocolFee,
					tryInternalBalance2
				);
				tokenHolder[previousReporter][token2] += 2 * oldAmount2 + fee;
			}
		}

		if (msg.value < ethRequired) revert Errors.MsgValueTooLow();
		uint256 excess = msg.value - ethRequired;
		if (excess > 0) _credit(disputer, ETH_SENTINEL, excess);

		uint256 packedLen = _packMem(stagedMem);
		bytes32 sig = REPORT_DISPUTED_SIG;
		assembly ('memory-safe') {
			log2(stagedMem, packedLen, sig, reportId)
		}
	}

	/**
	 * @notice Settles a report after settlementTime has elapsed
	 * @param reportId The unique identifier for the report to settle
	 * @param params OracleGame matching the current stored state hash
	 * @param helper PreimageHelper matching the current stored state hash
	 */
	function settle(uint256 reportId, OracleGame calldata params, PreimageHelper calldata helper) external {
		OracleGame memory oracle;
		uint256 stagedMem;
		bytes32 preStateHash;
		assembly ('memory-safe') {
			stagedMem := mload(0x40)
			calldatacopy(stagedMem, params, 0x280)
			calldatacopy(add(stagedMem, 0x280), helper, 0x80)
			preStateHash := keccak256(stagedMem, 0x300)
			oracle := stagedMem
			mstore(0x40, add(stagedMem, 0x300))
		}

		if (preStateHash != oracleGame[reportId]) revert Errors.InvalidStateHash();

		uint256 settlementTimestamp = oracle.settlementTimestamp;
		if (settlementTimestamp != 0) revert Errors.AlreadySettled();

		uint256 settlementTime = oracle.settlementTime;
		uint256 reportTimestamp = oracle.reportTimestamp;
		bool timeType = _hasFlag(oracle.flags, FLAG_TIME_TYPE);
		uint256 currentTime = timeType ? block.timestamp : _getBlockNumber();
		uint256 settlerReward = oracle.settlerReward;
		uint128 currentAmount1 = oracle.currentAmount1;
		uint128 currentAmount2 = oracle.currentAmount2;
		address currentReporter = oracle.currentReporter;
		address token1 = oracle.token1;
		address token2 = oracle.token2;
		address callbackContract = oracle.callbackContract;
		uint32 callbackGasLimit = oracle.callbackGasLimit;
		address sender = msg.sender;
		bool hasCallback = callbackContract != address(0);
		bool storePrice = _hasFlag(oracle.flags, FLAG_STORE_PRICE);
		uint256 finalRatio;
		if (storePrice) finalRatio = (currentAmount1 * PRICE_PRECISION) / currentAmount2;

		if (currentTime < reportTimestamp + settlementTime) revert Errors.SettleTooEarly();
		if (reportTimestamp == 0) revert Errors.NoReportYet();

		oracle.settlementTimestamp = uint48(currentTime);

		bytes32 nextStateHash;
		assembly ('memory-safe') {
			nextStateHash := keccak256(stagedMem, 0x300)
		}
		oracleGame[reportId] = nextStateHash;

		if (storePrice) finalPrice[reportId] = finalRatio;
		if (_hasFlag(oracle.flags, FLAG_STORE_ALL)) storedGame[reportId] = oracle;

		tokenHolder[currentReporter][token1] += currentAmount1;
		tokenHolder[currentReporter][token2] += currentAmount2;
		if (settlerReward > 0) _credit(sender, ETH_SENTINEL, settlerReward);

		if (hasCallback) {
			bytes memory callbackData = abi.encodeWithSelector(
				CALLBACK_SELECTOR,
				reportId,
				currentAmount1,
				currentAmount2,
				currentTime,
				token1,
				token2
			);

			// Execute callback with gas limit. Revert if not enough gas supplied to attempt callback fully.
			(bool success, ) = callbackContract.call{ gas: callbackGasLimit }(callbackData);
			success; // silence unused-variable warning; callback success is intentionally ignored
			if (gasleft() < callbackGasLimit / 63) {
				revert Errors.InvalidGasLimit();
			}
		}

		emit ReportSettled(reportId);
	}

	function withdraw(address tokenToGet, uint256 amount) external returns (uint256 sent) {
		return _withdraw(tokenToGet, amount, msg.sender);
	}

	function withdrawTo(address tokenToGet, uint256 amount, address to) external returns (uint256 sent) {
		return _withdraw(tokenToGet, amount, to);
	}

	/**
	 * @notice Withdraws held tokens to `to`, preserving the virtual 1-unit sentinel.
	 *         If too high an amount is passed, sends available balance instead of reverting.
	 * @param tokenToGet The token address to withdraw
	 * @param amount Maximum amount to withdraw; if above available balance, withdraws available balance
	 * @param to Recipient of the withdrawn tokens
	 */
	function _withdraw(address tokenToGet, uint256 amount, address to) internal returns (uint256 sent) {
		if (to == address(0)) revert Errors.AddressCannotBeZero();
		uint256 balance = tokenHolder[msg.sender][tokenToGet];
		if (balance <= 1 || amount == 0) return 0;

		if (amount > balance - 1) amount = balance - 1;
		tokenHolder[msg.sender][tokenToGet] = balance - amount;
		sent = amount;

		if (tokenToGet == ETH_SENTINEL) {
			(bool success, ) = (to).call{ value: amount }('');
			if (!success) {
				revert Errors.EthTransferFailed();
			}
		} else {
			_transferTokens(tokenToGet, address(this), to, amount);
		}
	}

	/**
	 * @notice Initializes virtual token balance sentinels for a token pair.
	 * @dev Does not transfer tokens.
	 */
	function dust(address token1, address token2) external {
		_getDustAmounts(msg.sender, token1, token2);
	}

	function deposit(address token, uint128 amount, address beneficiary) external payable {
		if (beneficiary == address(0)) revert Errors.AddressCannotBeZero();
		if (token != ETH_SENTINEL && msg.value > 0) revert Errors.InvalidMsgValue();
		_credit(beneficiary, token, amount);

		if (token == ETH_SENTINEL) {
			if (msg.value != amount) revert Errors.InvalidMsgValue();
		} else {
			IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
		}
	}

	/**
	 * @notice Pulls `amount` of token from `from` via Permit2 (witness-bound) and credits `beneficiary`'s internal balance.
	 * @dev Witness binds (beneficiary, relayer = msg.sender, swapper = from, intent). The signer's sig is
	 *      only usable when the call is relayed by the intended relayer, credits the intended beneficiary,
	 *      attributes to the intended swapper, and matches the intended per-protocol intent hash.
	 */
	function depositFromPermit2(
		uint128 amount,
		address beneficiary,
		address from,
		bytes32 intent,
		ISignatureTransfer.PermitTransferFrom calldata permit,
		bytes calldata signature
	) external {
		if (beneficiary == address(0)) revert Errors.AddressCannotBeZero();
		if (permit.permitted.token == ETH_SENTINEL) revert Errors.InvalidToken();
		if (permit.permitted.token.code.length == 0) revert Errors.InvalidToken();
		if (permit.permitted.amount != amount) revert Errors.Permit2AmountMismatch();

		bytes32 witness = keccak256(abi.encode(WITNESS_TYPEHASH, beneficiary, msg.sender, from, intent));

		ISignatureTransfer(PERMIT2).permitWitnessTransferFrom(
			permit,
			ISignatureTransfer.SignatureTransferDetails({ to: address(this), requestedAmount: amount }),
			from,
			witness,
			WITNESS_TYPE_STRING,
			signature
		);

		_credit(beneficiary, permit.permitted.token, amount);
	}

	/**
	 * @notice Transfers `amount` of `token` from `from`'s internal balance to `to`'s internal balance.
	 * @dev When `from == msg.sender`, no allowance is required. Otherwise, spends from
	 *      `from`'s internal allowance to msg.sender. Preserves the 1-unit sentinel on `from`'s slot.
	 */
	function internalTransferFrom(address from, address to, address token, uint128 amount) external {
		if (to == address(0)) revert Errors.AddressCannotBeZero();
		if (amount == 0) return;

		if (from != msg.sender) {
			uint256 allowed = internalAllowance[from][msg.sender][token];
			if (allowed < amount) revert Errors.InsufficientInternalAllowance();
			if (allowed != type(uint256).max) {
				internalAllowance[from][msg.sender][token] = allowed - amount;
			}
		}

		uint256 bal = tokenHolder[from][token];
		if (bal <= amount) revert Errors.InsufficientInternalBalance();
		tokenHolder[from][token] = bal - amount;
		_credit(to, token, amount);
	}

	function pushOrCredit(address token, address to, uint128 amount) external {
		_pushOrCredit(token, to, amount, 50_000);
	}

	function pushOrCredit(address token, address to, uint128 amount, uint32 gasLimit) external {
		_pushOrCredit(token, to, amount, gasLimit);
	}

	/**
	 * @notice Debits caller's internal balance and pushes `amount` of `token` externally to `to`.
	 *         On push failure (ETH call revert / ERC20 non-standard return / ETH xfer OOG within `gasLimit`),
	 *         falls back to crediting `to`'s internal balance instead.
	 * @dev Caller's slot preserves the 1-unit sentinel.
	 */
	function _pushOrCredit(address token, address to, uint128 amount, uint32 gasLimit) internal {
		if (to == address(0)) revert Errors.AddressCannotBeZero();
		if (amount == 0) return;
		uint256 bal = tokenHolder[msg.sender][token];
		if (bal <= amount) revert Errors.InsufficientInternalBalance();
		tokenHolder[msg.sender][token] = bal - amount;

		if (token == ETH_SENTINEL) {
			(bool ok, ) = to.call{ value: amount, gas: gasLimit }('');
			if (!ok) _credit(to, token, amount);
		} else {
			(bool success, bytes memory returndata) = token.call(
				abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
			);
			bool ok =
				success &&
					((returndata.length > 0 && abi.decode(returndata, (bool))) ||
						(returndata.length == 0 && token.code.length > 0));
			if (!ok) _credit(to, token, amount);
		}
	}

	/**
	 * @notice Approves `spender` to spend caller's internal balance of `token`.
	 * @dev This allowance is only for balances tracked inside OpenOracle. `type(uint256).max`
	 *      is treated as infinite allowance and is not decremented. Setting `amount` to zero revokes.
	 *      A spender may use this through internalTransferFrom or delegated report/dispute
	 *      funding when the corresponding tryInternalBalance flag is true.
	 * @param spender Address allowed to spend caller's internal balance
	 * @param token Token address, or address(0) for internal ETH balance
	 * @param amount Allowance amount
	 */
	function approveInternal(address spender, address token, uint256 amount) external {
		if (spender == address(0)) revert Errors.AddressCannotBeZero();
		if (internalAllowance[msg.sender][spender][token] != 0 && amount != 0) revert Errors.NonZeroAllowance();
		internalAllowance[msg.sender][spender][token] = amount;
		emit InternalApproval(msg.sender, spender, token, amount);
	}

	/**
	 * @dev Internal function to handle token transfers
	 */
	function _transferTokens(address token, address from, address to, uint256 amount) internal {
		if (amount == 0) return; // Gas optimization: skip zero transfers

		if (from == address(this)) {
			IERC20(token).safeTransfer(to, amount);
		} else {
			IERC20(token).safeTransferFrom(from, to, amount);
		}
	}

	function _validateTiming(TimingBoundaries memory timing) internal view {
		uint256 timestamp = timing.blockTimestamp;
		uint256 timestampBound = timing.blockTimestampBound;
		uint256 blockNumber = timing.blockNumber;
		uint256 blockNumberBound = timing.blockNumberBound;
		uint256 currentBlockNumber = _getBlockNumber();
		if (block.timestamp + timestampBound < timestamp || block.timestamp > timestamp + timestampBound) {
			revert Errors.InvalidTiming();
		}
		if (
			currentBlockNumber + blockNumberBound < blockNumber || currentBlockNumber > blockNumber + blockNumberBound
		) {
			revert Errors.InvalidTiming();
		}
	}

	function _getDustAmounts(address reporter, address token1, address token2) internal {
		_dust(reporter, token1);
		_dust(reporter, token2);
	}

	function _dust(address user, address token) internal {
		if (tokenHolder[user][token] == 0) {
			tokenHolder[user][token] = 1;
		}
	}

	/**
	 * @dev Credit assets to a recipient's internal balance, seeding the virtual
	 *      sentinel on first credit.
	 */
	function _credit(address recipient, address token, uint256 amount) internal {
		uint256 bal = tokenHolder[recipient][token];
		tokenHolder[recipient][token] = bal == 0 ? amount + 1 : bal + amount;
	}

	function _tryInternalBalanceFull(
		address owner,
		address token,
		uint256 amount,
		bool tib
	) internal returns (uint256 ethNeeded) {
		uint256 fromInternal = 0;

		if (tib) {
			uint256 internalBalance = tokenHolder[owner][token];
			uint256 allowed;

			if (internalBalance > 1) {
				uint256 available = internalBalance - 1;
				fromInternal = available > amount ? amount : available;

				bool isNotOwner = (owner != msg.sender);
				if (isNotOwner) allowed = internalAllowance[owner][msg.sender][token];

				if (isNotOwner) {
					if (allowed < fromInternal) fromInternal = allowed;
				}

				if (fromInternal > 0) {
					tokenHolder[owner][token] = internalBalance - fromInternal;
					if (isNotOwner) {
						if (allowed != type(uint256).max) {
							internalAllowance[owner][msg.sender][token] = allowed - fromInternal;
						}
					}
				}
			}
		}

		// Strict delegation: if caller asked to fund from `owner`'s internal balance but the
		// available balance + allowance falls short, revert.
		if (tib && owner != msg.sender && fromInternal < amount) revert Errors.InsufficientInternalBalance();

		uint256 fromExternal = amount - fromInternal;

		if (token == ETH_SENTINEL) {
			return fromExternal; // ETH needed from msg.value
		}

		if (fromExternal > 0) {
			_transferTokens(token, msg.sender, address(this), fromExternal);
		}
		return 0;
	}

	function _getBlockNumber() internal view returns (uint48) {
		return uint48(block.number);
	}

	function _hasFlag(uint8 flags, uint8 mask) internal pure returns (bool) {
		return flags & mask != 0;
	}
	/**
	 * @dev Packs the canonical (OracleGame, PreimageHelper) memory buffer at `mem`
	 *      (laid out as abi.encode(OracleGame, PreimageHelper), 0x300 bytes) into a
	 *      tight 235-byte blob in place. Returns the packed length.
	 *
	 *      Layout assumptions:
	 *        mem[0x000 .. 0x280)  OracleGame  (20 slots)
	 *        mem[0x280 .. 0x300)  PreimageHelper (4 slots)
	 *
	 *      Read-before-write ordering is enforced by processing fields left-to-right
	 *      in slot order. For every packed offset P_N the corresponding source slot
	 *      offset 32*N satisfies P_N + 32 ≤ 32*(N+1), so a 32-byte mstore at P_N
	 *      cannot trample any unread source slot. The trailing bytes past the final
	 *      packed offset (235) are scratch and ignored by the log2 length.
	 */
	function _packMem(uint256 mem) internal pure returns (uint256 packedLen) {
		assembly ('memory-safe') {
			// OracleGame (20 slots → 203 bytes)
			mstore(mem, shl(128, mload(mem))) // currentAmount1   (W=16)
			mstore(add(mem, 16), shl(128, mload(add(mem, 0x20)))) // currentAmount2   (W=16)
			mstore(add(mem, 32), shl(96, mload(add(mem, 0x40)))) // currentReporter  (W=20)
			mstore(add(mem, 52), shl(208, mload(add(mem, 0x60)))) // reportTimestamp  (W=6)
			mstore(add(mem, 58), shl(208, mload(add(mem, 0x80)))) // settlementTimestamp (W=6)
			mstore(add(mem, 64), shl(96, mload(add(mem, 0xa0)))) // token1           (W=20)
			mstore(add(mem, 84), shl(208, mload(add(mem, 0xc0)))) // lastReportOppoTime  (W=6)
			mstore(add(mem, 90), shl(208, mload(add(mem, 0xe0)))) // settlementTime   (W=6)
			mstore(add(mem, 96), shl(128, mload(add(mem, 0x100)))) // escalationHalt   (W=16)
			mstore(add(mem, 112), shl(96, mload(add(mem, 0x120)))) // protocolFeeRecipient (W=20)
			mstore(add(mem, 132), shl(160, mload(add(mem, 0x140)))) // settlerReward    (W=12)
			mstore(add(mem, 144), shl(96, mload(add(mem, 0x160)))) // token2           (W=20)
			mstore(add(mem, 164), shl(232, mload(add(mem, 0x180)))) // numReports       (W=3)
			mstore(add(mem, 167), shl(232, mload(add(mem, 0x1a0)))) // disputeDelay     (W=3)
			mstore(add(mem, 170), shl(232, mload(add(mem, 0x1c0)))) // feePercentage    (W=3)
			mstore(add(mem, 173), shl(240, mload(add(mem, 0x1e0)))) // multiplier       (W=2)
			mstore(add(mem, 175), shl(96, mload(add(mem, 0x200)))) // callbackContract (W=20)
			mstore(add(mem, 195), shl(224, mload(add(mem, 0x220)))) // callbackGasLimit (W=4)
			mstore(add(mem, 199), shl(232, mload(add(mem, 0x240)))) // protocolFee      (W=3)
			mstore8(add(mem, 202), byte(31, mload(add(mem, 0x260)))) // flags            (W=1)

			// PreimageHelper (skip reportId at slot 20 — already topic1)
			mstore(add(mem, 203), shl(96, mload(add(mem, 0x2a0)))) // creator          (W=20)
			mstore(add(mem, 223), shl(208, mload(add(mem, 0x2c0)))) // blockTimestamp   (W=6 narrow)
			mstore(add(mem, 229), shl(208, mload(add(mem, 0x2e0)))) // blockNumber      (W=6 narrow)
		}
		packedLen = 235;
	}
}
