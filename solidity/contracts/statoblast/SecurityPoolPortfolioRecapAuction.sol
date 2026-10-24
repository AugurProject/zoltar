// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Constants } from '../Constants.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Fixed-window discounted recap purchases, selling free surplus first.
/// @dev The coordinator installs the buyer's personal collateral and commitment in
/// the same transaction as commitFill. There are no pending bids or winner claims.
/// Neither fill nor finalization visits previous buyers.
contract SecurityPoolPortfolioRecapAuction {
	uint256 private constant PRICE_PRECISION = 1e18;
	uint256 private constant BPS = 10_000;
	uint256 private constant MIN_FILL_SIZE_DIVISOR = 100_000;
	uint256 public constant reservePriceAttoEthPerRep = 1;

	struct Configuration {
		address owner;
		uint48 choiceDeadline;
		uint48 recapitalizationDeadline;
		uint256 unchosenRepAttoRep;
		uint256 missingCashAttoEth;
		uint256 referencePriceAttoRepPerEth;
		uint256 startingPriceAttoEthPerRep;
		uint256 securityMultiplierBps;
		uint256 maximumCommitmentAttoEth;
	}

	address public immutable owner;
	uint48 public immutable choiceDeadline;
	uint48 public immutable recapitalizationDeadline;
	uint256 public immutable unchosenRepAttoRep;
	uint256 public immutable missingCashAttoEth;
	uint48 public immutable priceFloorTimestamp;
	uint256 public immutable referencePriceAttoRepPerEth;
	uint256 public immutable securityMultiplierBps;
	uint256 public immutable startingPriceAttoEthPerRep;
	uint256 public immutable maximumRepSoldAttoRep;
	uint256 public immutable maximumCommitmentAttoEth;
	uint256 private immutable minimumCashFillAttoEth;
	uint256 private immutable minimumRepFillAttoRep;
	uint256 public raisedAttoEth;
	uint256 public soldAttoRep;
	uint256 public assignedCommitmentAttoEth;
	uint256 public pendingProceedsAttoEth;
	bool public finalized;

	event RecapPurchased(address indexed buyer, uint256 rep, uint256 commitment, uint256 cost, uint256 price);
	event AuctionFinalized(uint256 raisedAttoEth, uint256 soldAttoRep, uint256 assignedCommitmentAttoEth, uint256 protectedRepAttoRep);
	event ProceedsWithdrawn(uint256 amountAttoEth);

	constructor(Configuration memory configuration) {
		require(configuration.owner != address(0), 'Recap owner is missing');
		require(configuration.choiceDeadline != 0 && configuration.recapitalizationDeadline > configuration.choiceDeadline, 'Invalid fixed recap deadlines');
		require(configuration.unchosenRepAttoRep <= Constants.MAX_ATTO_REP, 'Recap REP inventory exceeds supply');
		require(configuration.missingCashAttoEth <= type(uint128).max, 'Recap cash requirement is too large');
		require(configuration.referencePriceAttoRepPerEth != 0, 'Recap reference price is zero');
		require(configuration.startingPriceAttoEthPerRep >= reservePriceAttoEthPerRep, 'Recap starting price is below reserve');
		require(configuration.securityMultiplierBps > BPS, 'Recap backing multiplier must exceed one');
		require(configuration.unchosenRepAttoRep != 0 || configuration.maximumCommitmentAttoEth == 0, 'Empty inventory has commitment');
		owner = configuration.owner;
		choiceDeadline = configuration.choiceDeadline;
		recapitalizationDeadline = configuration.recapitalizationDeadline;
		unchosenRepAttoRep = configuration.unchosenRepAttoRep;
		missingCashAttoEth = configuration.missingCashAttoEth;
		priceFloorTimestamp =
			configuration.choiceDeadline +
			uint48((uint256(configuration.recapitalizationDeadline - configuration.choiceDeadline) * 3) / 4);
		referencePriceAttoRepPerEth = configuration.referencePriceAttoRepPerEth;
		securityMultiplierBps = configuration.securityMultiplierBps;
		startingPriceAttoEthPerRep = configuration.startingPriceAttoEthPerRep;
		maximumRepSoldAttoRep = configuration.unchosenRepAttoRep;
		maximumCommitmentAttoEth = configuration.maximumCommitmentAttoEth;
		require(configuration.maximumCommitmentAttoEth <= _retainedCapacity(configuration.unchosenRepAttoRep), 'Recap reserve cannot back commitment');
		minimumCashFillAttoEth = Math.max(1, configuration.missingCashAttoEth / MIN_FILL_SIZE_DIVISOR);
		minimumRepFillAttoRep = Math.max(1, configuration.unchosenRepAttoRep / MIN_FILL_SIZE_DIVISOR);
	}

	modifier onlyOwner() {
		require(msg.sender == owner, 'Only the portfolio can coordinate recapitalization');
		_;
	}

	function priceAt(uint256 timestamp) public view returns (uint256) {
		if (timestamp >= priceFloorTimestamp) return reservePriceAttoEthPerRep;
		if (timestamp <= choiceDeadline) return startingPriceAttoEthPerRep;
		return
			reservePriceAttoEthPerRep +
			Math.mulDiv(startingPriceAttoEthPerRep - reservePriceAttoEthPerRep, priceFloorTimestamp - timestamp, priceFloorTimestamp - choiceDeadline);
	}

	/// @dev Match the capital ledger's nested rounding exactly. Sold REP first
	/// consumes free surplus; further sales transfer only the commitment that the
	/// unsold REP can no longer secure. The buyer funds that commitment atomically.
	function _retainedCapacity(uint256 rep) private view returns (uint256) {
		return Math.mulDiv(Math.mulDiv(rep, BPS, securityMultiplierBps), PRICE_PRECISION, referencePriceAttoRepPerEth);
	}

	/// @notice A discount also lowers the minimum cash payment. A fixed ETH
	/// minimum would prevent partial buyers from reaching discounted inventory.
	function minimumFillAttoEth() public view returns (uint256) {
		return
			Math.min(minimumCashFillAttoEth, Math.mulDiv(minimumRepFillAttoRep, priceAt(block.timestamp), PRICE_PRECISION, Math.Rounding.Ceil));
	}

	/// @notice Cost is rounded up; inventory and cumulative commitment are exact.
	/// The caller may send the returned cost with maximumRep set to the quoted REP.
	function quote(uint256 maximumEth, uint256 maximumRep) public view returns (uint256 rep, uint256 commitment, uint256 cost) {
		require(!finalized && block.timestamp >= choiceDeadline && block.timestamp < recapitalizationDeadline, 'Recap purchases are closed');
		uint256 remainingCash = missingCashAttoEth - raisedAttoEth;
		uint256 budget = Math.min(maximumEth, remainingCash);
		uint256 price = priceAt(block.timestamp);
		rep = Math.min(maximumRep, Math.min(maximumRepSoldAttoRep - soldAttoRep, Math.mulDiv(budget, PRICE_PRECISION, price)));
		if (rep == 0) return (0, 0, 0);
		cost = Math.mulDiv(rep, price, PRICE_PRECISION, Math.Rounding.Ceil);
		commitment =
			maximumCommitmentAttoEth -
			Math.min(maximumCommitmentAttoEth, _retainedCapacity(unchosenRepAttoRep - soldAttoRep - rep)) -
			assignedCommitmentAttoEth;
	}

	/// @dev Only the coordinator can fill, after authenticating the buyer's consent
	/// and atomically installing their funded position. The outer transaction must
	/// revert if either collateral transfer or capital import fails.
	function commitFill(address buyer, uint256 maximumRep, uint256 maximumCommitment) external payable onlyOwner returns (uint256 rep, uint256 commitment, uint256 cost) {
		require(buyer != address(0), 'Recap buyer is missing');
		(rep, commitment, cost) = quote(msg.value, maximumRep);
		require(rep != 0 && cost == msg.value, 'Recap payment must equal quoted cost');
		require(commitment <= maximumCommitment, 'Recap commitment exceeds buyer consent');
		require(cost >= minimumFillAttoEth() || soldAttoRep + rep == maximumRepSoldAttoRep || raisedAttoEth + cost == missingCashAttoEth, 'Recap purchase is too small');
		soldAttoRep += rep;
		raisedAttoEth += cost;
		assignedCommitmentAttoEth += commitment;
		pendingProceedsAttoEth += cost;
		emit RecapPurchased(buyer, rep, commitment, cost, priceAt(block.timestamp));
	}

	function retainedCommitmentAttoEth() external view returns (uint256) {
		return maximumCommitmentAttoEth - assignedCommitmentAttoEth;
	}

	/// @notice The original deadline closes even an empty or partially filled sale.
	function finalize() external onlyOwner {
		require(!finalized, 'Recap auction is already final');
		require(block.timestamp >= recapitalizationDeadline, 'Recap purchases are still active');
		finalized = true;
		emit AuctionFinalized(raisedAttoEth, soldAttoRep, assignedCommitmentAttoEth, unchosenRepAttoRep - soldAttoRep);
	}

	function withdrawProceeds() external onlyOwner {
		require(finalized, 'Recap auction is not final');
		uint256 amount = pendingProceedsAttoEth;
		require(amount != 0, 'No recap proceeds are pending');
		pendingProceedsAttoEth = 0;
		emit ProceedsWithdrawn(amount);
		(bool sent, ) = payable(owner).call{value: amount}('');
		require(sent, 'Recap proceeds transfer failed');
	}
}
