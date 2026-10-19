// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Constants } from '../Constants.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolPortfolioVaultDeployer } from './SecurityPoolPortfolioVaultDeployer.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';
import { SecurityPoolPortfolioRecovery } from './SecurityPoolPortfolioRecovery.sol';
import { SecurityPoolPortfolioForkController } from './SecurityPoolPortfolioForkController.sol';
import { SecurityPoolPortfolioState } from './SecurityPoolPortfolioState.sol';
import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Common idle REP reserve with allocation-time ownership of each question position.
/// @dev Reserve shares own idle REP and future allocations. Existing positions retain their owners,
/// fees and obligations; they can be materialized independently without visiting other questions.
contract SecurityPoolPortfolio is SecurityPoolPortfolioState, ISecurityPoolPortfolio {
	using SafeERC20Ops for IERC20;

	uint256 private constant MAX_QUESTION_PAGE = 64;
	uint256 private constant FEE_PRECISION = 1e36;
	uint256 private constant MAX_POOL_SHARES = FEE_PRECISION;
	ISecurityPoolQuestionAdmissionPolicy public immutable questionAdmissionPolicy;
	uint256 public immutable targetHealthFactorBps;
	uint256 public immutable purchaseFeeBps;
	uint256 public immutable minimumPurchaseFeeAttoEth;
	uint256 public immutable completionRewardAttoEth;
	uint256 public immutable ownershipChangeFeeAttoEth;
	ISecurityPoolFactory public immutable factory;
	uint248 public immutable originUniverseId;
	uint256 public immutable statoblastSecurityMultiplierBps;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	IERC20 public immutable repToken;
	SecurityPoolPortfolioVaultDeployer public immutable vaultDeployer;
	SecurityPoolPortfolioQuote public immutable quoteHelper;
	SecurityPoolPortfolioRecovery public immutable recoveryLedger;
	address public immutable forkController;
	Zoltar private immutable zoltar;

	constructor(ISecurityPoolFactory _factory, ISecurityPool initialOriginPool, uint256 _maximumQuestionHorizonSeconds, SecurityPoolPortfolioVaultDeployer _vaultDeployer, ISecurityPoolQuestionAdmissionPolicy _questionAdmissionPolicy, EconomicsConfig memory config) {
		require(address(_questionAdmissionPolicy).code.length > 0, 'Admission policy has no code');
		require(config.targetHealthFactorBps >= 10_000, 'Health factor below native floor');
		require(config.purchaseFeeBps <= 10_000, 'Purchase fee exceeds 100 percent');
		require(config.minimumPurchaseFeeAttoEth >= config.completionRewardAttoEth, 'Purchase fee does not fund completion');
		require(config.ownershipChangeFeeAttoEth == 0 || config.completionRewardAttoEth > 0, 'Ownership fee needs completion reward');
		questionAdmissionPolicy = _questionAdmissionPolicy;
		targetHealthFactorBps = config.targetHealthFactorBps;
		purchaseFeeBps = config.purchaseFeeBps;
		minimumPurchaseFeeAttoEth = config.minimumPurchaseFeeAttoEth;
		completionRewardAttoEth = config.completionRewardAttoEth;
		ownershipChangeFeeAttoEth = config.ownershipChangeFeeAttoEth;
		require(_maximumQuestionHorizonSeconds > 0 && _maximumQuestionHorizonSeconds <= type(uint48).max, 'Invalid question horizon');
		maximumQuestionHorizonSeconds = _maximumQuestionHorizonSeconds;
		require(address(_factory).code.length > 0, 'Factory has no code');
		require(address(initialOriginPool).code.length > 0, 'Pool has no code');
		factory = _factory;
		zoltar = initialOriginPool.zoltar();
		originUniverseId = initialOriginPool.universeId();
		repToken = IERC20(address(initialOriginPool.repToken()));
		require(address(_vaultDeployer).code.length > 0, 'Vault deployer has no code');
		vaultDeployer = _vaultDeployer;
		quoteHelper = _vaultDeployer.helpers().createQuote(config.targetHealthFactorBps, config.purchaseFeeBps, config.minimumPurchaseFeeAttoEth);
		recoveryLedger = _vaultDeployer.helpers().createRootRecovery();
		forkController = address(new SecurityPoolPortfolioForkController(initialOriginPool, recoveryLedger, quoteHelper, _vaultDeployer.helpers()));
		statoblastSecurityMultiplierBps = initialOriginPool.statoblastSecurityMultiplierBps();
		initialReportPriorityFeeAttoEthPerGas = initialOriginPool.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		bytes32 seedOriginId = _factory.getSecurityPoolOriginId(initialOriginPool);
		require(address(initialOriginPool.parent()) == address(0), 'Choose an origin pool');
		require(address(initialOriginPool.securityPoolFactory()) == address(_factory), 'Pool factory mismatch');
		require(address(_factory.getSecurityPool(seedOriginId, originUniverseId)) == address(initialOriginPool), 'Pool is not canonical');
		quoteHelper.requireEligible(initialOriginPool, initialOriginPool.questionId(), originUniverseId, maximumQuestionHorizonSeconds);
		_factory.initializePortfolioPriceFeed(initialOriginPool);
	}

	modifier nonReentrant() {
		require(!entered, 'Portfolio operation active');
		entered = true;
		_;
		entered = false;
	}

	modifier onlyForkController() {
		require(msg.sender == forkController, 'Only fork controller');
		_;
	}

	function addQuestion(uint256 questionId) public returns (ISecurityPool pool) {
		_requireQuestionAllowed(questionId);
		bytes32 registeredOrigin = questionOriginIds[questionId];
		if (registeredOrigin != bytes32(0)) return factory.getSecurityPool(registeredOrigin, originUniverseId);
		bytes32 originId = factory.getPortfolioOriginId(address(this), originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		pool = factory.getSecurityPool(originId, originUniverseId);
		if (address(pool) == address(0)) {
			pool = factory.deployPortfolioSecurityPool(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		}
		quoteHelper.requireEligible(pool, questionId, originUniverseId, maximumQuestionHorizonSeconds);
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
		return
			pool != address(0) &&
			(positionSourcePools[source] == pool ||
				SecurityPoolPortfolioForkController(payable(forkController)).isPositionSourceForPool(source, pool));
	}

	function getForkPosition(uint256 positionId) external view returns (address custody, uint256 remainingShares, uint256 unmigratedShares, bool complete) {
		Position storage position = positions[positionId];
		require(address(position.custody) != address(0), 'Unknown allocation position');
		return (
			address(position.custody),
			position.remainingShares,
			position.remainingShares - sharedMigratedShares[positionId],
			positionRecoveryComplete[positionId]
		);
	}

	function createForkVault(address owner) external onlyForkController returns (SecurityPoolPortfolioVault) {
		return _createVault(owner);
	}

	function collectForkPosition(uint256 positionId) external onlyForkController nonReentrant {
		(uint256 rep, uint256 fees) = positions[positionId].custody.collect();
		_creditRecovery(positionId, rep, fees);
	}

	/// @dev Called only after the migration has returned and credited all final parent cash.
	function finalizeForkPosition(uint256 positionId) external onlyForkController {
		_closeForkedGeneration();
		if (positionRecoveryComplete[positionId]) recoveryLedger.markPositionComplete(positionId);
	}

	function recoverForkPosition(uint256 positionId, address processor) external onlyForkController nonReentrant {
		_recoverPosition(positionId, processor);
	}

	/// @dev Shared migration changes physical backing ownership, preserving the source cash denominator.
	function releaseForkPosition(uint256 positionId, address recipient, uint256 shares, address processor) external onlyForkController nonReentrant {
		Position storage position = positions[positionId];
		uint256 denominator = position.remainingShares - sharedMigratedShares[positionId];
		require(shares > 0 && shares <= denominator, 'Invalid shared position fraction');
		(uint256 rep, uint256 fees) = position.custody.collect();
		_creditRecovery(positionId, rep, fees);
		sharedMigratedShares[positionId] += shares;
		position.custody.release(recipient, shares, denominator);
		if (shares == denominator) {
			positionRecoveryComplete[positionId] = true;
			_creditRecoveryReward(positionId, processor);
		}
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
	function deposit(uint256 amountAttoRep, uint256 minimumShares) external payable nonReentrant returns (uint256 mintedShares) {
		_chargeOwnershipChangeFee(false);
		mintedShares = _deposit(msg.sender, amountAttoRep, minimumShares);
		repToken.safeTransferFrom(msg.sender, address(this), amountAttoRep);
	}

	function _deposit(address owner, uint256 amountAttoRep, uint256 minimumShares) private returns (uint256 mintedShares) {
		require(amountAttoRep > 0, 'Deposit amount zero');
		require(zoltar.getForkTime(originUniverseId) == 0, 'Universe already forked');
		mintedShares = totalSupply == 0 ? amountAttoRep : Math.mulDiv(amountAttoRep, totalSupply, idleRepAttoRep);
		require(mintedShares > 0 && mintedShares >= minimumShares, 'Minimum pool shares not met');
		require(mintedShares <= MAX_POOL_SHARES - totalSupply, 'Pool share precision exhausted');
		_settleOwnerFees(owner);
		_checkpointOwner(owner);
		shareBalances[shareGeneration][owner] += mintedShares;
		ownershipVersion = recoveryLedger.setOwnerBalance(owner, shareGeneration, balanceOf(owner));
		totalSupply += mintedShares;
		idleRepAttoRep += amountAttoRep;
		_createVault(owner);
		emit Deposited(owner, amountAttoRep, mintedShares, shareGeneration);
	}

	/// @notice Return proportional idle REP. A full exit never requires an ownership-change fee.
	function withdraw(uint256 shares, uint256 minimumIdleAttoRep) external payable nonReentrant returns (uint256 returnedAttoRep) {
		uint256 ownerBalance = balanceOf(msg.sender);
		require(shares > 0 && shares <= ownerBalance, 'Invalid share withdrawal');
		_chargeOwnershipChangeFee(shares == ownerBalance);
		_settleOwnerFees(msg.sender);
		_checkpointOwner(msg.sender);
		returnedAttoRep = Math.mulDiv(idleRepAttoRep, shares, totalSupply);
		require(returnedAttoRep >= minimumIdleAttoRep, 'Minimum idle REP not met');
		shareBalances[shareGeneration][msg.sender] -= shares;
		ownershipVersion = recoveryLedger.setOwnerBalance(msg.sender, shareGeneration, balanceOf(msg.sender));
		totalSupply -= shares;
		idleRepAttoRep -= returnedAttoRep;
		if (returnedAttoRep > 0) repToken.safeTransfer(msg.sender, returnedAttoRep);
		emit Withdrawn(msg.sender, shares, returnedAttoRep, shareGeneration);
	}

	/// @notice Fee for a deposit or partial withdrawal now; full withdrawals always cost zero.
	function quoteOwnershipChangeFee() public view returns (uint256) {
		return
			recoveryLedger.unfinishedPositionCount() > 0 && zoltar.getForkTime(originUniverseId) == 0
				? ownershipChangeFeeAttoEth
				: 0;
	}

	function _chargeOwnershipChangeFee(bool fullExit) private {
		uint256 fee = fullExit ? 0 : quoteOwnershipChangeFee();
		require(msg.value >= fee, 'Ownership change fee not funded');
		maintenanceBudgetAttoEth += fee;
		if (fee > 0) {
			recoveryLedger.creditMaintenance(fee);
			emit OwnershipChangeFeePaid(msg.sender, fee);
		}
		_sendEth(msg.sender, msg.value - fee);
	}

	function reusablePositionId(uint256 questionId) public view returns (uint256) {
		uint256 positionId = reusablePositions[questionId];
		return isReusablePosition(positionId) ? positionId : 0;
	}

	function isReusablePosition(uint256 positionId) public view returns (bool) {
		Position storage position = positions[positionId];
		return
			positionId != 0 &&
			position.remainingShares > 0 &&
			!positionRecoveryComplete[positionId] &&
			reusablePositions[position.questionId] == positionId &&
			!_hasEnded(position.custody.pool());
	}

	/// @notice Recover one allocation for all its owners. Each owner collects across personal intervals.
	function rebalancePosition(uint256 positionId) external nonReentrant {
		Position storage position = positions[positionId];
		require(address(position.custody) != address(0), 'Unknown allocation position');
		require(position.remainingShares > 0, 'Allocation fully transferred');
		_recoverPosition(positionId, msg.sender);
	}

	function _recoverPosition(uint256 positionId, address processor) private {
		_recoverPosition(positionId, processor, false);
	}

	/// @notice Release safe surplus to matching reserve owners, otherwise credit historical owners.
	function recyclePosition(uint256 positionId) external nonReentrant {
		_recoverPosition(positionId, msg.sender, true);
	}

	function _recoverPosition(uint256 positionId, address processor, bool recycle) private {
		_closeForkedGeneration();
		Position storage position = positions[positionId];
		require(address(position.custody) != address(0), 'Unknown allocation position');
		// Another owner may have completed recovery or taken the last position since review.
		if (positionRecoveryComplete[positionId] || position.remainingShares == 0) return;
		(uint256 rep, uint256 fees, bool complete) = position.custody.recover();
		if (recycle && positionVersions[positionId] == ownershipVersion && totalSupply > 0) {
			idleRepAttoRep += rep;
			_creditFees(fees);
			emit PositionRebalanced(positionId, rep, fees);
		} else _creditRecovery(positionId, rep, fees);
		if (complete && !positionRecoveryComplete[positionId]) {
			positionRecoveryComplete[positionId] = true;
			if (reusablePositions[position.questionId] == positionId) delete reusablePositions[position.questionId];
			recoveryLedger.markPositionComplete(positionId);
			_creditRecoveryReward(positionId, processor);
		}
		emit PositionRecovered(positionId, rep, fees, complete);
	}

	function _rebalancePosition(uint256 positionId) private {
		(uint256 repReturned, uint256 feesReturned) = positions[positionId].custody.rebalance(isReusablePosition(positionId) && positionVersions[positionId] == ownershipVersion);
		idleRepAttoRep += repReturned;
		_creditFees(feesReturned);
		emit PositionRebalanced(positionId, repReturned, feesReturned);
	}

	function _createPosition(uint256 questionId, ISecurityPool pool) private returns (uint256 positionId) {
		positionId = recoveryLedger.appendPosition();
		positionCount = positionId;
		snapshotGenerations[positionId] = shareGeneration;
		SecurityPoolPortfolioPosition custody = vaultDeployer.helpers().createPosition(pool, quoteHelper, ISecurityPool(payable(address(0))), address(0));
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
		ownershipVersion = recoveryLedger.closeGeneration(shareGeneration);
		shareGeneration++;
		totalSupply = 0;
		feeIndex = 0;
		emit ShareGenerationStarted(shareGeneration);
	}

	function quoteMint(uint256 questionId, uint256 mintAttoEth) external view returns (uint256 depositAttoRep, uint256 purchaseFeeAttoEth, uint256 availableAttoRep) {
		ISecurityPool pool = getPool(questionId, originUniverseId);
		_requireQuestionAllowed(questionId);
		quoteHelper.requireEligible(pool, questionId, originUniverseId, maximumQuestionHorizonSeconds);
		require(mintAttoEth > 0, 'Mint collateral not funded');
		SecurityPoolPortfolioQuote.MintPlan memory plan = _mintPlan(pool, mintAttoEth, reusablePositionId(questionId), true);
		return (plan.depositAttoRep, plan.feeAttoEth, plan.availableAttoRep);
	}

	function _mintPlan(ISecurityPool pool, uint256 mintAttoEth, uint256 positionId, bool previewRebalance) private view returns (SecurityPoolPortfolioQuote.MintPlan memory) {
		require(totalSupply > 0 || positionId != 0, 'No portfolio capital');
		return
			quoteHelper.mintPlan(pool, address(positions[positionId].custody), mintAttoEth, idleRepAttoRep, positionId == 0 || positionVersions[positionId] == ownershipVersion, previewRebalance);
	}

	/// @notice Buy complete sets using selected-question capital or a new allocation from the reserve.
	function createCompleteSet(uint256 questionId, address recipient, uint256 minimumShares, uint256 mintAttoEth) external payable nonReentrant {
		require(mintAttoEth > 0 && msg.value >= mintAttoEth, 'Mint collateral not funded');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		ISecurityPool pool = addQuestion(questionId);
		quoteHelper.requireEligible(pool, questionId, originUniverseId, maximumQuestionHorizonSeconds);
		uint256 feeAttoEth = _allocateForMint(questionId, pool, mintAttoEth, msg.value - mintAttoEth);
		uint256 minted = quoteHelper.buyCompleteSets{value: mintAttoEth}(pool, recipient, minimumShares);
		emit CompleteSetsFunded(questionId, msg.sender, recipient, mintAttoEth, minted);
		emit PurchaseFeesPaid(questionId, msg.sender, feeAttoEth);
		_sendEth(msg.sender, msg.value - mintAttoEth - feeAttoEth);
	}

	function _allocateForMint(uint256 questionId, ISecurityPool pool, uint256 mintAttoEth, uint256 feeBudget) private returns (uint256 feeAttoEth) {
		uint256 positionId = reusablePositionId(questionId);
		if (positionId != 0) _rebalancePosition(positionId);
		pool.updateSettlementCollateral();
		SecurityPoolPortfolioQuote.MintPlan memory plan = _mintPlan(pool, mintAttoEth, positionId, false);
		feeAttoEth = plan.feeAttoEth;
		require(feeAttoEth <= feeBudget, 'Purchase fee exceeds budget');
		require(plan.depositAttoRep <= plan.availableAttoRep, 'Insufficient aggregate backing');
		uint256 ownersFee = feeAttoEth;
		if (plan.needsCommitment) {
			if (plan.reserveFunded) require(totalSupply > 0, 'No underwriting capital');
			if (!plan.reusePosition) {
				positionId = _createPosition(questionId, pool);
				recoveryBounties[positionId] = completionRewardAttoEth;
				ownersFee -= completionRewardAttoEth;
			}
			SecurityPoolPortfolioPosition custody = positions[positionId].custody;
			if (plan.reserveFunded && plan.depositAttoRep > 0) {
				idleRepAttoRep -= plan.depositAttoRep;
				repToken.safeTransfer(address(custody), plan.depositAttoRep);
			}
			custody.allocate(plan.depositAttoRep, plan.nextCommitment);
		}
		if (positionId != 0 && positionVersions[positionId] != ownershipVersion)
			_creditRecovery(positionId, 0, ownersFee);
		else _creditFees(ownersFee);
		if (plan.needsCommitment && plan.reserveFunded) _closeReserveIfNeeded(positionId);
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

	/// @notice Opt into individual control of one allocation; only the owner can split its recovery history.
	function claimPosition(uint256 positionId, uint256 intervalId) external nonReentrant {
		_claimPosition(msg.sender, positionId, intervalId);
	}

	/// @notice Take individual ownership and choose a prepared fork branch in one owner transaction.
	function claimPositionAndMigrate(uint256 positionId, uint256 intervalId, uint256 outcomeIndex) external nonReentrant {
		_claimPositionAndMigrate(msg.sender, positionId, intervalId, outcomeIndex);
	}

	function claimForkPosition(address owner, uint256 positionId, uint256 intervalId, bool migrate, uint256 outcomeIndex) external onlyForkController nonReentrant {
		if (migrate) _claimPositionAndMigrate(owner, positionId, intervalId, outcomeIndex);
		else _claimPosition(owner, positionId, intervalId);
	}

	function _claimPositionAndMigrate(address owner, uint256 positionId, uint256 intervalId, uint256 outcomeIndex) private {
		Position storage position = positions[positionId];
		require(address(position.custody) != address(0), 'Unknown allocation position');
		ISecurityPool parent = position.custody.pool();
		require(parent.systemState() == SystemState.PoolForked, 'Question pool not forked');
		SecurityPoolPortfolioVault vault = _createVault(owner);
		(uint256 units, uint256 commitment, , ) = parent.securityVaults(address(vault));
		require(units == 0 && commitment == 0 && parent.vaultBadDebtAttoEth(address(vault)) == 0, 'Migrate existing question position first');
		require(address(parent.escalationGame()) == address(0) || parent.escalationGame().disputeStakedRepByVaultAttoRep(address(vault)) == 0, 'Migrate existing dispute position first');
		_claimPosition(owner, positionId, intervalId);
		vault.migrateClaimedPosition(parent, outcomeIndex);
	}

	function _claimPosition(address owner, uint256 positionId, uint256 intervalId) private {
		_closeForkedGeneration();
		require(!SecurityPoolPortfolioForkController(payable(forkController)).isIntervalSelected(0, owner, intervalId), 'Interval has shared fork choice');
		uint256 shares = getOwnerPositionShares(positionId, owner);
		require(shares > 0, 'No allocation position');
		require(!positionRecoveryComplete[positionId], 'Allocation already recovered');
		Position storage position = positions[positionId];
		(uint256 rep, uint256 fees) = position.custody.collect();
		_creditRecovery(positionId, rep, fees);
		require(recoveryLedger.excludePosition(owner, intervalId, positionId) == shares, 'Owner interval shares mismatch');
		uint256 denominator = position.remainingShares - sharedMigratedShares[positionId];
		position.remainingShares -= shares;
		positionClaimed[positionId][owner] = true;
		// Remaining owners can reuse their capital, but cannot mix it with current reserve shares.
		positionVersions[positionId] = 0;
		if (position.remainingShares == sharedMigratedShares[positionId]) {
			positionRecoveryComplete[positionId] = true;
			if (reusablePositions[position.questionId] == positionId) delete reusablePositions[position.questionId];
			_creditRecoveryReward(positionId, owner);
		}
		SecurityPoolPortfolioVault vault = _createVault(owner);
		position.custody.release(address(vault), shares, denominator);
		if (positionRecoveryComplete[positionId]) recoveryLedger.markPositionComplete(positionId);
		emit QuestionPositionClaimed(positionId, owner, vault, shares);
	}

	function _creditRecovery(uint256 positionId, uint256 rep, uint256 fees) private {
		if (rep == 0 && fees == 0) return;
		recoveredRepAttoRep += rep;
		recoveredFeesAttoEth += fees;
		recoveryLedger.credit(positionId, rep, fees, positions[positionId].remainingShares);
	}

	function _creditRecoveryReward(uint256 positionId, address processor) private {
		uint256 amount = recoveryBounties[positionId];
		if (amount == 0) return;
		delete recoveryBounties[positionId];
		uint256 supplement = recoveryLedger.takeMaintenanceReward(positionId, completionRewardAttoEth);
		maintenanceBudgetAttoEth -= supplement;
		processingRewards[processor] += amount + supplement;
		emit RecoveryRewardCredited(positionId, processor, amount);
		if (supplement > 0) emit MaintenanceRewardCredited(positionId, processor, supplement);
	}

	/// @notice Recover selected allocations for all owners, then collect the caller's proceeds and fees.
	/// @dev Empty positionIds collects already released proceeds. Both lists are caller-sized; no registry scan.
	function claimRecovered(uint256[] calldata intervalIds, uint256[] calldata positionIds) external nonReentrant {
		(uint256 rep, uint256 fees, bool retired) = _collectRecovery(intervalIds, positionIds);
		require(rep > 0 || fees > 0 || retired, 'No recovered proceeds');
		if (rep > 0) repToken.safeTransfer(msg.sender, rep);
		_sendEth(msg.sender, fees);
		emit RecoveryCollected(msg.sender, rep, fees);
	}

	/// @notice Owner-authorized reinvestment at the current idle-reserve exchange rate.
	function claimRecoveredAndDeposit(uint256[] calldata intervalIds, uint256[] calldata positionIds, uint256 minimumShares) external payable nonReentrant returns (uint256 mintedShares) {
		(uint256 rep, uint256 fees, ) = _collectRecovery(intervalIds, positionIds);
		_chargeOwnershipChangeFee(false);
		mintedShares = _deposit(msg.sender, rep, minimumShares);
		_sendEth(msg.sender, fees);
		emit RecoveryCollected(msg.sender, rep, fees);
		emit RecoveryRedeposited(msg.sender, rep, mintedShares);
	}

	function _collectRecovery(uint256[] calldata intervalIds, uint256[] calldata positionIds) private returns (uint256 rep, uint256 fees, bool retired) {
		_closeForkedGeneration();
		for (uint256 index; index < positionIds.length; index++) _recoverPosition(positionIds[index], msg.sender);
		(rep, fees, retired) = recoveryLedger.claim(msg.sender, intervalIds);
		recoveredRepAttoRep -= rep;
		recoveredFeesAttoEth -= fees;
		_settleOwnerFees(msg.sender);
		fees += ownerFees[msg.sender].accruedAttoEth + processingRewards[msg.sender];
		ownerFees[msg.sender].accruedAttoEth = 0;
		processingRewards[msg.sender] = 0;
	}

	function _closeForkedGeneration() private {
		if (zoltar.getForkTime(originUniverseId) != 0)
			ownershipVersion = recoveryLedger.closeGeneration(shareGeneration);
	}

	function _checkpointOwner(address owner) private {
		if (positionCount == 0) return;
		Checkpoint[] storage checkpoints = balanceCheckpoints[shareGeneration][owner];
		if (checkpoints.length == 0 || checkpoints[checkpoints.length - 1].snapshotId < positionCount)
			checkpoints.push(Checkpoint(positionCount, balanceOf(owner)));
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

	function _requireQuestionAllowed(uint256 questionId) private view {
		require(questionAdmissionPolicy.isQuestionAllowed(address(this), originUniverseId, questionId), 'Question rejected by admission policy');
	}
}
