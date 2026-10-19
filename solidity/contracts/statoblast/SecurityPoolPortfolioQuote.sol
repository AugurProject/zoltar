// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, PoolAccountingSnapshot, SystemState } from './interfaces/ISecurityPool.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { IERC1155 } from './interfaces/IERC1155.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { OpenOraclePriceCoordinator } from './OpenOraclePriceCoordinator.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable portfolio economics, native-accounting previews and atomic complete-set delivery.
contract SecurityPoolPortfolioQuote is IERC1155Receiver {
	address public immutable portfolio;
	uint256 public immutable targetHealthFactorBps;
	uint256 public immutable purchaseFeeBps;
	uint256 public immutable minimumPurchaseFeeAttoEth;

	constructor(address _portfolio, uint256 _targetHealthFactorBps, uint256 _purchaseFeeBps, uint256 _minimumPurchaseFeeAttoEth) {
		portfolio = _portfolio;
		targetHealthFactorBps = _targetHealthFactorBps;
		purchaseFeeBps = _purchaseFeeBps;
		minimumPurchaseFeeAttoEth = _minimumPurchaseFeeAttoEth;
	}

	struct MintPlan {
		bool reusePosition;
		bool reserveFunded;
		bool needsCommitment;
		uint256 availableAttoRep;
		uint256 depositAttoRep;
		uint256 feeAttoEth;
		uint256 nextCommitment;
	}

	struct QuoteState {
		uint256 vaultUnits;
		uint256 totalUnits;
		uint256 totalHeld;
		uint256 commitment;
		uint256 others;
		uint256 collateral;
		uint256 price;
		uint256 multiplier;
		uint256 minimumDeposit;
		bool freshPrice;
	}

	/// @notice Mint with the supplied ETH and deliver exactly the newly minted complete sets.
	/// @dev Existing tokens and forced ETH are excluded. This grants no reserve-allocation authority.
	function buyCompleteSets(ISecurityPool pool, address recipient, uint256 minimumShares) external payable returns (uint256 minted) {
		require(msg.sender == portfolio, 'Only portfolio');
		require(msg.value > 0, 'Mint collateral not funded');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		uint248 universeId = pool.universeId();
		IShareToken token = pool.shareToken();
		uint256 beforeShares = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this));
		pool.createCompleteSet{value: msg.value}();
		minted = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this)) - beforeShares;
		require(minted >= minimumShares, 'Minimum shares not met');
		uint256[] memory ids = new uint256[](3);
		uint256[] memory amounts = new uint256[](3);
		for (uint256 index; index < 3; index++) {
			ids[index] = token.getTokenId(universeId, BinaryOutcomes.BinaryOutcome(index));
			amounts[index] = minted;
		}
		IERC1155(address(token)).safeBatchTransferFrom(address(this), recipient, ids, amounts, '');
	}

	/// @notice Native lifecycle checks shared by admission, purchase and quote entry points.
	function requireEligible(ISecurityPool pool, uint256 questionId, uint248 universeId, uint256 horizon) external view {
		uint256 end = pool.questionData().getQuestionEndDate(questionId);
		require(block.timestamp < end, 'Question has already ended');
		require(end - block.timestamp <= horizon, 'Question exceeds pool horizon');
		require(pool.zoltar().getForkTime(universeId) == 0, 'Universe already forked');
		require(pool.systemState() == SystemState.Operational, 'Question pool inactive');
	}

	function rebalancePlan(ISecurityPool pool, address custody) external view returns (uint256 retainedCommitment, uint256 releaseAttoRep) {
		QuoteState memory state = _quoteState(pool, custody);
		(releaseAttoRep, ) = _rebalance(state);
		return (state.commitment, releaseAttoRep);
	}

	function mintPlan(ISecurityPool pool, address custody, uint256 mintAttoEth, uint256 idleRep, bool reserveFunded, bool previewRebalance) external view returns (MintPlan memory plan) {
		QuoteState memory state = _quoteState(pool, custody);
		require(state.freshPrice, 'Mint needs settled fresh price');
		plan.reusePosition = custody != address(0);
		plan.reserveFunded = reserveFunded;
		plan.availableAttoRep = reserveFunded ? idleRep : 0;
		if (custody != address(0)) {
			plan.availableAttoRep += pool.repToken().balanceOf(custody);
			if (previewRebalance) {
				(, uint256 released) = _rebalance(state);
				plan.availableAttoRep += released;
			}
		}
		(plan.depositAttoRep, plan.nextCommitment, plan.needsCommitment) = _mintBackingQuote(state, mintAttoEth);
		if (!reserveFunded && plan.depositAttoRep > plan.availableAttoRep) {
			// Historical capital cannot receive a reserve top-up. A fresh cohort uses the
			// post-withdrawal exchange rate and counts the retained commitment as other capacity.
			plan.reusePosition = false;
			plan.reserveFunded = true;
			plan.availableAttoRep = idleRep;
			state.vaultUnits = 0;
			state.others += state.commitment;
			state.commitment = 0;
			(plan.depositAttoRep, plan.nextCommitment, plan.needsCommitment) = _mintBackingQuote(state, mintAttoEth);
		}
		// Charge every purchase for its standalone backing, including capacity reuse.
		// A dust mint that also repairs old backing must pay for all newly locked REP,
		// whether that capital comes from the reserve or historical custody cash.
		uint256 feeBacking = Math.max(_requiredBacking(state, mintAttoEth, targetHealthFactorBps), plan.depositAttoRep);
		plan.feeAttoEth = Math.max(Math.mulDiv(Math.mulDiv(feeBacking, 1e18, state.price, Math.Rounding.Ceil), purchaseFeeBps, 10_000, Math.Rounding.Ceil), minimumPurchaseFeeAttoEth);
	}

	function _quoteState(ISecurityPool pool, address custody) private view returns (QuoteState memory state) {
		PoolAccountingSnapshot memory accounting = pool.getPoolAccountingSnapshot();
		state.collateral = _currentCollateral(pool, accounting);
		state.others = accounting.totalUnderwritingLimitAttoEth;
		state.totalUnits = pool.totalRepBackingUnits();
		state.totalHeld = pool.getTotalPoolHeldAttoRep();
		if (custody != address(0)) {
			(state.vaultUnits, state.commitment, , ) = pool.securityVaults(custody);
			state.others -= state.commitment;
		}
		state.multiplier = Math.max(pool.statoblastSecurityMultiplierBps(), 10_500);
		state.minimumDeposit = pool.minimumVaultRepDepositAttoRep();
		OpenOraclePriceCoordinator coordinator = pool.openOraclePriceCoordinator();
		state.freshPrice = coordinator.isPriceValid() && coordinator.pendingReportId() == 0;
		if (state.freshPrice) state.price = coordinator.lastPrice();
	}

	/// @dev Mirrors updateSettlementCollateral, including both carries and the native fee epoch clamp.
	function _currentCollateral(ISecurityPool pool, PoolAccountingSnapshot memory accounting) private view returns (uint256 collateral) {
		collateral = accounting.settlementCollateralAttoEth;
		uint256 timestamp = Math.min(block.timestamp, pool.getFeeEpochEndTime());
		if (timestamp <= accounting.lastUpdatedFeeAccumulator || accounting.feeEligibleUnderwritingLimitAttoEth == 0)
			return collateral;
		(, , uint256 creditedFees, ) = SecurityPoolUtils.calculateFeeAccrual(Math.mulDiv(collateral, accounting.feeEligibleUnderwritingLimitAttoEth, accounting.totalUnderwritingLimitAttoEth), accounting.currentRetentionRate, timestamp - accounting.lastUpdatedFeeAccumulator, accounting.feeIndexRemainder, accounting.feeEligibleUnderwritingLimitAttoEth, accounting.totalFeesOwedRemainder);
		return collateral - creditedFees;
	}

	/// @dev Mutates the in-memory state to the exact post-rebalance native unit ratio.
	function _rebalance(QuoteState memory state) private view returns (uint256 requested, uint256 released) {
		state.commitment =
			state.collateral > state.others ? Math.min(state.commitment, state.collateral - state.others) : 0;
		if (!state.freshPrice) return (0, 0);
		uint256 held = _held(state);
		uint256 required = _requiredBacking(state, state.commitment, targetHealthFactorBps);
		if (held <= required) return (0, 0);
		uint256 poolRequired = _requiredBacking(state, state.others + state.commitment, 10_000);
		if (state.totalHeld <= poolRequired) return (0, 0);
		requested = Math.min(held - required, state.totalHeld - poolRequired);
		if (requested < held && held - requested < state.minimumDeposit)
			requested = held > state.minimumDeposit ? held - state.minimumDeposit : 0;
		if (requested == 0) return (0, 0);
		uint256 withdrawnUnits = Math.mulDiv(requested, state.totalUnits, state.totalHeld);
		// Match the native strict minimum-remainder sweep and reject ineffective withdrawals.
		if (withdrawnUnits + Math.mulDiv(state.minimumDeposit, state.totalUnits, state.totalHeld) > state.vaultUnits)
			withdrawnUnits = state.vaultUnits;
		released = Math.mulDiv(withdrawnUnits, state.totalHeld, state.totalUnits);
		if (released == 0) return (0, 0);
		state.vaultUnits -= withdrawnUnits;
		state.totalUnits -= withdrawnUnits;
		state.totalHeld -= released;
	}

	function _mintBackingQuote(QuoteState memory state, uint256 mintAttoEth) private view returns (uint256 depositAttoRep, uint256 nextCommitment, bool needsCommitment) {
		uint256 requiredCommitment = state.collateral + mintAttoEth;
		nextCommitment =
			requiredCommitment > state.others
				? Math.max(state.commitment, requiredCommitment - state.others)
				: state.commitment;
		if (nextCommitment <= state.commitment) return (0, nextCommitment, false);
		needsCommitment = true;
		uint256 held = _held(state);
		uint256 requiredRep = _requiredBacking(state, nextCommitment, targetHealthFactorBps);
		if (requiredRep > held) depositAttoRep = requiredRep - held;
		// Native deposits round backing units down; cover the last unit at the projected pool rate.
		if (depositAttoRep > 0 && state.totalUnits > 0 && state.totalHeld > 0)
			depositAttoRep = Math.mulDiv(Math.mulDiv(depositAttoRep, state.totalUnits, state.totalHeld, Math.Rounding.Ceil), state.totalHeld, state.totalUnits, Math.Rounding.Ceil);
	}

	function _held(QuoteState memory state) private pure returns (uint256) {
		return state.totalUnits == 0 ? 0 : Math.mulDiv(state.vaultUnits, state.totalHeld, state.totalUnits);
	}

	function _requiredBacking(QuoteState memory state, uint256 commitment, uint256 healthFactorBps) private pure returns (uint256) {
		if (commitment == 0) return 0;
		uint256 required = Math.mulDiv(commitment, state.price, 1e18, Math.Rounding.Ceil);
		required = Math.mulDiv(required, state.multiplier, 10_000, Math.Rounding.Ceil);
		return Math.max(Math.mulDiv(required, healthFactorBps, 10_000, Math.Rounding.Ceil), state.minimumDeposit);
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
}
