// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';

interface IPortfolioForkAuthority {
	function forkController() external view returns (address);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function zoltar() external view returns (Zoltar);
	function portfolioTime(uint248 universeId) external view returns (uint48);
}

/// @notice Actual ERC20 custody for the portfolio's virtual question and branch settlement books.
/// @dev The immutable portfolio authenticates native callbacks, decides fee policy and supplies
/// its monotonic portfolio clock. Every returned earned fee is transferred to that authority;
/// it must credit old underwriting weights before changing commitments or accepted prices.
contract SecurityPoolPortfolioSettlement {
	using SafeERC20Ops for IERC20;
	address public immutable portfolio;
	IERC20 public immutable collateralToken;
	address public services;
	SecurityPoolSettlementBook public ledger;
	bool private entered;

	struct QuestionSource {
		uint248 universeId;
		uint256 questionId;
		bool registered;
	}

	struct Snapshot {
		uint256 outcomeSupplyAttoShares;
		uint256 questionCashAttoEth;
		uint256 questionRecoveryAttoRep;
		uint256 demandAttoEth;
		uint256 earnedFeesAttoEth;
		uint48 timestamp;
	}

	mapping(address => QuestionSource) public questions;
	mapping(uint248 => mapping(uint256 => address)) public poolsByQuestion;

	struct UniverseSettlement {
		uint64 bookId;
		IERC20 recoveryToken;
		uint256 availableForkCashAttoEth;
		uint256 availableForkRecoveryAttoRep;
	}
	mapping(uint248 => UniverseSettlement) private universes;

	function bookIds(uint248 universeId) public view returns (uint64) {
		return universes[universeId].bookId;
	}

	function availableForkCashAttoEth(uint248 universeId) public view returns (uint256) {
		return universes[universeId].availableForkCashAttoEth;
	}

	function availableForkRecoveryAttoRep(uint248 universeId) public view returns (uint256) {
		return universes[universeId].availableForkRecoveryAttoRep;
	}

	function recoveryTokens(uint248 universeId) public view returns (IERC20) {
		return universes[universeId].recoveryToken;
	}

	event SettlementRepaired(uint248 indexed universeId, address indexed sponsor, uint256 cashAttoEth);
	event RecoveryRepFunded(uint248 indexed universeId, uint256 indexed questionId, address indexed payer, uint256 amountAttoRep);
	event RecoveryRepPaid(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 amountAttoRep);

	constructor(address authority, IERC20 token) {
		require(address(token).code.length != 0, 'Collateral token missing');
		collateralToken = token;
		require(authority != address(0), 'Invalid settlement authority');
		portfolio = authority;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio || msg.sender == services, 'Only portfolio');
		_;
	}

	modifier onlyForkAuthority() {
		require(msg.sender == portfolio || (portfolio.code.length != 0 && msg.sender == IPortfolioForkAuthority(portfolio).forkController()), 'Only portfolio fork authority');
		_;
	}

	modifier nonReentrant() {
		require(!entered, 'Settlement reentry');
		entered = true;
		_;
		entered = false;
	}

	function authorizeServices(address serviceAuthority) external {
		require(msg.sender == portfolio, 'Only portfolio');
		require(services == address(0) && serviceAuthority != address(0), 'Settlement services initialized');
		services = serviceAuthority;
	}

	function initialize(SecurityPoolSettlementBook book) external onlyPortfolio {
		require(address(ledger) == address(0) && address(book) != address(0), 'Settlement ledger initialized');
		require(book.portfolio() == address(this), 'Incorrect settlement ledger authority');
		ledger = book;
	}

	function registerUniverse(uint248 universeId, uint48 timestamp) external onlyPortfolio returns (uint64 bookId) {
		require(universes[universeId].bookId == 0, 'Settlement universe registered');
		bookId = ledger.createBook(timestamp);
		ledger.setFeeAccrualEnabled(bookId, false, timestamp);
		universes[universeId].bookId = bookId;
	}

	function registerQuestion(address pool, uint248 universeId, uint256 questionId) external onlyPortfolio {
		require(pool != address(0) && !questions[pool].registered, 'Settlement question registered');
		require(poolsByQuestion[universeId][questionId] == address(0), 'Settlement question already canonical');
		_bookId(universeId);
		questions[pool] = QuestionSource(universeId, questionId, true);
		poolsByQuestion[universeId][questionId] = pool;
	}

	function mint(address pool, uint256 cash, uint256 minimumShares, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 shares, Snapshot memory snapshot) {
		return _mint(pool, msg.sender, cash, minimumShares, 0, timestamp);
	}

	function mintWithRecoveryRep(address pool, address payer, uint256 cash, uint256 minimumShares, uint256 maximumRecoveryAttoRep, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 shares, Snapshot memory snapshot) {
		return _mint(pool, payer, cash, minimumShares, maximumRecoveryAttoRep, timestamp);
	}

	function _mint(address pool, address payer, uint256 cash, uint256 minimumShares, uint256 maximumRecoveryAttoRep, uint48 timestamp) private returns (uint256 shares, Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		ledger.checkpointFees(bookId, timestamp);
		uint256 recoveryAttoRep = ledger.quoteMintRecoveryRep(bookId, source.questionId, cash);
		require(recoveryAttoRep <= maximumRecoveryAttoRep, 'Recovery REP exceeds budget');
		if (recoveryAttoRep != 0) {
			Collateral.pull(universes[source.universeId].recoveryToken, payer, address(this), recoveryAttoRep);
			emit RecoveryRepFunded(source.universeId, source.questionId, payer, recoveryAttoRep);
		}
		// Services atomically funds collateral before the native pool callback.
		if (msg.sender != services) Collateral.pull(collateralToken, msg.sender, address(this), cash);
		shares = ledger.mintWithRecoveryRep(bookId, source.questionId, cash, minimumShares, recoveryAttoRep, timestamp);
		snapshot = _snapshot(source, _collectFees(bookId));
	}

	function redeem(address pool, address recipient, uint256 shares, uint256 minimumCashAttoEth, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 cashAttoEth, Snapshot memory snapshot) {
		require(recipient != address(0), 'Invalid settlement recipient');
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		uint256 recoveryAttoRep;
		(cashAttoEth, , recoveryAttoRep) = ledger.redeem(bookId, source.questionId, shares, minimumCashAttoEth, timestamp);
		snapshot = _snapshot(source, _collectFees(bookId));
		_payRecoveryRep(source, recipient, recoveryAttoRep);
		_sendEth(recipient, cashAttoEth);
	}

	/// @notice Reserve a mature ledger claim even if its native child pool has not been deployed.
	function finalizeQuestion(uint248 universeId, uint256 questionId) external {
		require(!entered, 'Settlement reentry');
		IPortfolioForkAuthority root = IPortfolioForkAuthority(portfolio);
		require(root.zoltar().getForkTime(universeId) == 0, 'Settlement universe forked');
		uint64 bookId = _bookId(universeId);
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.checkpoint();
		ledger.finalizeQuestion(bookId, questionId, root.portfolioTime(universeId));
		capital.checkpoint();
	}

	function checkpointQuestion(address pool, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		(, , , , bool isSealed) = ledger.totals(bookId);
		if (!isSealed) ledger.finalizeQuestion(bookId, source.questionId, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	function replaceFeeStream(address pool, uint96 rateAttoEthPerSecond, uint48 end, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		ledger.replaceFeeStream(bookId, source.questionId, rateAttoEthPerSecond, end, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	/// @notice Reporting first stops its time fee, then installs a bound irreversible deadline.
	function scheduleFinality(address pool, uint48 finalAfter, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		ledger.replaceFeeStream(bookId, source.questionId, 0, 0, timestamp);
		ledger.scheduleFinality(bookId, source.questionId, finalAfter, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	function checkpointUniverse(uint248 universeId, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 earnedFeesAttoEth, uint256 demandAttoEth) {
		uint64 bookId = _bookId(universeId);
		(, , , , bool isSealed) = ledger.totals(bookId);
		if (!isSealed) ledger.checkpointFees(bookId, timestamp);
		earnedFeesAttoEth = _collectFees(bookId);
		(demandAttoEth, , , , ) = ledger.totals(bookId);
	}

	function setFeesEnabled(uint248 universeId, bool enabled, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 earnedFeesAttoEth, uint256 demandAttoEth) {
		uint64 bookId = _bookId(universeId);
		ledger.setFeeAccrualEnabled(bookId, enabled, timestamp);
		earnedFeesAttoEth = _collectFees(bookId);
		(demandAttoEth, , , , ) = ledger.totals(bookId);
	}

	function feeTimestamp(uint248 universeId) external view returns (uint48) {
		return ledger.feeTimestamp(_bookId(universeId));
	}

	function setFeeClock(uint248 universeId, uint48 nativeTimestamp) external onlyForkAuthority nonReentrant {
		ledger.setFeeClock(_bookId(universeId), nativeTimestamp);
	}

	function sealUniverse(uint248 universeId, uint48 timestamp) external onlyForkAuthority nonReentrant returns (uint256 cashAttoEth, uint256 units, uint256 earnedFeesAttoEth) {
		uint64 bookId = _bookId(universeId);
		ledger.sealForFork(bookId, timestamp);
		(cashAttoEth, , , , ) = ledger.totals(bookId);
		units = ledger.scaledUnits(bookId);
		universes[universeId].availableForkCashAttoEth = cashAttoEth;
		universes[universeId].availableForkRecoveryAttoRep = ledger.recoveryRep(bookId);
		earnedFeesAttoEth = _collectFees(bookId);
	}

	/// @notice Fund one child's claim basket with assigned collateral and forfeited child REP.
	/// @dev Pull auctionCash collateral tokens from the fork authority. Only assigned source
	/// cash consumes the parent's balance; unsold and old recovery REP stay claims.
	function createChildUniverse(uint248 sourceUniverseId, uint248 childUniverseId, uint256 parentContributionAttoEth, IERC20 recoveryToken, uint256 recoveryAttoRep, uint256 auctionCash) external onlyForkAuthority nonReentrant returns (uint64 bookId) {
		require(universes[childUniverseId].bookId == 0, 'Settlement universe registered');
		uint256 available = universes[sourceUniverseId].availableForkCashAttoEth;
		require(parentContributionAttoEth <= available, 'Fork settlement cash insufficient');
		universes[sourceUniverseId].availableForkCashAttoEth = available - parentContributionAttoEth;
		Collateral.pull(collateralToken, msg.sender, address(this), auctionCash);
		bookId = ledger.createChildBook(_bookId(sourceUniverseId), parentContributionAttoEth + auctionCash, recoveryAttoRep);
		(, , , uint48 timestamp, ) = ledger.totals(bookId);
		ledger.setFeeAccrualEnabled(bookId, false, timestamp);
		universes[childUniverseId].bookId = bookId;
		universes[childUniverseId].recoveryToken = recoveryToken;
		if (recoveryAttoRep != 0) recoveryToken.safeTransferFrom(msg.sender, address(this), recoveryAttoRep);
	}

	/// @notice A fork fixes its triggering question even before a native child pool exists.
	function fixInheritedQuestionFinality(uint248 universeId, uint256 questionId, uint48 finalAfter) external onlyForkAuthority nonReentrant {
		uint64 bookId = _bookId(universeId);
		(SecurityPoolSettlementBook.Question memory state, uint64 frozenBookId) = ledger.question(bookId, questionId);
		if (frozenBookId != 0 || state.outcomeSupplyAttoShares == 0) return;
		(, , , uint48 timestamp, ) = ledger.totals(bookId);
		ledger.replaceFeeStream(bookId, questionId, 0, 0, timestamp);
		ledger.scheduleFinality(bookId, questionId, finalAfter, timestamp);
	}

	/// @notice Transfer an explicit part of unassigned source cash to the portfolio's recovery book.
	function withdrawForkRecoveryCash(uint248 universeId, uint256 cashAttoEth) external onlyForkAuthority nonReentrant {
		require(cashAttoEth <= universes[universeId].availableForkCashAttoEth, 'Fork settlement cash insufficient');
		universes[universeId].availableForkCashAttoEth -= cashAttoEth;
		_sendEth(msg.sender, cashAttoEth);
	}

	/// @notice Migrate only live claim REP once; finalized source REP stays payable.
	function withdrawForkRecoveryRep(uint248 universeId) external onlyForkAuthority nonReentrant returns (uint256 recoveryAttoRep) {
		recoveryAttoRep = universes[universeId].availableForkRecoveryAttoRep;
		universes[universeId].availableForkRecoveryAttoRep = 0;
		if (recoveryAttoRep != 0) universes[universeId].recoveryToken.safeTransfer(msg.sender, recoveryAttoRep);
	}

	function snapshotQuestion(address pool) external view returns (Snapshot memory) {
		return _snapshot(_question(pool), 0);
	}

	/// @notice Scheduled claims have already stopped their holding-fee stream.
	function isQuestionScheduled(address pool) external view returns (bool) {
		QuestionSource memory source = _question(pool);
		(SecurityPoolSettlementBook.Question memory state, ) = ledger.scaledQuestion(_bookId(source.universeId), source.questionId);
		return state.finalAfter != 0;
	}

	function quoteRedemption(address pool, uint256 shares) external view returns (uint256 cashAttoEth) {
		QuestionSource memory source = _question(pool);
		(cashAttoEth, ) = ledger.quoteRedemption(_bookId(source.universeId), source.questionId, shares);
	}

	function quoteRedemptionAt(address pool, uint256 shares, uint48 portfolioTimestamp) external view returns (uint256 cashAttoEth) {
		QuestionSource memory source = _question(pool);
		(cashAttoEth, ) = ledger.quoteRedemptionAt(_bookId(source.universeId), source.questionId, shares, portfolioTimestamp);
	}

	function quoteRecoveryRep(address pool, uint256 shares) external view returns (uint256) {
		QuestionSource memory source = _question(pool);
		return ledger.quoteRecoveryRep(_bookId(source.universeId), source.questionId, shares);
	}

	/// @notice Restore an impaired branch by replacing its entire active cash
	/// deficit while preserving every inherited recovery REP entitlement.
	/// This is a donation: no shares, commitments or REP are paid to the sponsor.
	/// The deficit is read after the checkpoint, so redemptions and finality that
	/// move it before inclusion do not invalidate a donor's bounded transaction.
	/// @param maximumCashAttoEth Largest deficit the sponsor agrees to supply.
	/// @return cashAttoEth The live deficit pulled from the sponsor.
	function topUp(uint248 universeId, uint256 maximumCashAttoEth) external returns (uint256 cashAttoEth) {
		require(!entered, 'Settlement reentry');
		IPortfolioForkAuthority root = IPortfolioForkAuthority(portfolio);
		require(root.zoltar().getForkTime(universeId) == 0, 'Settlement universe forked');
		// Checkpoint before taking the custody lock: capital's normal callback
		// enters this settlement to pause stale time and protect finalized claims.
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.checkpoint();
		uint64 bookId = _bookId(universeId);
		(, , , uint48 timestamp, ) = ledger.totals(bookId);
		// Protect already-final claims at the old exchange rate, then release
		// their capital demand before the donation reprices the live basket.
		if (ledger.freezeMatured(bookId, timestamp) != 0) capital.checkpoint();
		cashAttoEth = _repair(universeId, maximumCashAttoEth);
		// The custody lock is released before capital synchronizes the repaired
		// cash demand through its ordinary settlement callback.
		capital.checkpoint();
	}

	function _repair(uint248 universeId, uint256 maximumCashAttoEth) private nonReentrant returns (uint256 cashAttoEth) {
		uint64 bookId = _bookId(universeId);
		(uint256 demand, , , , ) = ledger.totals(bookId);
		uint256 required = ledger.requiredCash(bookId);
		require(required > demand, 'No settlement deficit');
		cashAttoEth = required - demand;
		require(cashAttoEth <= maximumCashAttoEth, 'Settlement deficit exceeds maximum');
		Collateral.pull(collateralToken, msg.sender, address(this), cashAttoEth);
		ledger.topUp(bookId, cashAttoEth);
		IPortfolioForkAuthority(portfolio).capitalLedger(universeId).recordSettlementRepair(required);
		emit SettlementRepaired(universeId, msg.sender, cashAttoEth);
	}

	function quoteMint(address pool, uint256 cashAttoEth) external view returns (uint256) {
		QuestionSource memory source = _question(pool);
		return ledger.quoteMint(_bookId(source.universeId), source.questionId, cashAttoEth);
	}

	function _snapshot(QuestionSource memory source, uint256 fees) private view returns (Snapshot memory snapshot) {
		uint64 bookId = _bookId(source.universeId);
		(SecurityPoolSettlementBook.Question memory state, uint64 frozenBookId) = ledger.question(bookId, source.questionId);
		if (frozenBookId != 0) {
			(, , uint64 sourceBookId, ) = ledger.frozenBooks(frozenBookId);
			if (sourceBookId != bookId) {
				(snapshot.demandAttoEth, , , snapshot.timestamp, ) = ledger.totals(bookId);
				snapshot.earnedFeesAttoEth = fees;
				return snapshot;
			}
		}
		snapshot.outcomeSupplyAttoShares = state.outcomeSupplyAttoShares;
		if (state.outcomeSupplyAttoShares != 0)
			(snapshot.questionCashAttoEth, ) = ledger.quoteRedemption(bookId, source.questionId, state.outcomeSupplyAttoShares);
		if (state.outcomeSupplyAttoShares != 0)
			snapshot.questionRecoveryAttoRep = ledger.quoteRecoveryRep(bookId, source.questionId, state.outcomeSupplyAttoShares);
		(snapshot.demandAttoEth, , , snapshot.timestamp, ) = ledger.totals(bookId);
		snapshot.earnedFeesAttoEth = fees;
	}

	function _collectFees(uint64 bookId) private returns (uint256 cashAttoEth) {
		(, , cashAttoEth, , ) = ledger.totals(bookId);
		if (cashAttoEth == 0) return 0;
		ledger.collectFees(bookId, cashAttoEth);
		_sendEth(msg.sender == services ? services : portfolio, cashAttoEth);
	}

	function _question(address pool) private view returns (QuestionSource memory source) {
		source = questions[pool];
		require(source.registered, 'Unknown settlement question');
	}

	function _bookId(uint248 universeId) private view returns (uint64 bookId) {
		bookId = universes[universeId].bookId;
		require(bookId != 0, 'Unknown settlement universe');
	}

	function _sendEth(address recipient, uint256 cashAttoEth) private {
		if (cashAttoEth == 0) return;
		Collateral.send(collateralToken, recipient, cashAttoEth);
	}

	function _payRecoveryRep(QuestionSource memory source, address recipient, uint256 amount) private {
		if (amount == 0) return;
		universes[source.universeId].recoveryToken.safeTransfer(recipient, amount);
		emit RecoveryRepPaid(source.universeId, source.questionId, recipient, amount);
	}
}
