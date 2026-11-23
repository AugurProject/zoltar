// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { OraclePriceMath } from './OraclePriceMath.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { IERC20 } from '../IERC20.sol';
import { SecurityPoolBoundClones } from './SecurityPoolBoundClones.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { IReportOperations } from './interfaces/IReportOperations.sol';
import { IWeth9 } from './interfaces/IWeth9.sol';
import { IQuestionLedger, ISecurityPoolFactory } from './interfaces/IQuestionLedger.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SharedPoolReportEscrow } from './SharedPoolReportEscrow.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import './OpenOraclePriceCoordinatorTypes.sol';

interface ISharedPoolPriceCoordinator {
	function questionLedger() external view returns (IQuestionLedger);
	function reputationToken() external view returns (ReputationToken);
	function openOracle() external view returns (OpenOracle);
	function weth() external view returns (IWeth9);
	function initialReportPriorityFeeAttoEthPerGas() external view returns (uint256);
	function targetPriceErrorForDispute() external view returns (uint256);
	function settlementTime() external view returns (uint48);
	function disputeDelay() external view returns (uint24);
	function protocolFee() external view returns (uint24);
	function feePercentage() external view returns (uint24);
	function multiplier() external view returns (uint16);
	function protocolFeeRecipient() external view returns (address);
	function escalationHaltMultiplierBps() external view returns (uint256);
	function maxSettlementBaseFeeMultiplierBps() external view returns (uint256);
}

interface ISharedPoolSecurityPoolPriceCheckpoint {
	function onSharedPriceAccepted(uint248 universeId, uint256 price, uint48 validUntil) external;
	function capitalLedger(uint248 universeId) external view returns (IReportOperations);
	function oracleExposure(uint248 universeId) external view returns (uint256);
	function oracleRepExposure(uint248 universeId) external view returns (uint256);
	function isPriceReportingOpen(uint248 universeId) external view returns (bool);
}

