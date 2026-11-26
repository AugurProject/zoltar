// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';

interface ISecurityPoolPurchaseRoot {
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function settlement() external view returns (SecurityPoolSettlement);
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
contract SecurityPoolPurchase {
	uint256 public constant RESOLUTION_WINDOW = Constants.RESOLUTION_PREMIUM_WINDOW;
	address public immutable securityPool;
	constructor(address authority) {
		securityPool = authority;
	}
	function purchaseFee(uint256 cash) external view returns (uint256) {
		ISecurityPoolPurchaseRoot root = ISecurityPoolPurchaseRoot(securityPool);
		return _basePurchaseFee(root, cash);
	}
	/// @notice Every purchase prepays its resolution tail.
	/// @dev Quotes use the current central checkpoint. The transaction checkpoints
	/// again before enforcing the caller's total raw-collateral budget.
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256 fee, uint256 premium) {
		ISecurityPoolPurchaseRoot root = ISecurityPoolPurchaseRoot(securityPool);
		SecurityPoolSettlement engine = root.settlement();
		uint64 bookId = engine.bookIds(universeId);
		engine.ledger().validateMintFeePrecision(bookId, questionId, cash, root.annualFeeBps());
		uint256 principal = engine.ledger().quoteMintPrincipal(bookId, questionId, cash);
		premium = Math.mulDiv(principal, root.annualFeeBps() * RESOLUTION_WINDOW, SecurityPoolUtils.BPS_DENOMINATOR * 365 days, Math.Rounding.Ceil);
		fee = _basePurchaseFee(root, cash) + premium;
	}
	/// @dev Round collateral up before rounding its fee up; combining these divisions changes dust fees.
	function _basePurchaseFee(ISecurityPoolPurchaseRoot root, uint256 cashAttoEth) private view returns (uint256) {
		uint256 backingValueAttoEth = Math.mulDiv(cashAttoEth, root.statoblastSecurityMultiplierBps(), SecurityPoolUtils.BPS_DENOMINATOR, Math.Rounding.Ceil);
		return
			Math.max(root.minimumPurchaseFeeAttoEth(), Math.mulDiv(backingValueAttoEth, root.purchaseFeeBps(), SecurityPoolUtils.BPS_DENOMINATOR, Math.Rounding.Ceil));
	}
	function quoteMintRecoveryRep(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256) {
		SecurityPoolSettlement engine = ISecurityPoolPurchaseRoot(securityPool).settlement();
		return engine.ledger().quoteMintRecoveryRep(engine.bookIds(universeId), questionId, cash);
	}
	function availableMintCapacity(uint248 universeId) external view returns (uint256) {
		ISecurityPoolPurchaseRoot root = ISecurityPoolPurchaseRoot(securityPool);
		address coordinator = root.forkController();
		if (coordinator == address(0) || !IPurchaseForkReadiness(coordinator).isReady(universeId)) return 0;
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		if (capital.zoltar().getForkTime(universeId) != 0 || !capital.isPriceValid()) return 0;
		SecurityPoolSettlement engine = root.settlement();
		SecurityPoolSettlementBook book = engine.ledger();
		uint64 bookId = engine.bookIds(universeId);
		if (!book.isCashFunded(bookId)) return 0;
		uint256 active = capital.commitmentIndex().eligibleActiveCommitment(capital.conservativePrice());
		uint256 demand = capital.demandAttoEth();
		return active > demand ? active - demand : 0;
	}
	function feeStream(IQuestionLedger pool) external view returns (uint96 rate, uint48 stop) {
		ISecurityPoolPurchaseRoot root = ISecurityPoolPurchaseRoot(securityPool);
		SecurityPoolSettlement engine = root.settlement();
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
		return
			engine.ledger().normalizeFeeStream(uint96(calculated), uint48(nativeTime + duration), uint48(nativeTime), engine.ledger().scaledAvailableFeeBudget(engine.bookIds(pool.universeId()), pool.questionId()));
	}
}
