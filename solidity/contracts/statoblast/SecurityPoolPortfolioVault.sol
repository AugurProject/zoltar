// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { EscalationGame } from './EscalationGame.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { SignatureValidation, IERC1271 } from './SignatureValidation.sol';
import { VaultOperationsInput, VaultLiquidationInput } from './VaultOperations.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface ISecurityPoolPortfolio {
	function forkController() external view returns (address);
	function getPool(uint256 questionId, uint248 universeId) external view returns (ISecurityPool);
	function originUniverseId() external view returns (uint248);
	function maximumQuestionHorizonSeconds() external view returns (uint256);
	function repToken() external view returns (IERC20);
	function enqueueWithdrawal(uint256 requestId) external;
	function isPositionSourceForPool(address source, address pool) external view returns (bool);
}

/// @notice One underwriter's account across independently collateralized question pools.
/// @dev Idle assets belong solely to owner. Allocated REP is held by the native pool, never credited
/// as spendable here. Neither portfolio membership nor another owner's deposit changes this account.
/// Shared underwriting assets are held by the portfolio. This account receives the owner's
/// recovered question positions and preserves independent native operations and fork choices.
contract SecurityPoolPortfolioVault is IERC1155Receiver, IERC1271 {
	using SafeERC20Ops for IERC20;

	uint256 public constant MAX_CALLS = 16;
	address public immutable owner;
	ISecurityPoolPortfolio public immutable portfolio;
	bool private entered;
	uint256 public allocationPolicyVersion;
	uint256 public allocationPolicyNonce;
	AllocationPolicy public allocationPolicy;
	mapping(uint256 => AllocationLimit) public allocationLimits;
	bool public withdrawalRequested;
	uint256 public withdrawalRequestId;
	bool public withdrawalResidualForfeitureAllowed;
	uint256[] private allocatedQuestions;
	mapping(uint256 => bool) private allocatedQuestionKnown;

	struct Call {
		address target;
		uint256 value;
		bytes data;
	}

	struct QuestionOperations {
		uint256 questionId;
		uint248 universeId;
		VaultOperationsInput input;
		uint256 proposedRepPerEthPrice;
		uint256 requestedInitialAttoWeth;
		uint256 bountyAttoEth;
		uint256 value;
		uint256 minimumIdleAttoRep;
	}

	struct AllocationPolicyConfig {
		uint248 universeId;
		address executor;
		uint256 expiresAt;
		uint256 depositBudgetAttoRep;
		uint256 commitmentIncreaseBudgetAttoEth;
		uint256 minimumIdleAttoRep;
		uint256 minimumHealthFactorBps;
	}

	struct QuestionAllocationLimit {
		uint256 questionId;
		uint256 depositBudgetAttoRep;
		uint256 maximumCommitmentAttoEth;
	}

	struct AllocationPolicy {
		AllocationPolicyConfig config;
		IERC20 repToken;
		uint256 spentDepositAttoRep;
		uint256 spentCommitmentIncreaseAttoEth;
	}

	struct AllocationLimit {
		uint256 version;
		ISecurityPool pool;
		uint256 depositBudgetAttoRep;
		uint256 maximumCommitmentAttoEth;
		uint256 spentDepositAttoRep;
	}

	event CallExecuted(address indexed target, uint256 value, bytes data);
	event QuestionOperationsSubmitted(uint256 indexed questionId, uint248 indexed universeId, ISecurityPool indexed pool, uint256 operationId);
	event AllocationPolicySet(uint256 indexed version, AllocationPolicyConfig config);
	event AllocationQuestionApproved(uint256 indexed version, uint256 indexed questionId, ISecurityPool indexed pool, uint256 depositBudgetAttoRep, uint256 maximumCommitmentAttoEth);
	event AllocationPolicyRevoked(uint256 indexed version);
	event AllocationExecuted(uint256 indexed version, uint256 indexed nonce, uint256 indexed questionId, uint256 depositAttoRep, uint256 commitmentIncreaseAttoEth);
	event EthWithdrawn(uint256 amountAttoEth);
	event WithdrawalRequested(uint256 indexed requestId);
	event WithdrawalCancelled(uint256 indexed requestId);
	event WithdrawalResidualForfeitureSet(uint256 indexed requestId, bool allowed);
	event WithdrawalPaid(uint256 indexed requestId, address indexed repToken, uint256 amountAttoRep);

	constructor(address _owner, ISecurityPoolPortfolio _portfolio) {
		require(_owner != address(0) && _owner != address(this), 'Invalid vault owner');
		require(address(_portfolio).code.length > 0, 'Portfolio has no code');
		owner = _owner;
		portfolio = _portfolio;
	}

	modifier onlyOwner() {
		require(msg.sender == owner, 'Only vault owner');
		_;
	}

	modifier nonReentrant() {
		require(!entered, 'Vault execution already active');
		entered = true;
		_;
		entered = false;
	}

	/// @notice Execute a native claim, withdrawal, approval, transfer or owner-selected fork migration.
	/// @dev Ordinary calls preserve this account as the protocol vault identity. Owner-selected
	/// delegatecall, manager permissions, upgrades or relayed execution signatures are not supported.
	function execute(address target, uint256 value, bytes calldata data) external payable onlyOwner nonReentrant returns (bytes memory) {
		_revokeAllocationPolicy(false);
		return _execute(target, value, data);
	}

	/// @notice Completes an owner's atomic allocation claim and explicit fork choice.
	/// @dev Only the immutable portfolio may invoke this narrow operation; its caller must own the allocation.
	function migrateClaimedPosition(ISecurityPool parent, uint256 outcomeIndex) external nonReentrant {
		require(msg.sender == address(portfolio) || msg.sender == portfolio.forkController(), 'Only portfolio');
		require(address(portfolio.getPool(parent.questionId(), parent.universeId())) == address(parent), 'Question pool unavailable');
		_revokeAllocationPolicy(false);
		ISecurityPoolForker(parent.securityPoolForker()).migrateVault(parent, outcomeIndex);
	}

	/// @notice Execute a bounded batch atomically at the call level.
	/// @dev A successful oracle-staging call is still pending. Later oracle execution is NOT atomic
	/// with this batch, and a queued withdrawal supplies no REP to a subsequent allocation.
	function executeBatch(Call[] calldata calls) external payable onlyOwner nonReentrant returns (bytes[] memory results) {
		require(calls.length > 0 && calls.length <= MAX_CALLS, 'Choose one to sixteen calls');
		_revokeAllocationPolicy(false);
		results = new bytes[](calls.length);
		for (uint256 index = 0; index < calls.length; index++) {
			Call calldata operation = calls[index];
			results[index] = _execute(operation.target, operation.value, operation.data);
		}
	}

	/// @notice Submit one registered question's native vault bundle using this account's idle REP.
	/// @dev Fund this account first. REP and WETH for a new price report require separate approvals
	/// to that question's coordinator; this account is the sponsor and receives its refunds.
	/// Deposits execute immediately. Price-sensitive actions may remain staged or subsequently fail.
	function submitVaultOperations(uint256 questionId, uint248 universeId, VaultOperationsInput calldata input, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable onlyOwner nonReentrant returns (uint256 operationId) {
		_revokeAllocationPolicy(false);
		return
			_submitVaultOperations(questionId, universeId, input, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth, msg.value);
	}

	/// @notice Submit up to sixteen registered question bundles in one owner transaction.
	/// @dev Immediate mode rejects stale prices before any action. Otherwise later oracle execution
	/// remains independent per question: a successful submission is not a successful allocation.
	function submitQuestionOperationsBatch(QuestionOperations[] calldata operations, bool requireImmediate) external payable onlyOwner nonReentrant returns (uint256[] memory operationIds) {
		require(operations.length > 0 && operations.length <= MAX_CALLS, 'Choose one to sixteen calls');
		_revokeAllocationPolicy(false);
		uint256 totalValue;
		for (uint256 index = 0; index < operations.length; index++) {
			QuestionOperations calldata operation = operations[index];
			totalValue += operation.value;
			if (
				requireImmediate &&
				(operation.input.changeCommitment ||
					operation.input.withdrawAttoRep > 0 ||
					operation.input.liquidations.length > 0)
			) {
				require(portfolio.getPool(operation.questionId, operation.universeId).openOraclePriceCoordinator().isPriceValid(), 'Immediate batch needs fresh prices');
			}
		}
		require(totalValue == msg.value, 'Batch value mismatch');
		operationIds = new uint256[](operations.length);
		for (uint256 index = 0; index < operations.length; index++) {
			QuestionOperations calldata operation = operations[index];
			operationIds[index] = _submitVaultOperations(operation.questionId, operation.universeId, operation.input, operation.proposedRepPerEthPrice, operation.requestedInitialAttoWeth, operation.bountyAttoEth, operation.value);
		}
		// Check final state, including when later operations touch the same pool or spend the same token.
		for (uint256 index = 0; index < operations.length; index++) {
			QuestionOperations calldata operation = operations[index];
			ISecurityPool pool = portfolio.getPool(operation.questionId, operation.universeId);
			require(pool.repToken().balanceOf(address(this)) >= operation.minimumIdleAttoRep, 'Batch idle reserve violated');
			if (requireImmediate) {
				require(pool.getVaultUnderwritingLimitAttoEth(address(this)) == 0 || pool.openOraclePriceCoordinator().isPriceValid(), 'Immediate batch needs fresh prices');
				require(_isHealthy(pool, operation.input.minimumReceiverHealthFactorBps), 'Batch health buffer violated');
			}
		}
	}

	/// @notice Authorize bounded allocations in one universe. Only a new owner authorization renews budgets.
	/// @dev Budgets limit delegated authority, not total exposure from existing positions or owner actions.
	/// Membership is permissionless, but this explicit allowlist never expands with the registry.
	/// The owner must approve the current version and nonce; intervening spending cannot renew unnoticed.
	function setAllocationPolicy(uint256 expectedVersion, uint256 expectedNonce, AllocationPolicyConfig calldata config, QuestionAllocationLimit[] calldata limits) external onlyOwner nonReentrant {
		require(!withdrawalRequested, 'Withdrawal active');
		require(expectedVersion == allocationPolicyVersion && expectedNonce == allocationPolicyNonce, 'Allocation authorization changed');
		require(config.executor != address(0) && config.executor != address(this), 'Invalid allocation executor');
		require(config.expiresAt > block.timestamp, 'Policy already expired');
		require(config.minimumHealthFactorBps >= 10_000, 'Policy health factor below one');
		require(limits.length > 0 && limits.length <= MAX_CALLS, 'Choose one to sixteen questions');
		uint256 version = ++allocationPolicyVersion;
		IERC20 repToken;
		for (uint256 index = 0; index < limits.length; index++) {
			QuestionAllocationLimit calldata limit = limits[index];
			require(allocationLimits[limit.questionId].version != version, 'Duplicate policy question');
			ISecurityPool pool = portfolio.getPool(limit.questionId, config.universeId);
			_requireAllocatable(pool, limit.questionId, config.universeId);
			IERC20 token = IERC20(address(pool.repToken()));
			if (index == 0) repToken = token;
			else require(address(token) == address(repToken), 'Policy REP token mismatch');
			allocationLimits[limit.questionId] = AllocationLimit(version, pool, limit.depositBudgetAttoRep, limit.maximumCommitmentAttoEth, 0);
			emit AllocationQuestionApproved(version, limit.questionId, pool, limit.depositBudgetAttoRep, limit.maximumCommitmentAttoEth);
		}
		allocationPolicy = AllocationPolicy(config, repToken, 0, 0);
		emit AllocationPolicySet(version, config);
	}

	function revokeAllocationPolicy() external onlyOwner nonReentrant {
		_revokeAllocationPolicy(true);
	}

	function _revokeAllocationPolicy(bool forceInvalidation) private {
		if (!forceInvalidation && allocationPolicy.config.executor == address(0)) return;
		delete allocationPolicy;
		emit AllocationPolicyRevoked(++allocationPolicyVersion);
	}

	/// @notice Execute an approved deposit and/or commitment increase, synchronously, with no oracle fees.
	/// @dev The executor chooses timing within the policy; it cannot withdraw, migrate, liquidate,
	/// approve tokens, change recipients, or roll failed/stale requests into a later price report.
	function executeAllocation(uint256 expectedVersion, uint256 expectedNonce, uint256 questionId, uint256 depositAttoRep, uint256 commitmentAttoEth) external nonReentrant returns (uint256 operationId) {
		AllocationPolicy storage policy = allocationPolicy;
		require(msg.sender == owner || msg.sender == policy.config.executor, 'Only allocation executor');
		require(expectedVersion == allocationPolicyVersion && expectedNonce == allocationPolicyNonce, 'Allocation authorization changed');
		require(block.timestamp < policy.config.expiresAt, 'Policy expired');
		AllocationLimit storage limit = allocationLimits[questionId];
		require(limit.version == expectedVersion, 'Question not approved by policy');
		ISecurityPool pool = limit.pool;
		_requireAllocatable(pool, questionId, policy.config.universeId);
		require(pool.openOraclePriceCoordinator().isPriceValid() && pool.openOraclePriceCoordinator().pendingReportId() == 0, 'Allocation needs settled fresh price');
		uint256 previousCommitment = pool.getVaultUnderwritingLimitAttoEth(address(this));
		require(commitmentAttoEth >= previousCommitment, 'Policy cannot reduce commitment');
		uint256 increase = commitmentAttoEth - previousCommitment;
		require(depositAttoRep > 0 || increase > 0, 'Choose an allocation');
		require(commitmentAttoEth <= limit.maximumCommitmentAttoEth, 'Question commitment cap exceeded');
		require(policy.spentDepositAttoRep + depositAttoRep <= policy.config.depositBudgetAttoRep, 'Policy deposit budget exceeded');
		require(limit.spentDepositAttoRep + depositAttoRep <= limit.depositBudgetAttoRep, 'Question deposit budget exceeded');
		require(policy.spentCommitmentIncreaseAttoEth + increase <= policy.config.commitmentIncreaseBudgetAttoEth, 'Policy commitment budget exceeded');
		uint256 idleAttoRep = policy.repToken.balanceOf(address(this));
		require(idleAttoRep >= depositAttoRep && idleAttoRep - depositAttoRep >= policy.config.minimumIdleAttoRep, 'Policy idle reserve violated');
		if (depositAttoRep > 0)
			require(pool.attoRepToBackingUnits(depositAttoRep) > 0, 'Allocation deposit rounds to zero');
		policy.spentDepositAttoRep += depositAttoRep;
		policy.spentCommitmentIncreaseAttoEth += increase;
		limit.spentDepositAttoRep += depositAttoRep;
		allocationPolicyNonce++;
		VaultOperationsInput memory input = VaultOperationsInput(depositAttoRep, increase > 0, commitmentAttoEth, new VaultLiquidationInput[](0), 0, policy.config.minimumHealthFactorBps, 300);
		operationId = _submitVaultOperations(questionId, policy.config.universeId, input, 0, 0, 0, 0);
		require(_isHealthy(pool, policy.config.minimumHealthFactorBps), 'Policy health buffer violated');
		emit AllocationExecuted(expectedVersion, expectedNonce, questionId, depositAttoRep, increase);
	}

	function _isHealthy(ISecurityPool pool, uint256 minimumHealthFactorBps) private view returns (bool) {
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		uint256 disputeStake =
			address(pool.escalationGame()) == address(0)
				? 0
				: pool.escalationGame().disputeStakedRepByVaultAttoRep(address(this));
		return
			SecurityPoolUtils.isVaultHealthyAtFactor(pool.backingUnitsToAttoRep(units), disputeStake, commitment, pool.openOraclePriceCoordinator().lastPrice(), pool.statoblastSecurityMultiplierBps(), minimumHealthFactorBps);
	}

	function _requireAllocatable(ISecurityPool pool, uint256 questionId, uint248 universeId) private view {
		require(pool.universeId() == universeId && pool.questionId() == questionId, 'Allocation pool mismatch');
		require(pool.zoltar().getForkTime(universeId) == 0, 'Allocation universe forked');
		require(block.timestamp < pool.questionData().getQuestionEndDate(questionId), 'Allocation question ended');
		require(pool.questionData().getQuestionEndDate(questionId) - block.timestamp <= portfolio.maximumQuestionHorizonSeconds(), 'Question exceeds pool horizon');
		require(pool.systemState() == SystemState.Operational && !pool.isEscalationResolved(), 'Allocation pool inactive');
	}

	/// @notice Accept only the aggregate or one of its immutable archives for this exact question ledger.
	function onSecurityPoolVaultPositionReceived(address source) external returns (bytes4) {
		require(portfolio.isPositionSourceForPool(source, msg.sender), 'Position source is not portfolio');
		ISecurityPool pool = ISecurityPool(payable(msg.sender));
		uint256 questionId = pool.questionId();
		require(address(portfolio.getPool(questionId, pool.universeId())) == msg.sender, 'Position pool is not canonical');
		_recordPortfolioQuestion(questionId);
		return this.onSecurityPoolVaultPositionReceived.selector;
	}

	function _recordPortfolioQuestion(uint256 questionId) private {
		if (!allocatedQuestionKnown[questionId]) {
			allocatedQuestionKnown[questionId] = true;
			allocatedQuestions.push(questionId);
		}
	}

	function allocatedQuestionCount() external view returns (uint256) {
		return allocatedQuestions.length;
	}

	function getEthBalance() external view returns (uint256) {
		return address(this).balance;
	}

	/// @notice Withdraw this account's ETH to its owner without changing REP allocation authority.
	/// @dev Includes native fees, archived-position fees, and refunds already paid to this account.
	function withdrawEth() external onlyOwner nonReentrant {
		uint256 amount = address(this).balance;
		require(amount > 0, 'No ETH available');
		(bool paid, ) = payable(owner).call{value: amount}('');
		require(paid, 'ETH withdrawal failed');
		emit EthWithdrawn(amount);
	}

	function getAllocatedQuestions(uint256 startIndex, uint256 count) external view returns (uint256[] memory page) {
		require(count <= 64 && startIndex <= allocatedQuestions.length, 'Invalid allocation page');
		count = Math.min(count, allocatedQuestions.length - startIndex);
		page = new uint256[](count);
		for (uint256 index; index < count; index++) page[index] = allocatedQuestions[startIndex + index];
	}

	/// @notice Stop new delegated exposure and authorize anyone to return this account's recoverable REP to owner.
	/// @dev This is full-account runoff, not a fixed REP claim. Existing owner-staged native operations and
	/// forks still follow their native lifecycle. Ordinary-game residual rights are preserved by default.
	function requestWithdrawal() external onlyOwner nonReentrant {
		require(!withdrawalRequested, 'Withdrawal already active');
		_revokeAllocationPolicy(true);
		withdrawalRequested = true;
		withdrawalResidualForfeitureAllowed = false;
		portfolio.enqueueWithdrawal(++withdrawalRequestId);
		emit WithdrawalRequested(withdrawalRequestId);
		_payWithdrawal(portfolio.repToken());
	}

	/// @notice Cancel runoff of recovered positions; delegated authority stays revoked.
	function cancelWithdrawal() external onlyOwner nonReentrant {
		require(withdrawalRequested, 'No withdrawal requested');
		withdrawalRequested = false;
		allocationPolicyVersion++;
		withdrawalResidualForfeitureAllowed = false;
		emit WithdrawalCancelled(withdrawalRequestId);
	}

	/// @notice Explicitly allow this request to exit before ordinary-game residual claims settle.
	/// @dev Applies to all questions processed under the current request. Early exit gives up any later
	/// residual allocated through the redeemed backing units. Available residual is always collected first.
	function setWithdrawalResidualForfeiture(bool allowed) external onlyOwner nonReentrant {
		require(withdrawalRequested, 'No withdrawal requested');
		withdrawalResidualForfeitureAllowed = allowed;
		emit WithdrawalResidualForfeitureSet(withdrawalRequestId, allowed);
	}

	/// @notice Permissionlessly process one owner-selected branch; never chooses or performs fork migration.
	/// @dev Final REP exit leaves funded ETH share claims intact. Before finality, only surplus commitments
	/// can exit; REP withdrawal needs a fresh price and all native coverage/escrow checks.
	function processWithdrawal(uint256 questionId, uint248 universeId) external nonReentrant {
		require(withdrawalRequested, 'No withdrawal requested');
		ISecurityPool pool = portfolio.getPool(questionId, universeId);
		require(pool.systemState() == SystemState.Operational, 'Pool inactive');
		pool.updateSettlementCollateral();
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		if (pool.isEscalationResolved()) {
			if (units > 0) _collectWithdrawalResidual(pool, true);
			if (commitment > 0) pool.setUnderwritingLimit(0);
			if (units > 0) pool.redeemRepFromVault(address(this));
		} else {
			uint256 total = pool.totalUnderwritingLimitAttoEth();
			uint256 collateral = pool.settlementCollateralAttoEth();
			uint256 reduction = total > collateral ? Math.min(commitment, total - collateral) : 0;
			if (reduction > 0) pool.setUnderwritingLimit(commitment - reduction);
			// Never stage fresh withdrawal authority that could execute after cancellation.
			if (
				commitment == reduction &&
				units > 0 &&
				pool.openOraclePriceCoordinator().isPriceValid() &&
				pool.openOraclePriceCoordinator().pendingReportId() == 0
			) {
				uint256 rep = pool.backingUnitsToAttoRep(units);
				if (rep > 0) {
					_collectWithdrawalResidual(pool, false);
					_submitVaultOperations(questionId, universeId, VaultOperationsInput(0, false, 0, new VaultLiquidationInput[](0), rep, 10_000, 300), 0, 0, 0, 0);
				}
			}
		}
		_payWithdrawal(IERC20(address(pool.repToken())));
	}

	function _collectWithdrawalResidual(ISecurityPool pool, bool isFinal) private {
		EscalationGame game = pool.escalationGame();
		// Continuation residual is burned, so it never increases this vault's backing claim.
		if (address(game) == address(0) || game.forkContinuation()) return;
		if (isFinal) {
			// Freeze every remaining winner liability and collect only the safe surplus.
			// No reporter cleanup is needed before this vault exits.
			game.settleOrdinaryGame();
			return;
		}
		if (game.totalDisputeStakedAttoRep() > 0)
			require(withdrawalResidualForfeitureAllowed, 'Ordinary residual unsettled');
	}

	function _payWithdrawal(IERC20 token) private {
		uint256 amount = token.balanceOf(address(this));
		if (amount == 0) return;
		token.safeTransfer(owner, amount);
		emit WithdrawalPaid(withdrawalRequestId, address(token), amount);
	}

	function _submitVaultOperations(uint256 questionId, uint248 universeId, VaultOperationsInput memory input, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth, uint256 value) private returns (uint256 operationId) {
		ISecurityPool pool = portfolio.getPool(questionId, universeId);
		if (input.depositAttoRep > 0) IERC20(address(pool.repToken())).safeApprove(address(pool), input.depositAttoRep);
		operationId = pool.openOraclePriceCoordinator().vaultOperations().submitVaultOperations{value: value}(input, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		emit QuestionOperationsSubmitted(questionId, universeId, pool, operationId);
	}

	/// @notice Support native signed approvals whose own typed data binds this receiver vault.
	function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
		return
			SignatureValidation.isValidSignatureNow(owner, digest, signature)
				? IERC1271.isValidSignature.selector
				: bytes4(0xffffffff);
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

	function _execute(address target, uint256 value, bytes calldata data) private returns (bytes memory result) {
		require(target != address(0), 'Call target zero');
		bool success;
		(success, result) = target.call{value: value}(data);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 32), mload(result))
			}
		}
		emit CallExecuted(target, value, data);
	}

	receive() external payable {}
}