/// @notice One REP/collateral report and freshness clock for all question ledgers in one pool and universe.
/// @dev Report sizing reads live aggregate capital, including direct authorizations
/// that do not touch any question. No question or owner enumeration is required.
contract SharedPoolPriceFeed {
	bool public constant timeType = true;
	bool public constant trackDisputes = true;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
	uint32 public constant REPORT_OPERATION_GAS_OVERHEAD = 100_000;
	// Every allowed capital operation is a fixed-size call far below this length. Stored
	// operation data is read back inside the callback, which REPORT_OPERATION_GAS_OVERHEAD
	// covers only for bounded data.
	uint256 public constant MAXIMUM_REPORT_OPERATION_DATA_BYTES = 512;
	uint256 public constant FEED_SETTLEMENT_GAS_OVERHEAD = 4_000_000;
	/// @dev Upper bound on callback gas, including sponsor operations, so every
	/// report this feed creates stays settleable within one transaction.
	uint256 private constant MAXIMUM_REPORT_CALLBACK_GAS = 10_000_000;
	address public immutable securityPoolFactory;
	address public immutable securityPool;
	OpenOracle public immutable openOracle;
	IERC20 public immutable collateralToken;
	uint256 public immutable minimumReportCollateral;
	IWeth9 public immutable weth;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable targetPriceErrorForDispute;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public pendingReportId;
	address public pendingReportSponsor;
	address public pendingCoordinator;
	uint256 public pendingReportMaxSettlementBaseFeeAttoEthPerGas;
	uint256 public pendingExposureLimitAttoEth;
	uint256 public acceptedExposureLimitAttoEth;
	uint256 public acceptedRepExposureLimitAttoRep;
	uint256 public acceptedEpoch;
	bool private processingReport;
	uint8 private constant REPORT_PENDING = 0;
	uint8 private constant REPORT_ACCEPTED = 1;
	uint8 private constant REPORT_REJECTED = 2;
	struct ReportFundingQuote {
		uint256 wethAttoEth;
		uint256 repAttoRep;
		uint256 haltAttoEth;
		uint256 exposureLimitAttoEth;
		uint256 maxSettlementBaseFeeAttoEthPerGas;
	}
	struct ReportCandidate {
		SharedPoolReportEscrow escrow;
		address sponsor;
		address coordinator;
		uint8 outcome;
		uint256 maxSettlementBaseFee;
	}
	mapping(uint256 => ReportCandidate) private reports;
	mapping(uint256 => IReportOperations.Batch) private operationBatches;
	mapping(address => uint256) public sponsorOperationReport;
	event ReportOperationAttempted(uint256 indexed reportId, address indexed sponsor, uint256 indexed operationIndex, bool success);
	uint256 public lastPrice;
	uint256 public lastSettlementTimestamp;
	uint256 private checkpointedExposureAttoEth;
	mapping(address => bool) public registeredCoordinators;
	function reportCandidates(uint256 reportId)
		external
		view
		returns (SharedPoolReportEscrow escrow, address sponsor, address coordinator, uint256 maxSettlementBaseFee)
	{
		ReportCandidate storage candidate = reports[reportId];
		return (candidate.escrow, candidate.sponsor, candidate.coordinator, candidate.maxSettlementBaseFee);
	}
	/// @dev 0 = unknown or pending, 1 = accepted, 2 = rejected. Recovery can produce either final outcome.
	function reportOutcome(uint256 reportId) external view returns (uint8) {
		return reports[reportId].outcome;
	}

	event CoordinatorRegistered(address indexed coordinator, address indexed questionLedger);
	event ExposureCheckpoint(address indexed coordinator, uint256 aggregateExposureAttoEth);
	event PriceRequested(uint256 indexed reportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas);
	event ReportFundingAssigned(uint256 indexed reportId, address indexed coordinator, address indexed sponsor);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PriceReportRejected(uint256 indexed reportId, string reason, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	/// @notice The report settled in a block above its base-fee ceiling. It stays pending
	/// so `recoverReport` can complete it at or below the ceiling while it is fresh.
	event PriceReportDeferred(uint256 indexed reportId, uint256 baseFee, uint256 maxSettlementBaseFee);
	event PendingReportRecovered(uint256 indexed reportId, uint256 settlementTimestamp, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);

	constructor(ISharedPoolPriceCoordinator config, address _securityPoolFactory, address _securityPool) {
		require(_securityPoolFactory != address(0), 'Security pool factory zero');
		securityPoolFactory = _securityPoolFactory;
		require(_securityPool != address(0), 'Security pool zero');
		securityPool = _securityPool;
		openOracle = config.openOracle();
		weth = config.weth();
		collateralToken = ICollateralConfig(_securityPool).collateralToken();
		minimumReportCollateral = ICollateralConfig(_securityPool).minimumReportCollateral();
		initialReportPriorityFeeAttoEthPerGas = config.initialReportPriorityFeeAttoEthPerGas();
		targetPriceErrorForDispute = config.targetPriceErrorForDispute();
		require(targetPriceErrorForDispute < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Oracle uncertainty reaches one hundred percent');
		settlementTime = config.settlementTime();
		disputeDelay = config.disputeDelay();
		protocolFee = config.protocolFee();
		feePercentage = config.feePercentage();
		multiplier = config.multiplier();
		protocolFeeRecipient = config.protocolFeeRecipient();
		escalationHaltMultiplierBps = config.escalationHaltMultiplierBps();
		maxSettlementBaseFeeMultiplierBps = config.maxSettlementBaseFeeMultiplierBps();
	}

	function universeId() public view returns (uint248 universe) {
		(universe, ) = SecurityPoolBoundClones.universeBindings();
	}
	function reputationToken() public view returns (ReputationToken) {
		(, address token) = SecurityPoolBoundClones.universeBindings();
		return ReputationToken(token);
	}

	/// @notice Factory-only registration after the coordinator and ledger have been atomically linked.
	function registerCoordinator(address coordinatorAddress) external {
		require(msg.sender == securityPoolFactory, 'Only security pool factory');
		require(!registeredCoordinators[coordinatorAddress], 'Coordinator already registered');
		(uint248 universe, address token) = SecurityPoolBoundClones.universeBindings();
		ISharedPoolPriceCoordinator coordinator = ISharedPoolPriceCoordinator(coordinatorAddress);
		IQuestionLedger pool = coordinator.questionLedger();
		require(address(pool) != address(0) && address(pool.securityPoolFactory()) == securityPoolFactory, 'Wrong security pool factory');
		require(address(pool.openOraclePriceCoordinator()) == coordinatorAddress, 'Wrong pool coordinator');
		require(address(coordinator.reputationToken()) == token && address(pool.repToken()) == token, 'Wrong REP token');
		require(address(coordinator.openOracle()) == address(openOracle) && address(coordinator.weth()) == address(weth), 'Wrong oracle tokens');
		require(coordinator.initialReportPriorityFeeAttoEthPerGas() == initialReportPriorityFeeAttoEthPerGas, 'Feed priority fee mismatch');
		require(pool.universeId() == universe, 'Wrong pool universe');
		require(ISecurityPoolFactory(securityPoolFactory).securityPoolOf(pool) == securityPool, 'Wrong pool security pool');
		require(ISecurityPoolFactory(securityPoolFactory).sharedPriceFeeds(securityPool, universe) == address(this), 'Feed is not canonical');
		registeredCoordinators[coordinatorAddress] = true;
		_syncExposure(coordinatorAddress, pool);
		emit CoordinatorRegistered(coordinatorAddress, address(pool));
	}

	/// @notice Emits a changed aggregate exposure after an authenticated question checkpoint.
	function syncExposure(address coordinatorAddress) external {
		require(registeredCoordinators[coordinatorAddress], 'Unregistered coordinator');
		_syncExposure(coordinatorAddress, ISharedPoolPriceCoordinator(coordinatorAddress).questionLedger());
	}

	function _syncExposure(address coordinatorAddress, IQuestionLedger pool) private {
		require(pool.universeId() == universeId(), 'Wrong exposure universe');
		uint256 exposureAttoEth = aggregateExposureAttoEth();
		if (exposureAttoEth == checkpointedExposureAttoEth) return;
		checkpointedExposureAttoEth = exposureAttoEth;
		emit ExposureCheckpoint(coordinatorAddress, exposureAttoEth);
	}

	function aggregateExposureAttoEth() public view returns (uint256) {
		return ISharedPoolSecurityPoolPriceCheckpoint(securityPool).oracleExposure(universeId());
	}

	/// @notice Capital may grow only within an already challenged report's budget.
	/// Pending candidates neither lower this budget nor grant premature capacity.
	function validateExposure() external view {
		require(aggregateExposureAttoEth() <= acceptedExposureLimitAttoEth, 'Accepted report exposure exceeded');
	}

	/// @notice Conservative upper REP/collateral bound for entry, withdrawals and capacity.
	function conservativePrice() external view returns (uint256) {
		return OraclePriceMath.conservativePrice(lastPrice, targetPriceErrorForDispute);
	}

	/// @notice Lower REP/collateral bound for externally rewarded adverse actions.
	function liquidationPrice() external view returns (uint256) {
		return OraclePriceMath.liquidationPrice(lastPrice, targetPriceErrorForDispute);
	}

	/// @notice Report collateral covers aggregate standing commitment or funded demand.
	/// Unused accepted capacity does not raise renewal funding. Concurrent growth
	/// may require sponsor headroom: settlement rechecks actual exposure.
	function minimumToken1ReportAttoEth() public view returns (uint256) {
		return minimumReportCollateral + Math.ceilDiv(aggregateExposureAttoEth(), OPEN_INTEREST_DIVIDER);
	}

	/// @notice Auction inventory needs a challenged REP-side budget as well as
	/// the collateral liability budget. Neither budget may be inferred from the other
	/// using an unchallenged proposed price.
	function minimumToken2ReportAttoRep() public view returns (uint256) {
		return
			Math.ceilDiv(ISharedPoolSecurityPoolPriceCheckpoint(securityPool).oracleRepExposure(universeId()), OPEN_INTEREST_DIVIDER);
	}
	function minimumToken1ReportAttoEthForPrice(uint256 proposedRepPerEthPrice) public view returns (uint256) {
		require(proposedRepPerEthPrice != 0, 'Initial oracle price zero');
		return
			Math.max(minimumToken1ReportAttoEth(), Math.mulDiv(minimumToken2ReportAttoRep(), SecurityPoolUtils.PRICE_PRECISION, proposedRepPerEthPrice, Math.Rounding.Ceil));
	}

	function getSettlementCallbackGasLimit() public pure returns (uint32) {
		return uint32(FEED_SETTLEMENT_GAS_OVERHEAD);
	}

	/// @notice Sponsor-funded incentive for independent settlement, including
	/// callback dispatch, EIP-150 slack, and collecting the public reward.
	function getRequestPriceCostAttoEth() public view returns (uint256) {
		return _minimumSettlementBounty(getSettlementCallbackGasLimit());
	}

	function _minimumSettlementBounty(uint256 callbackGas) private view returns (uint256) {
		uint256 gasBudget = callbackGas + callbackGas / 63 + 310_000;
		uint256 feeAllowance = Math.mulDiv(block.basefee + initialReportPriorityFeeAttoEthPerGas, maxSettlementBaseFeeMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
		return
			Math.mulDiv(gasBudget, 12_000, SecurityPoolUtils.BPS_DENOMINATOR, Math.Rounding.Ceil) * feeAllowance +
			20_000 * feeAllowance +
			REQUEST_BOUNTY_OFFSET_ATTO_ETH;
	}

	/// @notice A registered coordinator authenticates the sponsor and forwards the report's exact token funding.
	function requestPrice(address sponsor, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 reportId) {
		require(registeredCoordinators[msg.sender], 'Unregistered coordinator');
		return
			_requestPrice(msg.sender, sponsor, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth, getSettlementCallbackGasLimit());
	}

	/// @notice Fund a shared observation without first deploying a child question.
	/// The caller approves this feed for the configured collateral and the branch's REP; only that caller
	/// receives the candidate's returned funding. No pool collateral funds reports.
	function requestSecurityPoolPrice(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 reportId) {
		return
			_requestPrice(address(this), msg.sender, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth, getSettlementCallbackGasLimit());
	}

	/// @notice Anyone may settle, but these ordered operations retain the funding sponsor.
	/// Count is limited only by the declared gas budget and transaction gas limits.
	function requestSecurityPoolPriceWithOperations(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth, IReportOperations.Batch calldata batch) external payable returns (uint256 reportId) {
		require(batch.deadline > block.timestamp, 'Report operations expired');
		require(batch.maximumPrice >= batch.minimumPrice && batch.maximumPrice != 0, 'Invalid operation price bounds');
		require(batch.operations.length != 0, 'No report operations');
		uint256 requiredGas;
		for (uint256 index = 0; index < batch.operations.length; index++) {
			require(batch.operations[index].gasLimit != 0, 'Operation gas zero');
			require(batch.operations[index].data.length <= MAXIMUM_REPORT_OPERATION_DATA_BYTES, 'Operation data too large');
			requiredGas += uint256(batch.operations[index].gasLimit) + REPORT_OPERATION_GAS_OVERHEAD;
		}
		require(requiredGas <= batch.gasLimit, 'Operation gas budget insufficient');
		uint256 callbackGas = uint256(getSettlementCallbackGasLimit()) + batch.gasLimit;
		require(callbackGas <= MAXIMUM_REPORT_CALLBACK_GAS, 'Callback gas exceeds limit');
		reportId = _requestPrice(address(this), msg.sender, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth, uint32(callbackGas));
		IReportOperations.Batch storage stored = operationBatches[reportId];
		stored.gasLimit = batch.gasLimit;
		stored.minimumPrice = batch.minimumPrice;
		stored.maximumPrice = batch.maximumPrice;
		stored.deadline = batch.deadline;
		for (uint256 index = 0; index < batch.operations.length; index++)
			stored.operations.push(batch.operations[index]);
		sponsorOperationReport[msg.sender] = reportId;
	}

	function _requestPrice(address coordinator, address sponsor, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth, uint32 callbackGasLimit) private returns (uint256 reportId) {
		require(ISharedPoolSecurityPoolPriceCheckpoint(securityPool).isPriceReportingOpen(universeId()), 'Security pool reporting window closed');
		require(sponsor != address(0), 'Report sponsor zero');
		require(proposedRepPerEthPrice > 0, 'Initial oracle price zero');
		require(bountyAttoEth >= _minimumSettlementBounty(callbackGasLimit), 'Oracle bounty too small');
		require(msg.value == bountyAttoEth, 'Incorrect oracle bounty');
		ReportFundingQuote memory quote = _quoteReportFunding(proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		pendingExposureLimitAttoEth = quote.exposureLimitAttoEth;
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = quote.maxSettlementBaseFeeAttoEthPerGas;
		pendingReportSponsor = sponsor;
		pendingCoordinator = coordinator;
		SharedPoolReportEscrow escrow;
		(reportId, escrow) = this.createReportEscrow(msg.sender, sponsor, quote.wethAttoEth, quote.repAttoRep, quote.haltAttoEth, bountyAttoEth, callbackGasLimit);
		pendingReportId = reportId;
		reports[reportId] = ReportCandidate(escrow, sponsor, coordinator, REPORT_PENDING, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		emit PriceRequested(pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		emit ReportFundingAssigned(pendingReportId, coordinator, sponsor);
	}

	/// @dev Quote first; custody changes and the self-only escrow call stay in the request path.
	function _quoteReportFunding(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) private view returns (ReportFundingQuote memory quote) {
		require(requestedInitialAttoWeth >= minimumToken1ReportAttoEthForPrice(proposedRepPerEthPrice), 'Report funding below minimum');
		quote.wethAttoEth = requestedInitialAttoWeth;
		quote.repAttoRep = Math.mulDiv(quote.wethAttoEth, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		quote.haltAttoEth = Math.mulDiv(quote.wethAttoEth, escalationHaltMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
		uint256 exposureEscalationHaltAttoEth = Math.ceilDiv(aggregateExposureAttoEth(), OPEN_INTEREST_DIVIDER);
		if (exposureEscalationHaltAttoEth > quote.haltAttoEth) quote.haltAttoEth = exposureEscalationHaltAttoEth;
		require(quote.wethAttoEth <= type(uint128).max, 'WETH report exceeds uint128');
		require(quote.repAttoRep <= type(uint128).max, 'REP report exceeds uint128');
		require(quote.haltAttoEth <= type(uint128).max, 'Oracle escalation halt amount exceeds uint128 maximum');
		require(bountyAttoEth <= type(uint96).max, 'Oracle settler reward exceeds uint96 maximum');
		quote.exposureLimitAttoEth = (quote.wethAttoEth - minimumReportCollateral) * OPEN_INTEREST_DIVIDER;
		quote.maxSettlementBaseFeeAttoEthPerGas = Math.mulDiv(block.basefee + initialReportPriorityFeeAttoEthPerGas, maxSettlementBaseFeeMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
	}

	function createReportEscrow(address payer, address sponsor, uint256 wethAmount, uint256 repAmount, uint256 haltAmount, uint256 bounty, uint32 callbackGasLimit) external returns (uint256 id, SharedPoolReportEscrow escrow) {
		require(msg.sender == address(this), 'Only report creation');
		ReputationToken rep = reputationToken();
		escrow = new SharedPoolReportEscrow(sponsor, openOracle, collateralToken, rep, callbackGasLimit);
		Collateral.pull(collateralToken, payer, address(escrow), wethAmount);
		require(rep.transferFrom(payer, address(escrow), repAmount), 'REP transfer for initial report failed');
		OpenOracle.OracleGame memory parameters;
		parameters.currentAmount1 = uint128(wethAmount);
		parameters.currentAmount2 = uint128(repAmount);
		parameters.currentReporter = address(escrow);
		parameters.token1 = address(collateralToken);
		parameters.settlementTime = settlementTime;
		parameters.escalationHalt = uint128(haltAmount);
		parameters.protocolFeeRecipient = protocolFeeRecipient;
		parameters.settlerReward = uint96(bounty);
		parameters.token2 = address(rep);
		parameters.disputeDelay = disputeDelay;
		parameters.feePercentage = feePercentage;
		parameters.multiplier = multiplier;
		parameters.callbackContract = address(escrow);
		parameters.callbackGasLimit = callbackGasLimit;
		parameters.protocolFee = protocolFee;
		parameters.flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_TIME_TYPE;
		id = escrow.start{value: bounty}(parameters);
	}

	/// @notice Accept one independently challenged candidate without executing a question's queue.
	/// Every candidate remains individually recoverable. A disputed report cannot
	/// prevent a different sponsor from establishing a fresh, funded observation.
	function settleReport(uint256 reportId, uint256 amount1, uint256 amount2) external {
		ReportCandidate memory candidate = reports[reportId];
		require(address(candidate.escrow) == msg.sender && msg.sender != address(0), 'Wrong report escrow');
		_completeReport(reportId, amount1, amount2, candidate);
	}

	/// @dev Callback and recovery use identical freshness, funding and operation checks.
	/// Anyone may choose the settlement block, so a base fee above the report's ceiling
	/// is never final: when it is the only failed check the report stays pending and
	/// returns false. A later recovery at or below the ceiling completes it, and the
	/// freshness check retires it once its validity window closes.
	function _completeReport(uint256 reportId, uint256 amount1, uint256 amount2, ReportCandidate memory candidate) private returns (bool completed) {
		require(!processingReport, 'Report processing active');
		require(reports[reportId].outcome == REPORT_PENDING, 'Report already completed');
		(string memory reason, uint256 priceTimestamp) = _validateSettledReport(reportId, amount1, amount2);
		bool accepted = bytes(reason).length == 0;
		bool canonicalOperations =
			!accepted &&
				operationBatches[reportId].operations.length != 0 &&
				lastPrice != 0 &&
				_isFreshPriceTimestamp(lastSettlementTimestamp) &&
				(keccak256(bytes(reason)) == keccak256('Report uneconomic') ||
					keccak256(bytes(reason)) == keccak256('Report timestamp not newer'));
		if ((accepted || canonicalOperations) && block.basefee > candidate.maxSettlementBaseFee) {
			emit PriceReportDeferred(reportId, block.basefee, candidate.maxSettlementBaseFee);
			return false;
		}
		processingReport = true;
		reports[reportId].outcome = accepted ? REPORT_ACCEPTED : REPORT_REJECTED;
		_clearLatestReport(reportId);
		// Equal-time reports retain operation authority without replacing shared values.
		if (accepted && priceTimestamp > lastSettlementTimestamp) {
			uint256 nextPrice = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
			uint256 validForSeconds = priceValidityWindowSeconds();
			require(priceTimestamp + validForSeconds <= type(uint48).max, 'Price clock overflow');
			// Final report collateral may increase during disputes. Only its actually
			// challenged final amount grants capacity, never a pending candidate.
			acceptedExposureLimitAttoEth = (amount1 - minimumReportCollateral) * OPEN_INTEREST_DIVIDER;
			acceptedRepExposureLimitAttoRep = amount2 * OPEN_INTEREST_DIVIDER;
			acceptedEpoch++;
			lastSettlementTimestamp = priceTimestamp;
			lastPrice = nextPrice;
			ISharedPoolSecurityPoolPriceCheckpoint(securityPool).onSharedPriceAccepted(universeId(), nextPrice, uint48(priceTimestamp + validForSeconds));
		} else if (!accepted) {
			emit PriceReportRejected(reportId, reason, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
		}
		// Every accepted report remains observable to receipt consumers, even
		// when the canonical observation was already accepted at this timestamp.
		if (accepted) emit PriceReported(reportId, lastPrice, lastSettlementTimestamp);
		// Rejection grants no price authority. Independently secured canonical
		// prices can still satisfy the sponsor's signed operation bounds.
		if (accepted || canonicalOperations) _executeReportOperations(reportId, candidate.sponsor);
		processingReport = false;
		return true;
	}

	function _isReportOperation(bytes4 selector) private pure returns (bool) {
		return
			selector == SecurityPoolCapitalLedger.takeOver.selector ||
			selector == SecurityPoolCapitalLedger.takeOverWithBounds.selector ||
			selector == SecurityPoolCapitalLedger.takeOverAuctionBid.selector ||
			selector == SecurityPoolCapitalLedger.depositFor.selector ||
			selector == SecurityPoolCapitalLedger.depositAndSetHealthTarget.selector ||
			selector == SecurityPoolCapitalLedger.withdrawPrincipal.selector ||
			selector == SecurityPoolCapitalLedger.setHealthTarget.selector ||
			selector == SecurityPoolCapitalLedger.setCommitment.selector ||
			selector == SecurityPoolCapitalLedger.setCommitmentWithReport.selector ||
			selector == SecurityPoolCapitalLedger.claimEarnings.selector ||
			selector == SecurityPoolCapitalLedger.serveRetirement.selector ||
			selector == SecurityPoolCapitalLedger.materializeAuctionBid.selector;
	}

	function _executeReportOperations(uint256 reportId, address sponsor) private {
		IReportOperations.Batch storage batch = operationBatches[reportId];
		if (batch.operations.length == 0) return;
		// Starving any promised attempt rolls back acceptance and earlier operations.
		// A failing operation itself consumes only its own allowance and rolls back
		// only that operation. Later operations are still attempted in order.
		require(gasleft() > uint256(batch.gasLimit) + REPORT_OPERATION_GAS_OVERHEAD, 'Report operations gas too low');
		address ledger = address(ISharedPoolSecurityPoolPriceCheckpoint(securityPool).capitalLedger(universeId()));
		for (uint256 index = 0; index < batch.operations.length; index++) {
			IReportOperations.Operation storage operation = batch.operations[index];
			bool success;
			if (
				block.timestamp <= batch.deadline && lastPrice >= batch.minimumPrice && lastPrice <= batch.maximumPrice
			) {
				bytes memory ownerData = operation.data;
				if (ownerData.length >= 4 && _isReportOperation(bytes4(ownerData))) {
					bytes memory data = abi.encodeCall(IReportOperations.executeReportOperation, (sponsor, ownerData));
					uint256 operationGas = uint256(operation.gasLimit);
					require(gasleft() > operationGas + Math.ceilDiv(operationGas, 63) + REPORT_OPERATION_GAS_OVERHEAD, 'Operation gas too low');
					(success, ) = ledger.call{gas: operation.gasLimit}(data);
				}
			}
			emit ReportOperationAttempted(reportId, sponsor, index, success);
		}
	}

	/// @notice Process the latest candidate after a failed OpenOracle callback.
	function recoverSettledPendingReport() external {
		recoverReport(pendingReportId);
	}

	/// @notice Complete a settled report whose callback failed or whose settlement block
	/// exceeded its base-fee ceiling, using the amounts and observation timestamp OpenOracle stored.
	/// Funding remains separately withdrawable from the report escrow.
	/// Expired observations retire normally; fresh canonical prices may still serve
	/// superseded candidates’ bounded operations. Fresh candidates retain
	/// their original sponsor operations and cannot be killed by callback starvation
	/// or by a third party settling them in a high-base-fee block.
	function recoverReport(uint256 reportId) public {
		ReportCandidate memory candidate = reports[reportId];
		require(address(candidate.escrow) != address(0) && reports[reportId].outcome == REPORT_PENDING, 'No report to recover');
		(uint128 amount1, uint128 amount2, , , uint48 settlementTimestamp) = IStoredOpenOracleGame(address(openOracle)).storedGame(reportId);
		require(settlementTimestamp != 0, 'Report not settled');
		require(_completeReport(reportId, amount1, amount2, candidate), 'Base fee too high');
		emit PendingReportRecovered(reportId, settlementTimestamp, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
	}

	function _clearLatestReport(uint256 reportId) private {
		if (reportId != pendingReportId) return;
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		pendingCoordinator = address(0);
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		pendingExposureLimitAttoEth = 0;
	}

	function _validateSettledReport(uint256 reportId, uint256 amount1, uint256 amount2) private view returns (string memory reason, uint256 priceTimestamp) {
		// Before activation, closing is anchored to the native recap deadline.
		// A later callback must reject the candidate without replacing its frozen quote.
		if (!ISharedPoolSecurityPoolPriceCheckpoint(securityPool).isPriceReportingOpen(universeId()))
			return ('Security pool reporting window closed', 0);
		(, , , uint48 finalReportTimestamp, , , , , , , , , uint24 numReports, , , , , , , ) = openOracle.storedGame(reportId);
		if (numReports == type(uint24).max) return ('Counter saturated', 0);
		if (numReports == 0 || !_isFinalReportProfitable(amount1)) return ('Report uneconomic', 0);
		if (amount2 < minimumToken2ReportAttoRep()) return ('Report REP inventory budget insufficient', 0);
		priceTimestamp = uint256(finalReportTimestamp) + settlementTime;
		if (priceTimestamp < lastSettlementTimestamp) return ('Report timestamp not newer', 0);
		// Equal-time observations are independently challenged evidence. Ordering
		// their settlements must not suppress a sponsor's authorized operation.
		if (!_isFreshPriceTimestamp(priceTimestamp)) return ('Report stale', 0);
		if (amount1 == 0 || amount2 == 0) return ('Empty oracle settlement', 0);
		if (Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1) == 0) return ('Oracle price is zero', 0);
	}

	/// @notice An accepted candidate may authorize growth even when a
	/// newer, smaller canonical report has already arrived. The capital ledger
	/// retains this conservative quote as that owner's withdrawal floor until
	/// a later canonical epoch has independently secured the enlarged exposure.
	function reportAuthorization(uint256 reportId, uint256 newExposure) external view returns (uint256 conservativeReportPrice, uint256 epoch) {
		ReportCandidate memory candidate = reports[reportId];
		require(address(candidate.escrow) != address(0), 'Unknown report candidate');
		require(candidate.outcome == REPORT_ACCEPTED, 'Report candidate not accepted');
		(
			uint128 amount1,
			uint128 amount2,
			,
			uint48 reportedAt,
			uint48 settledAt,
			,
			,
			,
			,
			,
			,
			,
			uint24 numReports,
			,
			,
			,
			,
			,
			,

		) = openOracle.storedGame(reportId);
		require(settledAt != 0 && amount1 != 0 && amount2 != 0, 'Report candidate not settled');
		require(block.basefee <= candidate.maxSettlementBaseFee, 'Report base fee limit exceeded');
		require(numReports != 0 && numReports != type(uint24).max, 'Report counter invalid');
		require(_isFreshPriceTimestamp(uint256(reportedAt) + settlementTime), 'Report candidate stale');
		require(_isProfitableForExposure(amount1, newExposure), 'Report exposure insufficient');
		uint256 price = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
		require(price != 0, 'Oracle price is zero');
		conservativeReportPrice = OraclePriceMath.conservativePrice(price, targetPriceErrorForDispute);
		return (conservativeReportPrice, acceptedEpoch);
	}

	function _isFinalReportProfitable(uint256 finalAmount1) private view returns (bool) {
		return _isProfitableForExposure(finalAmount1, aggregateExposureAttoEth());
	}

	function _isProfitableForExposure(uint256 finalAmount1, uint256 exposure) private view returns (bool) {
		return finalAmount1 >= minimumReportCollateral + Math.ceilDiv(exposure, OPEN_INTEREST_DIVIDER);
	}

	function isPriceValid() public view returns (bool) {
		return lastPrice > 0 && _isFreshPriceTimestamp(lastSettlementTimestamp);
	}

	/// @notice One complete challenge period plus bounded keeper slack after settlement eligibility.
	/// @dev Mainnet's 480-second challenge and 300-second slack allow continuous renewal,
	/// but permit a final report to remain usable for at most 1,260 seconds after reporting.
	/// A pending, disputed or rejected renewal never extends the accepted price's expiry.
	function priceValidityWindowSeconds() public view returns (uint256) {
		return
			uint256(settlementTime) +
			(block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS);
	}

	function priceValidUntil() public view returns (uint256) {
		return lastSettlementTimestamp == 0 ? 0 : lastSettlementTimestamp + priceValidityWindowSeconds();
	}

	function _isFreshPriceTimestamp(uint256 priceTimestamp) private view returns (bool) {
		return priceTimestamp != 0 && priceTimestamp + priceValidityWindowSeconds() > block.timestamp;
	}
}
