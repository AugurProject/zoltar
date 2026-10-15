// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioVault, ISecurityPoolPortfolio } from './SecurityPoolPortfolioVault.sol';
import { IERC20 } from '../IERC20.sol';
import { IERC1155 } from './interfaces/IERC1155.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolPortfolioVaultDeployer } from './SecurityPoolPortfolioVaultDeployer.sol';

/// @notice Groups canonical question ledgers and creates independently owned underwriting accounts.
/// @dev Membership grants no claim on capital. Active owner accounts automatically back paid minting;
/// collateral, fees, dispute stakes and repair inventory remain in their existing question ledgers.
/// Different questions may have different dates. Registration never extends an existing commitment.
contract SecurityPoolPortfolio is ISecurityPoolPortfolio, IERC1155Receiver {
	uint256 public constant MAX_QUESTION_PAGE = 64;
	ISecurityPoolFactory public immutable factory;
	uint248 public immutable originUniverseId;
	uint256 public immutable statoblastSecurityMultiplierBps;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	IERC20 public immutable repToken;
	SecurityPoolPortfolioVaultDeployer public immutable vaultDeployer;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => SecurityPoolPortfolioVault) public vaultOf;
	uint256[] private questions;
	bool private entered;
	WithdrawalRequest[] private withdrawalRequests;

	struct Contribution {
		SecurityPoolPortfolioVault vault;
		uint256 maximumCommitmentIncreaseAttoEth;
	}

	struct WithdrawalRequest {
		SecurityPoolPortfolioVault vault;
		uint256 requestId;
	}

	event QuestionRegistered(uint256 indexed questionId, bytes32 indexed originId, ISecurityPool indexed originPool);
	event VaultCreated(address indexed owner, SecurityPoolPortfolioVault indexed vault);
	event CompleteSetsFunded(uint256 indexed questionId, address indexed payer, address indexed recipient, uint256 amountAttoEth, uint256 mintedAttoShares);
	event ReservationFeesPaid(uint256 indexed questionId, address indexed payer, uint256 feesAttoEth);
	event WithdrawalQueued(uint256 indexed index, SecurityPoolPortfolioVault indexed vault, uint256 requestId);

	/// @param initialOriginPool A canonical origin ledger used only as the immutable configuration seed.
	constructor(ISecurityPoolFactory _factory, ISecurityPool initialOriginPool, uint256 _maximumQuestionHorizonSeconds) {
		require(_maximumQuestionHorizonSeconds > 0 && _maximumQuestionHorizonSeconds <= type(uint48).max, 'Invalid question horizon');
		maximumQuestionHorizonSeconds = _maximumQuestionHorizonSeconds;
		require(address(_factory).code.length > 0, 'Factory has no code');
		require(address(initialOriginPool).code.length > 0, 'Pool has no code');
		factory = _factory;
		originUniverseId = initialOriginPool.universeId();
		repToken = IERC20(address(initialOriginPool.repToken()));
		vaultDeployer = new SecurityPoolPortfolioVaultDeployer();
		statoblastSecurityMultiplierBps = initialOriginPool.statoblastSecurityMultiplierBps();
		initialReportPriorityFeeAttoEthPerGas = initialOriginPool.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		uint256 questionId = initialOriginPool.questionId();
		bytes32 seedOriginId = _factory.getSecurityPoolOriginId(initialOriginPool);
		require(address(initialOriginPool.parent()) == address(0), 'Choose an origin pool');
		require(address(initialOriginPool.securityPoolFactory()) == address(_factory), 'Pool factory mismatch');
		require(address(_factory.getSecurityPool(seedOriginId, originUniverseId)) == address(initialOriginPool), 'Pool is not canonical');
		_requireEligible(initialOriginPool, questionId);
		_factory.initializePortfolioPriceFeed(initialOriginPool);
	}

	/// @notice Register or deploy a question with this portfolio's immutable origin configuration.
	/// @dev Anyone may register; no vault is exposed until its owner allocates. Existing entries cannot
	/// be replaced or removed, including after their question ends or their universe forks.
	function addQuestion(uint256 questionId) public returns (ISecurityPool pool) {
		bytes32 registeredOrigin = questionOriginIds[questionId];
		if (registeredOrigin != bytes32(0)) return factory.getSecurityPool(registeredOrigin, originUniverseId);
		bytes32 originId = _originId(questionId);
		pool = factory.getSecurityPool(originId, originUniverseId);
		if (address(pool) == address(0)) {
			pool = factory.deployPortfolioSecurityPool(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		}
		_register(questionId, originId, pool);
	}

	/// @notice Resolve one explicitly selected branch. There is no portfolio-wide winning child.
	/// @dev The factory's origin namespace excludes independent origins of the same question in a child.
	function getPool(uint256 questionId, uint248 universeId) external view returns (ISecurityPool pool) {
		bytes32 originId = questionOriginIds[questionId];
		require(originId != bytes32(0), 'Question not registered');
		pool = factory.getSecurityPool(originId, universeId);
		require(address(pool) != address(0), 'Question pool unavailable');
	}

	/// @notice A branch has one REP/ETH price feed shared by all of this pool's questions.
	function priceFeed(uint248 universeId) external view returns (address) {
		return factory.sharedPriceFeeds(address(this), universeId);
	}

	function questionCount() external view returns (uint256) {
		return questions.length;
	}

	function getQuestions(uint256 startIndex, uint256 count) external view returns (uint256[] memory page) {
		require(count <= MAX_QUESTION_PAGE, 'Question page too large');
		require(startIndex <= questions.length, 'Question page start out of bounds');
		uint256 remaining = questions.length - startIndex;
		if (count > remaining) count = remaining;
		page = new uint256[](count);
		for (uint256 index = 0; index < count; index++) page[index] = questions[startIndex + index];
	}

	/// @notice Create the caller's immutable-owner account with automatic backing active from creation.
	function createVault() external returns (SecurityPoolPortfolioVault vault) {
		vault = vaultOf[msg.sender];
		if (address(vault) != address(0)) return vault;
		vault = vaultDeployer.createVault(msg.sender);
		vaultOf[msg.sender] = vault;
		emit VaultCreated(msg.sender, vault);
	}

	function predictVaultAddress(address owner) external view returns (address) {
		return vaultDeployer.predictVaultAddress(owner);
	}

	/// @notice Back and buy complete sets in one transaction, using only opted-in owners' capital.
	/// @dev Contribution amounts limit this transaction's routing, not a standing question or creator budget.
	/// Only a genuine capacity deficit is allocated; any failure rolls back all deposits and registrations.
	function createCompleteSet(uint256 questionId, Contribution[] calldata contributions, address recipient, uint256 minimumShares, uint256 mintAttoEth) external payable {
		require(!entered, 'Portfolio mint already active');
		entered = true;
		require(mintAttoEth > 0, 'Mint amount zero');
		require(msg.value >= mintAttoEth, 'Mint collateral not funded');
		uint256 remainingFeeBudget = msg.value - mintAttoEth;
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		require(contributions.length <= 16, 'Too many contributions');
		ISecurityPool pool = addQuestion(questionId);
		_requireEligible(pool, questionId);
		pool.updateSettlementCollateral();
		uint256 required = pool.settlementCollateralAttoEth() + mintAttoEth;
		uint256 total = pool.totalUnderwritingLimitAttoEth();
		uint256 remaining = required > total ? required - total : 0;
		for (uint256 index; index < contributions.length && remaining > 0; index++) {
			Contribution calldata contribution = contributions[index];
			require(address(vaultOf[contribution.vault.owner()]) == address(contribution.vault), 'Vault is not canonical');
			uint256 increase =
				contribution.maximumCommitmentIncreaseAttoEth < remaining
					? contribution.maximumCommitmentIncreaseAttoEth
					: remaining;
			if (increase == 0) continue;
			(, uint256 feeAttoEth) = contribution.vault.quoteAllocationForMint(questionId, increase);
			require(feeAttoEth <= remainingFeeBudget, 'Reservation fee exceeds budget');
			remainingFeeBudget -= feeAttoEth;
			contribution.vault.allocateForMint{value: feeAttoEth}(questionId, increase);
			remaining -= increase;
		}
		require(remaining == 0, 'Insufficient contributed capacity');
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
		emit ReservationFeesPaid(questionId, msg.sender, msg.value - mintAttoEth - remainingFeeBudget);
		if (remainingFeeBudget > 0) {
			(bool refunded, ) = payable(msg.sender).call{value: remainingFeeBudget}('');
			require(refunded, 'Reservation fee refund failed');
		}
		entered = false;
	}

	/// @dev Journal of independently owned runoff requests, not a queue competing for shared REP.
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
		require(count <= MAX_QUESTION_PAGE && startIndex <= withdrawalRequests.length, 'Invalid withdrawal page');
		if (count > withdrawalRequests.length - startIndex) count = withdrawalRequests.length - startIndex;
		page = new WithdrawalRequest[](count);
		for (uint256 index; index < count; index++) page[index] = withdrawalRequests[startIndex + index];
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

	function _originId(uint256 questionId) private view returns (bytes32) {
		return
			factory.getPortfolioOriginId(address(this), originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _register(uint256 questionId, bytes32 originId, ISecurityPool pool) private {
		_requireEligible(pool, questionId);
		questionOriginIds[questionId] = originId;
		questions.push(questionId);
		emit QuestionRegistered(questionId, originId, pool);
	}

	function _requireEligible(ISecurityPool pool, uint256 questionId) private view {
		uint256 end = pool.questionData().getQuestionEndDate(questionId);
		require(block.timestamp < end, 'Question has already ended');
		require(end - block.timestamp <= maximumQuestionHorizonSeconds, 'Question exceeds pool horizon');
		require(pool.zoltar().getForkTime(originUniverseId) == 0, 'Universe already forked');
	}
}
