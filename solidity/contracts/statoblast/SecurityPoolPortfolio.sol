// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Constants } from '../Constants.sol';
import { Zoltar } from '../Zoltar.sol';
import { IERC1155 } from './interfaces/IERC1155.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolPortfolioVaultDeployer } from './SecurityPoolPortfolioVaultDeployer.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Common idle REP reserve with allocation-time ownership of each question position.
/// @dev Reserve shares own idle REP and future allocations. Existing positions retain their owners,
/// fees and obligations; they can be materialized independently without visiting other questions.
contract SecurityPoolPortfolio is ISecurityPoolPortfolio, IERC1155Receiver {
	using SafeERC20Ops for IERC20;

	uint256 private constant MAX_QUESTION_PAGE = 64;
	uint256 private constant FEE_PRECISION = 1e36;
	uint256 private constant MAX_POOL_SHARES = FEE_PRECISION;
	ISecurityPoolFactory public immutable factory;
	uint248 public immutable originUniverseId;
	uint256 public immutable statoblastSecurityMultiplierBps;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	IERC20 public immutable repToken;
	SecurityPoolPortfolioVaultDeployer public immutable vaultDeployer;
	SecurityPoolPortfolioQuote public immutable quoteHelper;
	Zoltar private immutable zoltar;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => SecurityPoolPortfolioVault) public vaultOf;
	uint256[] private questions;
	bool private entered;
	WithdrawalRequest[] private withdrawalRequests;
	uint256 public totalSupply;
	uint256 private shareGeneration = 1;
	uint256 public ownershipVersion = 1;
	uint256 public idleRepAttoRep;
	uint256 private feeIndex;
	uint256 private snapshotCounter;
	mapping(uint256 => uint256) private snapshotGenerations;
	mapping(uint256 => uint256) private closedFeeIndexes;
	mapping(uint256 => mapping(address => uint256)) private shareBalances;
	mapping(uint256 => mapping(address => Checkpoint[])) private balanceCheckpoints;
	mapping(address => OwnerFees) private ownerFees;
	mapping(uint256 => Position) public positions;
	mapping(uint256 => mapping(address => bool)) private positionClaimed;
	mapping(address => address) private positionSourcePools;
	mapping(uint256 => uint256) private positionVersions;
	mapping(uint256 => uint256) private reusablePositions;

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

	struct Position {
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
	event PositionAllocated(uint256 indexed questionId, uint256 indexed positionId, SecurityPoolPortfolioPosition indexed custody, uint256 shares, uint256 generation);
	event PositionRebalanced(uint256 indexed positionId, uint256 reserveRepAttoRep, uint256 reserveFeesAttoEth);
	event QuestionPositionClaimed(uint256 indexed positionId, address indexed owner, SecurityPoolPortfolioVault indexed vault, uint256 shares);
	event FeesClaimed(address indexed owner, uint256 amountAttoEth);
	event ShareGenerationStarted(uint256 indexed generation);
	event ReservePrecisionRolledOver(uint256 indexed positionId, uint256 indexed generation, uint256 residualAttoRep);

	constructor(ISecurityPoolFactory _factory, ISecurityPool initialOriginPool, uint256 _maximumQuestionHorizonSeconds) {
		require(_maximumQuestionHorizonSeconds > 0 && _maximumQuestionHorizonSeconds <= type(uint48).max, 'Invalid question horizon');
		maximumQuestionHorizonSeconds = _maximumQuestionHorizonSeconds;
		require(address(_factory).code.length > 0, 'Factory has no code');
		require(address(initialOriginPool).code.length > 0, 'Pool has no code');
		factory = _factory;
		zoltar = initialOriginPool.zoltar();
		originUniverseId = initialOriginPool.universeId();
		repToken = IERC20(address(initialOriginPool.repToken()));
		vaultDeployer = new SecurityPoolPortfolioVaultDeployer();
		quoteHelper = new SecurityPoolPortfolioQuote();
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

	function isPositionSourceForPool(address source, address pool) external view returns (bool) {
		return pool != address(0) && positionSourcePools[source] == pool;
	}

	function positionCount() external view returns (uint256) {
		return snapshotCounter;
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

	/// @notice Only accounted idle REP belongs to current reserve shares.
	function totalAssets() public view returns (uint256) {
		return idleRepAttoRep;
	}

	/// @notice Join the idle reserve and future allocations, without acquiring existing positions.
	function deposit(uint256 amountAttoRep, uint256 minimumShares) external nonReentrant returns (uint256 mintedShares) {
		require(amountAttoRep > 0, 'Deposit amount zero');
		require(zoltar.getForkTime(originUniverseId) == 0, 'Universe already forked');
		mintedShares = totalSupply == 0 ? amountAttoRep : Math.mulDiv(amountAttoRep, totalSupply, idleRepAttoRep);
		require(mintedShares > 0 && mintedShares >= minimumShares, 'Minimum pool shares not met');
		require(mintedShares <= MAX_POOL_SHARES - totalSupply, 'Pool share precision exhausted');
		_settleOwnerFees(msg.sender);
		_checkpointOwner(msg.sender);
		ownershipVersion++;
		shareBalances[shareGeneration][msg.sender] += mintedShares;
		totalSupply += mintedShares;
		idleRepAttoRep += amountAttoRep;
		repToken.safeTransferFrom(msg.sender, address(this), amountAttoRep);
		_createVault(msg.sender);
		emit Deposited(msg.sender, amountAttoRep, mintedShares, shareGeneration);
	}

	/// @notice Return proportional idle REP. Existing allocations remain separate historical rights.
	function withdraw(uint256 shares, uint256 minimumIdleAttoRep) external nonReentrant returns (uint256 returnedAttoRep) {
		require(shares > 0 && shares <= balanceOf(msg.sender), 'Invalid share withdrawal');
		_settleOwnerFees(msg.sender);
		_checkpointOwner(msg.sender);
		returnedAttoRep = Math.mulDiv(idleRepAttoRep, shares, totalSupply);
		require(returnedAttoRep >= minimumIdleAttoRep, 'Minimum idle REP not met');
		ownershipVersion++;
		shareBalances[shareGeneration][msg.sender] -= shares;
		totalSupply -= shares;
		idleRepAttoRep -= returnedAttoRep;
		if (returnedAttoRep > 0) repToken.safeTransfer(msg.sender, returnedAttoRep);
		emit Withdrawn(msg.sender, shares, returnedAttoRep, shareGeneration);
	}

	function reusablePositionId(uint256 questionId) public view returns (uint256) {
		uint256 positionId = reusablePositions[questionId];
		return isReusablePosition(positionId) ? positionId : 0;
	}

	function isReusablePosition(uint256 positionId) public view returns (bool) {
		Position storage position = positions[positionId];
		return
			positionId != 0 &&
			reusablePositions[position.questionId] == positionId &&
			!_hasEnded(position.custody.pool());
	}

	/// @notice Maintain one live allocation. Historical owners retain released REP and fees in custody.
	function rebalancePosition(uint256 positionId) external nonReentrant {
		Position storage position = positions[positionId];
		require(address(position.custody) != address(0), 'Unknown allocation position');
		_requireEligible(position.custody.pool(), position.questionId);
		_rebalancePosition(positionId);
	}

	function _rebalancePosition(uint256 positionId) private {
		(uint256 repReturned, uint256 feesReturned) = positions[positionId].custody.rebalance(isReusablePosition(positionId) && positionVersions[positionId] == ownershipVersion);
		idleRepAttoRep += repReturned;
		_creditFees(feesReturned);
		emit PositionRebalanced(positionId, repReturned, feesReturned);
	}

	function _createPosition(uint256 questionId, ISecurityPool pool) private returns (uint256 positionId) {
		positionId = ++snapshotCounter;
		snapshotGenerations[positionId] = shareGeneration;
		SecurityPoolPortfolioPosition custody = new SecurityPoolPortfolioPosition(address(this), pool, quoteHelper);
		positionSourcePools[address(custody)] = address(pool);
		positions[positionId] = Position(questionId, totalSupply, totalSupply, custody);
		positionVersions[positionId] = ownershipVersion;
		reusablePositions[questionId] = positionId;
		emit PositionAllocated(questionId, positionId, custody, totalSupply, shareGeneration);
	}

	function _closeReserveIfNeeded(uint256 positionId) private {
		if (totalSupply == 0) return;
		if (idleRepAttoRep > 0) {
			// Allocation is the only operation that reduces reserve REP per share. Keep room
			// for the protocol's entire possible REP supply to join without exhausting precision.
			if (Math.mulDiv(Constants.MAX_ATTO_REP, totalSupply, idleRepAttoRep) <= MAX_POOL_SHARES - totalSupply)
				return;
			uint256 residual = idleRepAttoRep;
			idleRepAttoRep = 0;
			// These owners and weights still match the just-funded allocation. Preserve their
			// residual as liquid custody REP; it is neither new underwriting nor a donation.
			repToken.safeTransfer(address(positions[positionId].custody), residual);
			emit ReservePrecisionRolledOver(positionId, shareGeneration, residual);
		}
		closedFeeIndexes[shareGeneration] = feeIndex;
		shareGeneration++;
		ownershipVersion++;
		totalSupply = 0;
		feeIndex = 0;
		emit ShareGenerationStarted(shareGeneration);
	}

	function quoteMint(uint256 questionId, uint256 mintAttoEth) external view returns (uint256 depositAttoRep, uint256 reservationFeeAttoEth, uint256 availableAttoRep) {
		ISecurityPool pool = getPool(questionId, originUniverseId);
		_requireEligible(pool, questionId);
		require(mintAttoEth > 0, 'Mint collateral not funded');
		SecurityPoolPortfolioQuote.MintPlan memory plan = _mintPlan(pool, mintAttoEth, reusablePositionId(questionId), true);
		return (plan.depositAttoRep, plan.feeAttoEth, plan.availableAttoRep);
	}

	function _mintPlan(ISecurityPool pool, uint256 mintAttoEth, uint256 positionId, bool previewRebalance) private view returns (SecurityPoolPortfolioQuote.MintPlan memory) {
		return
			quoteHelper.mintPlan(pool, address(positions[positionId].custody), mintAttoEth, idleRepAttoRep, positionId == 0 || positionVersions[positionId] == ownershipVersion, previewRebalance);
	}

	/// @notice Buy complete sets using selected-question capital or a new allocation from the reserve.
	function createCompleteSet(uint256 questionId, address recipient, uint256 minimumShares, uint256 mintAttoEth) external payable nonReentrant {
		require(mintAttoEth > 0 && msg.value >= mintAttoEth, 'Mint collateral not funded');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		ISecurityPool pool = addQuestion(questionId);
		_requireEligible(pool, questionId);
		uint256 feeAttoEth = _allocateForMint(questionId, pool, mintAttoEth, msg.value - mintAttoEth);
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

	function _allocateForMint(uint256 questionId, ISecurityPool pool, uint256 mintAttoEth, uint256 feeBudget) private returns (uint256 feeAttoEth) {
		uint256 positionId = reusablePositionId(questionId);
		if (positionId != 0) _rebalancePosition(positionId);
		pool.updateSettlementCollateral();
		SecurityPoolPortfolioQuote.MintPlan memory plan = _mintPlan(pool, mintAttoEth, positionId, false);
		feeAttoEth = plan.feeAttoEth;
		require(feeAttoEth <= feeBudget, 'Reservation fee exceeds budget');
		require(plan.depositAttoRep <= plan.availableAttoRep, 'Insufficient aggregate backing');
		if (feeAttoEth == 0) return 0;
		if (plan.reserveFunded) require(totalSupply > 0, 'No underwriting capital');
		if (!plan.reusePosition) positionId = _createPosition(questionId, pool);
		SecurityPoolPortfolioPosition custody = positions[positionId].custody;
		if (plan.reserveFunded && plan.depositAttoRep > 0) {
			idleRepAttoRep -= plan.depositAttoRep;
			repToken.safeTransfer(address(custody), plan.depositAttoRep);
		}
		custody.allocate(plan.depositAttoRep, plan.nextCommitment);
		if (plan.reserveFunded) {
			_creditFees(feeAttoEth);
			_closeReserveIfNeeded(positionId);
		} else _sendEth(address(custody), feeAttoEth);
	}

	function getOwnerPositionShares(uint256 positionId, address owner) public view returns (uint256) {
		Position storage position = positions[positionId];
		if (address(position.custody) == address(0) || positionClaimed[positionId][owner]) return 0;
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
		uint256 shares = getOwnerPositionShares(positionId, owner);
		require(shares > 0, 'No allocation position');
		require(msg.sender == owner || !isReusablePosition(positionId), 'Only owner can claim reusable position');
		Position storage position = positions[positionId];
		uint256 denominator = position.remainingShares;
		position.remainingShares -= shares;
		positionClaimed[positionId][owner] = true;
		// Only this allocation closes; the owner's action leaves other questions' custody reusable.
		if (reusablePositions[position.questionId] == positionId) delete reusablePositions[position.questionId];
		SecurityPoolPortfolioVault vault = _createVault(owner);
		position.custody.release(address(vault), shares, denominator);
		emit QuestionPositionClaimed(positionId, owner, vault, shares);
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
			zoltar.getForkTime(originUniverseId) != 0;
	}

	function _originId(uint256 questionId) private view returns (bytes32) {
		return
			factory.getPortfolioOriginId(address(this), originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _requireEligible(ISecurityPool pool, uint256 questionId) private view {
		uint256 end = pool.questionData().getQuestionEndDate(questionId);
		require(block.timestamp < end, 'Question has already ended');
		require(end - block.timestamp <= maximumQuestionHorizonSeconds, 'Question exceeds pool horizon');
		require(zoltar.getForkTime(originUniverseId) == 0, 'Universe already forked');
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

	/// @dev Only proceeds returned by a reusable position with current owners enter the reserve fee index.
	receive() external payable {}
}
