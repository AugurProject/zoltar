// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { IERC1155 } from './interfaces/IERC1155.sol';
import { IERC1155Receiver } from './interfaces/IERC1155Receiver.sol';
import { IERC165 } from './interfaces/IERC165.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IPortfolioPurchaseRoot {
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function forkController() external view returns (address);
	function statoblastSecurityMultiplierBps() external view returns (uint256);
	function purchaseFeeBps() external view returns (uint256);
	function annualFeeBps() external view returns (uint256);
	function minimumPurchaseFeeAttoEth() external view returns (uint256);
	function reportingFeeAttoEth() external view returns (uint256);
	function serviceFeeBps() external view returns (uint256);
}
interface IPurchaseForkReadiness {
	function isReady(uint248 universeId) external view returns (bool);
}

/// @notice Shared purchase quotes and atomic delivery of three native outcomes.
contract SecurityPoolPortfolioPurchase is IERC1155Receiver {
	uint256 public constant RESOLUTION_WINDOW = 3 days + 7 weeks;
	address public immutable portfolio;
	constructor(address authority) {
		portfolio = authority;
	}
	function purchaseFee(uint256 cash) external view returns (uint256) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		uint256 backingValue = Math.mulDiv(cash, Math.max(root.statoblastSecurityMultiplierBps(), 10_500), 10_000, Math.Rounding.Ceil);
		return
			Math.max(root.minimumPurchaseFeeAttoEth(), Math.mulDiv(backingValue, root.purchaseFeeBps(), 10_000, Math.Rounding.Ceil));
	}
	/// @notice Every purchase prepays its reporting tail and a fixed question service charge.
	/// @dev Quotes use the current central checkpoint. The transaction checkpoints
	/// again before enforcing the caller's total ETH budget.
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256 fee, uint256 premium, uint256 rewardFunding, uint256 maintenance) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		SecurityPoolPortfolioSettlement engine = root.settlement();
		uint64 bookId = engine.bookIds(universeId);
		(SecurityPoolSettlementBook.Question memory question, ) = engine.ledger().question(bookId, questionId);
		uint256 target = root.reportingFeeAttoEth();
		uint256 funded;
		if (question.rewardShares != 0)
			(funded, ) = engine.ledger().quoteRedemption(bookId, questionId, question.rewardShares);
		rewardFunding = target > funded ? target - funded : 0;
		uint256 principal = _addedPrincipal(question, cash);
		if (rewardFunding != 0) principal += _addedPrincipal(question, rewardFunding);
		premium = Math.mulDiv(principal, root.annualFeeBps() * RESOLUTION_WINDOW, 10_000 * 365 days, Math.Rounding.Ceil);
		uint256 backing = Math.mulDiv(cash, Math.max(root.statoblastSecurityMultiplierBps(), 10_500), 10_000, Math.Rounding.Ceil);
		uint256 base = Math.max(root.minimumPurchaseFeeAttoEth(), Math.mulDiv(backing, root.purchaseFeeBps(), 10_000, Math.Rounding.Ceil));
		maintenance = Math.mulDiv(base, root.serviceFeeBps(), 10_000) + target - rewardFunding;
		fee = base + premium + target;
	}
	function _addedPrincipal(SecurityPoolSettlementBook.Question memory question, uint256 cash) private pure returns (uint256 principal) {
		require(question.outcomeSupplyAttoShares == 0 || question.units != 0, 'Question backing exhausted');
		uint256 shares =
			question.outcomeSupplyAttoShares == 0
				? cash
				: Math.mulDiv(cash, question.outcomeSupplyAttoShares, question.units);
		principal =
			question.outcomeSupplyAttoShares == 0
				? cash
				: Math.mulDiv(question.feePrincipalAttoEth, shares, question.outcomeSupplyAttoShares, Math.Rounding.Ceil);
		question.units += cash;
		question.outcomeSupplyAttoShares += shares;
		question.feePrincipalAttoEth += principal;
	}
	function availableMintCapacity(uint248 universeId) external view returns (uint256) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		address coordinator = root.forkController();
		if (coordinator == address(0) || !IPurchaseForkReadiness(coordinator).isReady(universeId)) return 0;
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		if (capital.zoltar().getForkTime(universeId) != 0 || !capital.isPriceValid()) return 0;
		SecurityPoolPortfolioSettlement engine = root.settlement();
		SecurityPoolSettlementBook book = engine.ledger();
		uint64 bookId = engine.bookIds(universeId);
		(uint256 cash, uint256 units, , , ) = book.totals(bookId);
		if (cash != units || book.recoveryRep(bookId) != 0) return 0;
		uint256 active = capital.commitmentIndex().eligibleActiveCommitment(capital.conservativePrice());
		uint256 demand = capital.demandAttoEth();
		return active > demand ? active - demand : 0;
	}
	function feeStream(ISecurityPool pool, uint48) external view returns (uint96 rate, uint48 stop) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		SecurityPoolPortfolioSettlement engine = root.settlement();
		uint256 nativeTime = engine.feeTimestamp(pool.universeId());
		if (address(pool.escalationGame()) != address(0)) return (0, 0);
		(SecurityPoolSettlementBook.Question memory question, ) = engine.ledger().question(engine.bookIds(pool.universeId()), pool.questionId());
		if (question.finalAfter != 0) return (0, 0);
		uint256 calculated = Math.mulDiv(question.feePrincipalAttoEth, root.annualFeeBps(), 10_000 * 365 days);
		require(calculated <= type(uint96).max, 'Question fee domain exceeded');
		if (calculated == 0) return (0, 0);
		uint256 duration = Math.min(type(uint48).max - nativeTime, question.units / calculated);
		if (duration == 0) return (0, 0);
		return (uint96(calculated), uint48(nativeTime + duration));
	}
	function mintCompleteSets(ISecurityPool pool, address recipient, uint256 minimumShares) external payable returns (uint256 minted) {
		require(msg.sender == portfolio, 'Only portfolio');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		IShareToken token = pool.shareToken();
		uint248 universeId = pool.universeId();
		uint256 beforeShares = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this));
		pool.createCompleteSet{value: msg.value}();
		minted = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this)) - beforeShares;
		require(minted > 0 && minted >= minimumShares, 'Minimum shares not met');
	}
	/// @dev Recipient callbacks run only after the funded premium and bounty are recorded.
	function deliverCompleteSets(ISecurityPool pool, address recipient, uint256 minted) external {
		require(msg.sender == portfolio, 'Only portfolio');
		IShareToken token = pool.shareToken();
		uint248 universeId = pool.universeId();
		uint256[] memory ids = new uint256[](3);
		uint256[] memory amounts = new uint256[](3);
		for (uint256 i; i < 3; i++) {
			ids[i] = token.getTokenId(universeId, BinaryOutcomes.BinaryOutcome(i));
			amounts[i] = minted;
		}
		IERC1155(address(token)).safeBatchTransferFrom(address(this), recipient, ids, amounts, '');
	}
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}
	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}
	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
	}
}
