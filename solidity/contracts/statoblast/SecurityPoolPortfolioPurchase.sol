// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IPortfolioPurchaseRoot {
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function forkController() external view returns (address);
	function statoblastSecurityMultiplierBps() external view returns (uint256);
	function purchaseFeeBps() external view returns (uint256);
	function annualFeeBps() external view returns (uint256);
	function minimumPurchaseFeeAttoEth() external view returns (uint256);
	function sourceGame(uint248 universeId, uint256 questionId) external view returns (address);
}
interface IPurchaseForkReadiness {
	function isReady(uint248 universeId) external view returns (bool);
}

/// @notice Read-only purchase, capacity, and linear fee quotes.
contract SecurityPoolPortfolioPurchase {
	uint256 public constant RESOLUTION_WINDOW = 3 days + 7 weeks;
	address public immutable portfolio;
	constructor(address authority) {
		portfolio = authority;
	}
	function purchaseFee(uint256 cash) external view returns (uint256) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		return _basePurchaseFee(root, cash);
	}
	/// @notice Every purchase prepays its resolution tail.
	/// @dev Quotes use the current central checkpoint. The transaction checkpoints
	/// again before enforcing the caller's total ETH budget.
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256 fee, uint256 premium) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		SecurityPoolPortfolioSettlement engine = root.settlement();
		uint64 bookId = engine.bookIds(universeId);
		engine.ledger().validateMintFeePrecision(bookId, questionId, cash, root.annualFeeBps());
		uint256 principal = engine.ledger().quoteMintPrincipal(bookId, questionId, cash);
		premium = Math.mulDiv(principal, root.annualFeeBps() * RESOLUTION_WINDOW, SecurityPoolUtils.BPS_DENOMINATOR * 365 days, Math.Rounding.Ceil);
		fee = _basePurchaseFee(root, cash) + premium;
	}
	/// @dev Round collateral up before rounding its fee up; combining these divisions changes dust fees.
	function _basePurchaseFee(IPortfolioPurchaseRoot root, uint256 cashAttoEth) private view returns (uint256) {
		uint256 backingValueAttoEth = Math.mulDiv(cashAttoEth, root.statoblastSecurityMultiplierBps(), SecurityPoolUtils.BPS_DENOMINATOR, Math.Rounding.Ceil);
		return
			Math.max(root.minimumPurchaseFeeAttoEth(), Math.mulDiv(backingValueAttoEth, root.purchaseFeeBps(), SecurityPoolUtils.BPS_DENOMINATOR, Math.Rounding.Ceil));
	}
	function quoteMintRecoveryRep(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256) {
		SecurityPoolPortfolioSettlement engine = IPortfolioPurchaseRoot(portfolio).settlement();
		return engine.ledger().quoteMintRecoveryRep(engine.bookIds(universeId), questionId, cash);
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
		if (!book.isCashFunded(bookId)) return 0;
		uint256 active = capital.commitmentIndex().eligibleActiveCommitment(capital.conservativePrice());
		uint256 demand = capital.demandAttoEth();
		return active > demand ? active - demand : 0;
	}
	function feeStream(ISecurityPool pool) external view returns (uint96 rate, uint48 stop) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		SecurityPoolPortfolioSettlement engine = root.settlement();
		uint256 nativeTime = engine.feeTimestamp(pool.universeId());
		if (address(pool.escalationGame()) != address(0)) return (0, 0);
		if (root.sourceGame(pool.universeId(), pool.questionId()) != address(0)) return (0, 0);
		(SecurityPoolSettlementBook.Question memory question, ) = engine.ledger().scaledQuestion(engine.bookIds(pool.universeId()), pool.questionId());
		if (question.finalAfter != 0) return (0, 0);
		uint256 calculated = Math.mulDiv(question.feePrincipalAttoEth, root.annualFeeBps(), SecurityPoolUtils.BPS_DENOMINATOR * 365 days);
		require(calculated <= type(uint96).max, 'Question fee domain exceeded');
		if (calculated == 0) return (0, 0);
		uint256 duration = Math.min(type(uint48).max - nativeTime, engine.ledger().scaledAvailableFeeBudget(engine.bookIds(pool.universeId()), pool.questionId()) / calculated);
		if (duration == 0) return (0, 0);
		return (uint96(calculated), uint48(nativeTime + duration));
	}
}
