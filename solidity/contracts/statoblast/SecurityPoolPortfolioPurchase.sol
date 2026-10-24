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
}
interface IPurchaseForkReadiness {
	function isReady(uint248 universeId) external view returns (bool);
}

/// @notice Shared purchase quotes and atomic delivery of three native outcomes.
contract SecurityPoolPortfolioPurchase is IERC1155Receiver {
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
	function availableMintCapacity(uint248 universeId) external view returns (uint256) {
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		address coordinator = root.forkController();
		if (coordinator == address(0) || !IPurchaseForkReadiness(coordinator).isReady(universeId)) return 0;
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		if (capital.zoltar().getForkTime(universeId) != 0 || !capital.isPriceValid()) return 0;
		SecurityPoolPortfolioSettlement engine = root.settlement();
		(uint256 cash, uint256 units, , , ) = engine.ledger().totals(engine.bookIds(universeId));
		if (cash != units) return 0;
		uint256 active = capital.commitmentIndex().eligibleActiveCommitment(capital.acceptedPrice());
		uint256 demand = capital.demandAttoEth();
		return active > demand ? active - demand : 0;
	}
	function feeStream(ISecurityPool pool, uint48) external view returns (uint96 rate, uint48 stop) {
		uint256 end = pool.questionData().getQuestionEndDate(pool.questionId());
		IPortfolioPurchaseRoot root = IPortfolioPurchaseRoot(portfolio);
		SecurityPoolPortfolioSettlement engine = root.settlement();
		uint256 nativeTime = engine.feeTimestamp(pool.universeId());
		if (end <= nativeTime || address(pool.escalationGame()) != address(0)) return (0, 0);
		(SecurityPoolSettlementBook.Question memory question, ) = engine.ledger().question(engine.bookIds(pool.universeId()), pool.questionId());
		uint256 calculated = Math.mulDiv(question.feePrincipalAttoEth, root.annualFeeBps(), 10_000 * 365 days);
		require(calculated <= type(uint96).max && end <= type(uint48).max, 'Question fee domain exceeded');
		if (calculated == 0) return (0, 0);
		uint256 duration = Math.min(end - nativeTime, question.units / calculated);
		if (duration == 0) return (0, 0);
		return (uint96(calculated), uint48(nativeTime + duration));
	}
	function buyCompleteSets(ISecurityPool pool, address recipient, uint256 minimumShares) external payable returns (uint256 minted) {
		require(msg.sender == portfolio, 'Only portfolio');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		IShareToken token = pool.shareToken();
		uint248 universeId = pool.universeId();
		uint256 beforeShares = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this));
		pool.createCompleteSet{value: msg.value}();
		minted = token.balanceOfOutcome(universeId, BinaryOutcomes.BinaryOutcome.Invalid, address(this)) - beforeShares;
		require(minted > 0 && minted >= minimumShares, 'Minimum shares not met');
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
