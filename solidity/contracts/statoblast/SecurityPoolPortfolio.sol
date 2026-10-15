// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IERC1155 } from './interfaces/IERC1155.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolPortfolioVaultDeployer } from './SecurityPoolPortfolioVaultDeployer.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SharedPoolPriceFeed } from './SharedPoolPriceFeed.sol';
import { VaultOperationsInput, VaultLiquidationInput } from './VaultOperations.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Common REP underwriting with separate native settlement and dispute ledgers per question.
/// @dev Question end dates and universe forks freeze ownership before new capital can join. Owners
/// materialize their native positions lazily and retain their own dispute and migration decisions.
contract SecurityPoolPortfolio is ISecurityPoolPortfolio, IERC1155Receiver {
	using SafeERC20Ops for IERC20;

	uint256 public constant MAX_QUESTION_PAGE = 64;
	uint256 public constant MAX_ACTIVE_QUESTIONS = 16;
	uint256 private constant MINIMUM_HEALTH_FACTOR_BPS = 12_000;
	uint256 private constant RESERVATION_FEE_BPS = 100;
	uint256 private constant MINIMUM_RESERVATION_FEE_ATTO_ETH = 0.001 ether;
	uint256 private constant FEE_PRECISION = 1e36;
	uint256 public constant MAX_POOL_SHARES = FEE_PRECISION;
	ISecurityPoolFactory public immutable factory;
	uint248 public immutable originUniverseId;
	uint256 public immutable statoblastSecurityMultiplierBps;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	IERC20 public immutable repToken;
	SecurityPoolPortfolioVaultDeployer public immutable vaultDeployer;
	ISecurityPool private immutable configurationPool;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => uint256) private poolQuestionIds;
	mapping(address => bool) private registeredPools;
	mapping(address => SecurityPoolPortfolioVault) public vaultOf;
	uint256[] private questions;
	uint256[] private activeQuestions;
	mapping(uint256 => bool) private activeQuestionKnown;
	bool private entered;
	WithdrawalRequest[] private withdrawalRequests;
	uint256 public totalSupply;
	uint256 public shareGeneration = 1;
	uint256 public idleRepAttoRep;
	uint256 public feeIndex;
	uint256 private snapshotCounter;
	mapping(uint256 => uint256) private snapshotGenerations;
	mapping(uint256 => uint256) private closedFeeIndexes;
	mapping(uint256 => mapping(address => uint256)) private shareBalances;
	mapping(uint256 => mapping(address => Checkpoint[])) private balanceCheckpoints;
	mapping(address => OwnerFees) private ownerFees;
	mapping(uint256 => FrozenPosition) public frozenPositions;
	mapping(uint256 => mapping(address => bool)) public positionClaimed;
	mapping(address => address) private positionSourcePools;
	mapping(uint256 => uint256) private pendingQuestionFeesAttoEth;

	struct WithdrawalRequest {
		SecurityPoolPortfolioVault vault;
		uint256 requestId;
	}

	struct Checkpoint {
		uint256 snapshotId;
		uint256 shares;
	}

	struct OwnerFees {
		uint256 generation;
		uint256 index;
		uint256 accruedAttoEth;
	}

	struct FrozenPosition {
		uint256 questionId;
		uint256 totalShares;
		uint256 remainingShares;
		SecurityPoolPortfolioPosition custody;
	}

	event QuestionRegistered(uint256 indexed questionId, bytes32 indexed originId, ISecurityPool indexed originPool);
	event VaultCreated(address indexed owner, SecurityPoolPortfolioVault indexed vault);
	event CompleteSetsFunded(uint256 indexed questionId, address indexed payer, address indexed recipient, uint256 amountAttoEth, uint256 mintedAttoShares);
	event ReservationFeesPaid(uint256 indexed questionId, address indexed payer, uint256 feesAttoEth);
	event WithdrawalQueued(uint256 indexed index, SecurityPoolPortfolioVault indexed vault, uint256 requestId);
	event Deposited(address indexed owner, uint256 amountAttoRep, uint256 shares, uint256 generation);
	event Withdrawn(address indexed owner, uint256 shares, uint256 idleAttoRep, uint256 generation);
	event QuestionFrozen(uint256 indexed questionId, uint256 indexed positionId, SecurityPoolPortfolioPosition indexed custody, uint256 shares, uint256 generation);
	event QuestionPositionClaimed(uint256 indexed positionId, address indexed owner, SecurityPoolPortfolioVault indexed vault, uint256 shares);
	event FeesClaimed(address indexed owner, uint256 amountAttoEth);
	event ShareGenerationStarted(uint256 indexed generation);

	constructor(ISecurityPoolFactory _factory, ISecurityPool initialOriginPool, uint256 _maximumQuestionHorizonSeconds) {
		require(_maximumQuestionHorizonSeconds > 0 && _maximumQuestionHorizonSeconds <= type(uint48).max, 'Invalid question horizon');
		maximumQuestionHorizonSeconds = _maximumQuestionHorizonSeconds;
		require(address(_factory).code.length > 0, 'Factory has no code');
		require(address(initialOriginPool).code.length > 0, 'Pool has no code');
		factory = _factory;
		configurationPool = initialOriginPool;
		originUniverseId = initialOriginPool.universeId();
		repToken = IERC20(address(initialOriginPool.repToken()));
		vaultDeployer = new SecurityPoolPortfolioVaultDeployer();
		statoblastSecurityMultiplierBps = initialOriginPool.statoblastSecurityMultiplierBps();
		initialReportPriorityFeeAttoEthPerGas = initialOriginPool.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		bytes32 seedOriginId = _factory.getSecurityPoolOriginId(initialOriginPool);
		require(address(initialOriginPool.parent()) == address(0), 'Choose an origin pool');
		require(address(initialOriginPool.securityPoolFactory()) == address(_factory), 'Pool factory mismatch');
		require(address(_factory.getSecurityPool(seedOriginId, originUniverseId)) == address(initialOriginPool), 'Pool is not canonical');
		_requireEligible(initialOriginPool, initialOriginPool.questionId());
		_factory.initializePortfolioPriceFeed(initialOriginPool);
	}

	modifier nonReentrant() {
		require(!entered, 'Portfolio operation active');
		entered = true;
		_;
		entered = false;
	}

	function addQuestion(uint256 questionId) public returns (ISecurityPool pool) {
		bytes32 registeredOrigin = questionOriginIds[questionId];
		if (registeredOrigin != bytes32(0)) return factory.getSecurityPool(registeredOrigin, originUniverseId);
		bytes32 originId = _originId(questionId);
		pool = factory.getSecurityPool(originId, originUniverseId);
		if (address(pool) == address(0)) {
			pool = factory.deployPortfolioSecurityPool(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		}
		_requireEligible(pool, questionId);
		questionOriginIds[questionId] = originId;
		poolQuestionIds[address(pool)] = questionId;
		registeredPools[address(pool)] = true;
		questions.push(questionId);
		emit QuestionRegistered(questionId, originId, pool);
	}

	function getPool(uint256 questionId, uint248 universeId) public view returns (ISecurityPool pool) {
		bytes32 originId = questionOriginIds[questionId];
		require(originId != bytes32(0), 'Question not registered');
		pool = factory.getSecurityPool(originId, universeId);
		require(address(pool) != address(0), 'Question pool unavailable');
	}

	function priceFeed(uint248 universeId) external view returns (address) {
		return factory.sharedPriceFeeds(address(this), universeId);
	}

	function questionCount() external view returns (uint256) {
		return questions.length;
	}

	function getQuestions(uint256 startIndex, uint256 count) external view returns (uint256[] memory page) {
		require(count <= MAX_QUESTION_PAGE && startIndex <= questions.length, 'Invalid page');
		count = Math.min(count, questions.length - startIndex);
		page = new uint256[](count);
		for (uint256 index; index < count; index++) page[index] = questions[startIndex + index];
	}

	function getActiveQuestions() external view returns (uint256[] memory) {
		return activeQuestions;
	}

	function isPositionSourceForPool(address source, address pool) external view returns (bool) {
		return
			source == address(this) ? registeredPools[pool] : pool != address(0) && positionSourcePools[source] == pool;
	}

	function frozenPositionCount() external view returns (uint256) {
		return snapshotCounter;
	}

	function getFrozenPositionIds(uint256 startIndex, uint256 count) external view returns (uint256[] memory ids) {
		require(count <= MAX_QUESTION_PAGE && startIndex <= snapshotCounter, 'Invalid page');
		count = Math.min(count, snapshotCounter - startIndex);
		ids = new uint256[](count);
		for (uint256 index; index < count; index++) ids[index] = startIndex + index + 1;
	}

	function createVault() external returns (SecurityPoolPortfolioVault) {
		return _createVault(msg.sender);
	}

	function _createVault(address owner) private returns (SecurityPoolPortfolioVault vault) {
		vault = vaultOf[owner];
		if (address(vault) != address(0)) return vault;
		vault = vaultDeployer.createVault(owner);
		vaultOf[owner] = vault;
		emit VaultCreated(owner, vault);
	}

	function predictVaultAddress(address owner) external view returns (address) {
		return vaultDeployer.predictVaultAddress(owner);
	}

	function balanceOf(address owner) public view returns (uint256) {
		return shareBalances[shareGeneration][owner];
	}

	/// @notice Active REP only. Frozen question positions remain separate claims of their original owners.
	function totalAssets() public view returns (uint256 assets) {
		assets = idleRepAttoRep;
		for (uint256 index; index < activeQuestions.length; index++) {
			ISecurityPool pool = getPool(activeQuestions[index], originUniverseId);
			if (_hasEnded(pool)) continue;
			(uint256 units, , , ) = pool.securityVaults(address(this));
			assets += pool.backingUnitsToAttoRep(units);
		}
	}

	function getAggregateState()
		external
		view
		returns (
			uint256 backingAttoRep,
			uint256 idleAttoRep,
			uint256 availableAttoRep,
			uint256 underwritingLimitAttoEth,
			uint256 backedCapacityAttoEth
		)
	{
		backingAttoRep = totalAssets();
		idleAttoRep = idleRepAttoRep;
		availableAttoRep = idleAttoRep;
		for (uint256 index; index < activeQuestions.length; index++) {
			ISecurityPool pool = getPool(activeQuestions[index], originUniverseId);
			if (_hasEnded(pool)) continue;
			(, uint256 commitment, , ) = pool.securityVaults(address(this));
			underwritingLimitAttoEth += commitment;
			(, uint256 releasable) = _rebalancePlan(pool);
			availableAttoRep += releasable;
		}
		uint256 price = SharedPoolPriceFeed(payable(factory.sharedPriceFeeds(address(this), originUniverseId))).lastPrice();
		if (price != 0)
			backedCapacityAttoEth = Math.mulDiv(Math.mulDiv(backingAttoRep, 1e18, price), 100_000_000, Math.max(statoblastSecurityMultiplierBps, 10_500) * MINIMUM_HEALTH_FACTOR_BPS);
	}

	/// @notice Commit REP to the common pool under its immutable underwriting and fee policy.
	function deposit(uint256 amountAttoRep, uint256 minimumShares) external nonReentrant returns (uint256 mintedShares) {
		require(amountAttoRep > 0, 'Deposit amount zero');
		require(configurationPool.zoltar().getForkTime(originUniverseId) == 0, 'Universe already forked');
		_sync();
		uint256 assets = totalAssets();
		mintedShares = totalSupply == 0 ? amountAttoRep : Math.mulDiv(amountAttoRep, totalSupply, assets);
		require(mintedShares > 0 && mintedShares >= minimumShares, 'Minimum pool shares not met');
		require(mintedShares <= MAX_POOL_SHARES - totalSupply, 'Pool share precision exhausted');
		_settleOwnerFees(msg.sender);
		_checkpointOwner(msg.sender);
		shareBalances[shareGeneration][msg.sender] += mintedShares;
		totalSupply += mintedShares;
		idleRepAttoRep += amountAttoRep;
		repToken.safeTransferFrom(msg.sender, address(this), amountAttoRep);
		_createVault(msg.sender);
		emit Deposited(msg.sender, amountAttoRep, mintedShares, shareGeneration);
	}

	/// @notice Exit proportionally into idle REP and individually owned native question positions.
	/// @dev Existing commitments follow their native runoff; this operation does not choose outcomes.
	function withdraw(uint256 shares, uint256 minimumIdleAttoRep) external nonReentrant returns (uint256 returnedAttoRep) {
		_sync();
		require(shares > 0 && shares <= balanceOf(msg.sender), 'Invalid share withdrawal');
		_settleOwnerFees(msg.sender);
		_checkpointOwner(msg.sender);
		uint256 previousSupply = totalSupply;
		returnedAttoRep = Math.mulDiv(idleRepAttoRep, shares, previousSupply);
		require(returnedAttoRep >= minimumIdleAttoRep, 'Minimum idle REP not met');
		shareBalances[shareGeneration][msg.sender] -= shares;
		totalSupply -= shares;
		idleRepAttoRep -= returnedAttoRep;
		SecurityPoolPortfolioVault vault = _createVault(msg.sender);
		for (uint256 index; index < activeQuestions.length; index++)
			_splitPosition(activeQuestions[index], vault, shares, previousSupply);
		if (returnedAttoRep > 0) repToken.safeTransfer(msg.sender, returnedAttoRep);
		emit Withdrawn(msg.sender, shares, returnedAttoRep, shareGeneration);
	}

	function sync() external nonReentrant {
		_sync();
	}

	function _sync() private {
		uint256 index;
		while (index < activeQuestions.length) {
			uint256 questionId = activeQuestions[index];
			ISecurityPool pool = getPool(questionId, originUniverseId);
			if (_hasEnded(pool)) {
				_freezeQuestion(index);
				continue;
			}
			pool.redeemFees(address(this));
			_rebalance(pool);
			(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
			if (units == 0 && commitment == 0 && pool.vaultBadDebtAttoEth(address(this)) == 0) {
				_removeActiveQuestion(index);
				continue;
			}
			index++;
		}
		if (totalSupply > 0 && totalAssets() == 0) {
			// Any remaining unfunded commitments still belong to the exhausted generation.
			while (activeQuestions.length > 0) _freezeQuestion(activeQuestions.length - 1);
			closedFeeIndexes[shareGeneration] = feeIndex;
			shareGeneration++;
			totalSupply = 0;
			feeIndex = 0;
			emit ShareGenerationStarted(shareGeneration);
		}
	}

	function _freezeQuestion(uint256 index) private {
		uint256 questionId = activeQuestions[index];
		uint256 snapshotId = ++snapshotCounter;
		snapshotGenerations[snapshotId] = shareGeneration;
		ISecurityPool pool = getPool(questionId, originUniverseId);
		SecurityPoolPortfolioPosition custody = vaultDeployer.createPosition(pool);
		positionSourcePools[address(custody)] = address(pool);
		frozenPositions[snapshotId] = FrozenPosition(questionId, totalSupply, totalSupply, custody);
		pool.splitVaultPosition(address(custody), 1, 1);
		uint256 pendingFees = pendingQuestionFeesAttoEth[questionId];
		if (pendingFees > 0) {
			delete pendingQuestionFeesAttoEth[questionId];
			_sendEth(address(custody), pendingFees);
		}
		emit QuestionFrozen(questionId, snapshotId, custody, totalSupply, shareGeneration);
		_removeActiveQuestion(index);
	}

	/// @dev Archiving a live position preserves its owners and liabilities while freeing an active
	/// accounting slot. It never releases its REP as spendable capital or prevents that question reopening.
	function _makeActiveQuestionRoom() private {
		if (activeQuestions.length < MAX_ACTIVE_QUESTIONS) return;
		uint256 smallestIndex;
		uint256 smallestBacking = type(uint256).max;
		for (uint256 index; index < activeQuestions.length; index++) {
			ISecurityPool pool = getPool(activeQuestions[index], originUniverseId);
			(uint256 units, , , ) = pool.securityVaults(address(this));
			uint256 backing = pool.backingUnitsToAttoRep(units);
			if (backing < smallestBacking) {
				smallestBacking = backing;
				smallestIndex = index;
			}
		}
		_freezeQuestion(smallestIndex);
	}

	function _removeActiveQuestion(uint256 index) private {
		activeQuestionKnown[activeQuestions[index]] = false;
		activeQuestions[index] = activeQuestions[activeQuestions.length - 1];
		activeQuestions.pop();
	}

	function _rebalancePlan(ISecurityPool pool) private view returns (uint256 retainedCommitment, uint256 releaseAttoRep) {
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		uint256 otherCommitment = pool.totalUnderwritingLimitAttoEth() - commitment;
		uint256 collateral = pool.settlementCollateralAttoEth();
		retainedCommitment = collateral > otherCommitment ? Math.min(commitment, collateral - otherCommitment) : 0;
		if (
			!pool.openOraclePriceCoordinator().isPriceValid() ||
			pool.openOraclePriceCoordinator().pendingReportId() != 0
		) return (retainedCommitment, 0);
		uint256 price = pool.openOraclePriceCoordinator().lastPrice();
		uint256 held = pool.backingUnitsToAttoRep(units);
		uint256 required = _requiredBacking(pool, retainedCommitment, price, MINIMUM_HEALTH_FACTOR_BPS);
		if (held <= required) return (retainedCommitment, 0);
		uint256 poolRequired = _requiredBacking(pool, otherCommitment + retainedCommitment, price, 10_000);
		uint256 poolHeld = pool.getTotalPoolHeldAttoRep();
		if (poolHeld <= poolRequired) return (retainedCommitment, 0);
		releaseAttoRep = Math.min(held - required, poolHeld - poolRequired);
		// A native withdrawal takes the whole vault when the remainder is below its deposit floor.
		if (releaseAttoRep < held && held - releaseAttoRep < pool.minimumVaultRepDepositAttoRep())
			releaseAttoRep =
				held > pool.minimumVaultRepDepositAttoRep() ? held - pool.minimumVaultRepDepositAttoRep() : 0;
	}

	function _rebalance(ISecurityPool pool) private {
		(uint256 retainedCommitment, uint256 releaseAttoRep) = _rebalancePlan(pool);
		(, uint256 commitment, , ) = pool.securityVaults(address(this));
		if (retainedCommitment < commitment) pool.setUnderwritingLimit(retainedCommitment);
		if (releaseAttoRep == 0) return;
		uint256 beforeRep = repToken.balanceOf(address(this));
		pool.openOraclePriceCoordinator().vaultOperations().submitVaultOperations(VaultOperationsInput(0, false, 0, new VaultLiquidationInput[](0), releaseAttoRep, MINIMUM_HEALTH_FACTOR_BPS, 300), 0, 0, 0);
		idleRepAttoRep += repToken.balanceOf(address(this)) - beforeRep;
	}

	function quoteMint(uint256 questionId, uint256 mintAttoEth) external view returns (uint256 depositAttoRep, uint256 reservationFeeAttoEth, uint256 availableAttoRep) {
		ISecurityPool pool = getPool(questionId, originUniverseId);
		_requireEligible(pool, questionId);
		require(mintAttoEth > 0, 'Mint collateral not funded');
		availableAttoRep = idleRepAttoRep;
		for (uint256 index; index < activeQuestions.length; index++) {
			ISecurityPool activePool = getPool(activeQuestions[index], originUniverseId);
			if (_hasEnded(activePool)) continue;
			(, uint256 releaseAttoRep) = _rebalancePlan(activePool);
			availableAttoRep += releaseAttoRep;
		}
		(uint256 retainedCommitment, uint256 released) = _rebalancePlan(pool);
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		uint256 held = pool.backingUnitsToAttoRep(units);
		(depositAttoRep, reservationFeeAttoEth, ) = _mintBackingQuote(pool, mintAttoEth, retainedCommitment, commitment, held - released);
	}

	function _mintBackingQuote(ISecurityPool pool, uint256 mintAttoEth, uint256 retainedCommitment, uint256 previousCommitment, uint256 held) private view returns (uint256 depositAttoRep, uint256 feeAttoEth, uint256 nextCommitment) {
		uint256 others = pool.totalUnderwritingLimitAttoEth() - previousCommitment;
		uint256 requiredCommitment = pool.settlementCollateralAttoEth() + mintAttoEth;
		nextCommitment =
			requiredCommitment > others
				? Math.max(retainedCommitment, requiredCommitment - others)
				: retainedCommitment;
		if (nextCommitment <= retainedCommitment) return (0, 0, nextCommitment);
		require(pool.openOraclePriceCoordinator().isPriceValid() && pool.openOraclePriceCoordinator().pendingReportId() == 0, 'Mint needs settled fresh price');
		uint256 price = pool.openOraclePriceCoordinator().lastPrice();
		uint256 requiredRep = _requiredBacking(pool, nextCommitment, price, MINIMUM_HEALTH_FACTOR_BPS);
		if (requiredRep > held) depositAttoRep = requiredRep - held;
		// Unit conversion rounds deposits down. Cover that last unit instead of understating backing.
		uint256 totalUnits = pool.totalRepBackingUnits();
		uint256 totalHeld = pool.getTotalPoolHeldAttoRep();
		if (depositAttoRep > 0 && totalUnits > 0 && totalHeld > 0)
			depositAttoRep = Math.mulDiv(Math.mulDiv(depositAttoRep, totalUnits, totalHeld, Math.Rounding.Ceil), totalHeld, totalUnits, Math.Rounding.Ceil);
		uint256 previouslyReserved = Math.min(held, _requiredBacking(pool, retainedCommitment, price, MINIMUM_HEALTH_FACTOR_BPS));
		uint256 newlyReserved = Math.max(depositAttoRep, requiredRep - previouslyReserved);
		feeAttoEth = Math.max(Math.mulDiv(Math.mulDiv(newlyReserved, 1e18, price, Math.Rounding.Ceil), RESERVATION_FEE_BPS, 10_000, Math.Rounding.Ceil), MINIMUM_RESERVATION_FEE_ATTO_ETH);
	}

	function _requiredBacking(ISecurityPool pool, uint256 commitment, uint256 price, uint256 healthFactor) private view returns (uint256) {
		if (commitment == 0) return 0;
		uint256 required = Math.mulDiv(commitment, price, 1e18, Math.Rounding.Ceil);
		required = Math.mulDiv(required, Math.max(statoblastSecurityMultiplierBps, 10_500), 10_000, Math.Rounding.Ceil);
		return
			Math.max(Math.mulDiv(required, healthFactor, 10_000, Math.Rounding.Ceil), pool.minimumVaultRepDepositAttoRep());
	}

	/// @notice Buy complete sets using the entire pool's available backing under one common fee policy.
	function createCompleteSet(uint256 questionId, address recipient, uint256 minimumShares, uint256 mintAttoEth) external payable nonReentrant {
		require(mintAttoEth > 0 && msg.value >= mintAttoEth, 'Mint collateral not funded');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		ISecurityPool pool = addQuestion(questionId);
		_requireEligible(pool, questionId);
		_sync();
		pool.updateSettlementCollateral();
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		(uint256 depositAttoRep, uint256 feeAttoEth, uint256 nextCommitment) = _mintBackingQuote(pool, mintAttoEth, commitment, commitment, pool.backingUnitsToAttoRep(units));
		require(feeAttoEth <= msg.value - mintAttoEth, 'Reservation fee exceeds budget');
		require(depositAttoRep <= idleRepAttoRep, 'Insufficient aggregate backing');
		if (nextCommitment > commitment) {
			require(totalSupply > 0, 'No underwriting capital');
			if (!activeQuestionKnown[questionId]) {
				_makeActiveQuestionRoom();
				activeQuestionKnown[questionId] = true;
				activeQuestions.push(questionId);
			}
			if (depositAttoRep > 0) {
				idleRepAttoRep -= depositAttoRep;
				repToken.safeApprove(address(pool), depositAttoRep);
				pool.depositRepToVault(depositAttoRep, statoblastSecurityMultiplierBps);
			}
			pool.setUnderwritingLimit(nextCommitment);
			_creditFees(feeAttoEth);
		}
		uint256 beforeShares = pool.shareToken().balanceOfOutcome(originUniverseId, BinaryOutcomes.BinaryOutcome.Invalid, address(this));
		pool.createCompleteSet{value: mintAttoEth}();
		uint256 minted =
			pool.shareToken().balanceOfOutcome(originUniverseId, BinaryOutcomes.BinaryOutcome.Invalid, address(this)) -
				beforeShares;
		require(minted >= minimumShares, 'Minimum shares not met');
		uint256[] memory ids = new uint256[](3);
		uint256[] memory amounts = new uint256[](3);
		for (uint256 index; index < 3; index++) {
			ids[index] = pool.shareToken().getTokenId(originUniverseId, BinaryOutcomes.BinaryOutcome(index));
			amounts[index] = minted;
		}
		IERC1155(address(pool.shareToken())).safeBatchTransferFrom(address(this), recipient, ids, amounts, '');
		emit CompleteSetsFunded(questionId, msg.sender, recipient, mintAttoEth, minted);
		emit ReservationFeesPaid(questionId, msg.sender, feeAttoEth);
		_sendEth(msg.sender, msg.value - mintAttoEth - feeAttoEth);
	}

	function getOwnerPositionShares(uint256 positionId, address owner) public view returns (uint256) {
		FrozenPosition memory frozen = frozenPositions[positionId];
		if (address(frozen.custody) == address(0) || positionClaimed[positionId][owner]) return 0;
		uint256 generation = snapshotGenerations[positionId];
		Checkpoint[] storage checkpoints = balanceCheckpoints[generation][owner];
		uint256 low;
		uint256 high = checkpoints.length;
		while (low < high) {
			uint256 middle = low + (high - low) / 2;
			if (checkpoints[middle].snapshotId < positionId) low = middle + 1;
			else high = middle;
		}
		return low < checkpoints.length ? checkpoints[low].shares : shareBalances[generation][owner];
	}

	function claimPosition(uint256 positionId, address owner) external nonReentrant {
		_sync();
		uint256 shares = getOwnerPositionShares(positionId, owner);
		require(shares > 0, 'No frozen question position');
		FrozenPosition storage frozen = frozenPositions[positionId];
		uint256 denominator = frozen.remainingShares;
		frozen.remainingShares -= shares;
		positionClaimed[positionId][owner] = true;
		SecurityPoolPortfolioVault vault = _createVault(owner);
		frozen.custody.release(address(vault), shares, denominator);
		emit QuestionPositionClaimed(positionId, owner, vault, shares);
	}

	function _splitPosition(uint256 questionId, SecurityPoolPortfolioVault vault, uint256 numerator, uint256 denominator) private {
		getPool(questionId, originUniverseId).splitVaultPosition(address(vault), numerator, denominator);
	}

	function _checkpointOwner(address owner) private {
		if (snapshotCounter == 0) return;
		Checkpoint[] storage checkpoints = balanceCheckpoints[shareGeneration][owner];
		if (checkpoints.length == 0 || checkpoints[checkpoints.length - 1].snapshotId < snapshotCounter)
			checkpoints.push(Checkpoint(snapshotCounter, balanceOf(owner)));
	}

	function _creditFees(uint256 amountAttoEth) private {
		if (amountAttoEth > 0 && totalSupply > 0) feeIndex += Math.mulDiv(amountAttoEth, FEE_PRECISION, totalSupply);
	}

	function claimableFees(address owner) public view returns (uint256) {
		OwnerFees memory account = ownerFees[owner];
		uint256 endingIndex = account.generation == shareGeneration ? feeIndex : closedFeeIndexes[account.generation];
		return
			account.accruedAttoEth +
			Math.mulDiv(shareBalances[account.generation][owner], endingIndex - account.index, FEE_PRECISION);
	}

	function _settleOwnerFees(address owner) private {
		uint256 accrued = claimableFees(owner);
		ownerFees[owner] = OwnerFees(shareGeneration, feeIndex, accrued);
	}

	function claimFees() external nonReentrant {
		_sync();
		_settleOwnerFees(msg.sender);
		uint256 amount = ownerFees[msg.sender].accruedAttoEth;
		require(amount > 0, 'No fees available');
		ownerFees[msg.sender].accruedAttoEth = 0;
		_sendEth(msg.sender, amount);
		emit FeesClaimed(msg.sender, amount);
	}

	function enqueueWithdrawal(uint256 requestId) external {
		SecurityPoolPortfolioVault vault = SecurityPoolPortfolioVault(payable(msg.sender));
		require(address(vaultOf[vault.owner()]) == msg.sender, 'Vault is not canonical');
		withdrawalRequests.push(WithdrawalRequest(vault, requestId));
		emit WithdrawalQueued(withdrawalRequests.length - 1, vault, requestId);
	}

	function withdrawalRequestCount() external view returns (uint256) {
		return withdrawalRequests.length;
	}

	function getWithdrawalRequests(uint256 startIndex, uint256 count) external view returns (WithdrawalRequest[] memory page) {
		require(count <= MAX_QUESTION_PAGE && startIndex <= withdrawalRequests.length, 'Invalid page');
		count = Math.min(count, withdrawalRequests.length - startIndex);
		page = new WithdrawalRequest[](count);
		for (uint256 index; index < count; index++) page[index] = withdrawalRequests[startIndex + index];
	}

	function _hasEnded(ISecurityPool pool) private view returns (bool) {
		return
			block.timestamp >= pool.questionData().getQuestionEndDate(pool.questionId()) ||
			pool.zoltar().getForkTime(originUniverseId) != 0;
	}

	function _originId(uint256 questionId) private view returns (bytes32) {
		return
			factory.getPortfolioOriginId(address(this), originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _requireEligible(ISecurityPool pool, uint256 questionId) private view {
		uint256 end = pool.questionData().getQuestionEndDate(questionId);
		require(block.timestamp < end, 'Question has already ended');
		require(end - block.timestamp <= maximumQuestionHorizonSeconds, 'Question exceeds pool horizon');
		require(pool.zoltar().getForkTime(originUniverseId) == 0, 'Universe already forked');
		require(pool.systemState() == SystemState.Operational, 'Question pool inactive');
	}

	function _sendEth(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = payable(recipient).call{value: amount}('');
		require(sent, 'ETH transfer failed');
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	/// @dev Anyone may redeem native vault fees. Attribute them at receipt even when another caller
	/// performs that redemption; ended-question fees never enter a later owner's common fee index.
	receive() external payable {
		if (!registeredPools[msg.sender]) return;
		uint256 questionId = poolQuestionIds[msg.sender];
		if (_hasEnded(ISecurityPool(payable(msg.sender)))) pendingQuestionFeesAttoEth[questionId] += msg.value;
		else _creditFees(msg.value);
	}
}
