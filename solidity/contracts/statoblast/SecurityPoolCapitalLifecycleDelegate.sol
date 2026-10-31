// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalState } from './SecurityPoolCapitalState.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { ICapitalPriceExposure, ICapitalLedgerAccounting } from './interfaces/ICapitalAccounting.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';

interface ICapitalLifecycleHost {
	function portfolio() external view returns (address);
	function universeId() external view returns (uint248);
	function securityMultiplierBps() external view returns (uint256);
	function ownerConservativePrice(address owner) external view returns (uint256);
	function repToken() external view returns (IERC20);
	function zoltar() external view returns (Zoltar);
	function maximumHealthyPrice(uint256 rep, uint256 commitment) external view returns (uint256);
	function isPriceValid() external view returns (bool);
}

/// @notice Owner registration and bounded fork choices in the custody ledger's context.
/// @dev Direct calls and delegatecalls from any other host are rejected. Ledger
/// wrappers guard owner authorization and authenticate fork accounting callers.
contract SecurityPoolCapitalLifecycleDelegate is SecurityPoolCapitalState {
	using SafeERC20Ops for IERC20;
	address public immutable ledger;
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amount);
	event EarningsClaimed(address indexed owner, uint256 attoEth, uint256 attoRep);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	constructor(address host) {
		ledger = host;
	}
	modifier onlyLedger() {
		require(address(this) == ledger, 'Only capital ledger context');
		_;
	}

	/// @dev The ledger authenticates the portfolio, validates the input, and
	/// checkpoints all old-price income before forwarding its canonical feed.
	function acceptPrice(ICapitalPriceExposure feed, uint256 price, uint48 validUntil) external onlyLedger {
		uint256 uncertainty = feed.targetPriceErrorForDispute();
		acceptedPriceEpoch = feed.acceptedEpoch();
		require(uncertainty < 10_000_000, 'Invalid oracle uncertainty');
		acceptedPrice = price;
		conservativePrice = Math.mulDiv(price, 10_000_000, 10_000_000 - uncertainty, Math.Rounding.Ceil);
		liquidationPrice = Math.mulDiv(price, 10_000_000, 10_000_000 + uncertainty);
		require(liquidationPrice != 0, 'Liquidation price rounds to zero');
		priceValidUntil = validUntil;
		// Child reports can fund the fork auction before capital activation.
		// Imported positions have no operating health history until imports seal.
		if (!importing) commitmentIndex.observeHealthy(liquidationPrice);
		emit CapitalPriceAccepted(price, validUntil);
	}

	/// @dev The ledger has already checkpointed fees, served prior retirements,
	/// and required an open universe with a fresh accepted price.
	function authorize(uint256 commitment, uint256 reportId, bool useReport, uint256 minimumCommitment) external onlyLedger returns (uint96 id) {
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 health = _target(owner);
		require(commitment >= minimumCommitment, 'Commitment below minimum');
		id = owner.positionId;
		SecurityPoolCommitmentIndex.Account memory old;
		if (id != 0) old = commitmentIndex.accountOf(id);
		require(old.batch == 0, 'Cancel retirement first');
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(host.portfolio()).priceFeed(host.universeId()));
		if (useReport) {
			(, uint256 totalCommitment) = commitmentIndex.totals();
			(uint256 reportPrice, uint256 epoch) = feed.reportAuthorization(reportId, Math.max(demandAttoEth, totalCommitment - old.commitment + commitment));
			require(epoch == acceptedPriceEpoch, 'Capital price epoch changed');
			fundingPriceFloor[msg.sender] = Math.max(host.ownerConservativePrice(msg.sender), reportPrice);
			fundingPriceEpoch[msg.sender] = epoch;
		}
		uint256 rep = owner.freeAttoRep + old.rep;
		require(rep >= commitmentIndex.requiredRep(commitment, host.ownerConservativePrice(msg.sender), host.securityMultiplierBps(), health), 'Chosen health target unmet');
		// Owners cannot bypass a closed retirement cohort with direct reductions.
		require(commitment >= old.commitment, 'Retire before reducing');
		totalFreeAttoRep -= owner.freeAttoRep;
		owner.freeAttoRep = 0;
		if (id == 0) {
			id = commitmentIndex.create(msg.sender, rep, commitment, host.maximumHealthyPrice(rep, commitment));
			owner.positionId = id;
		} else {
			uint256 maxPrice = host.maximumHealthyPrice(rep, commitment);
			commitmentIndex.replace(id, rep, commitment, maxPrice);
			if (maxPrice >= liquidationPrice) commitmentIndex.clearLiquidation(id);
		}
		if (!useReport) feed.validateExposure();
		emit CommitmentAuthorized(msg.sender, id, rep, commitment, health);
	}

	/// @dev These owner operations run after the ledger checkpoints old income.
	function withdrawPrincipal(uint256 amount, address recipient) external onlyLedger {
		require(recipient != address(0) && amount > 0, 'Invalid capital withdrawal');
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 free = Math.min(amount, owner.freeAttoRep);
		owner.freeAttoRep -= free;
		totalFreeAttoRep -= free;
		uint256 pledged = amount - free;
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		if (pledged != 0) {
			require(owner.positionId != 0 && msg.sender != forkAuthority, 'Insufficient owner principal');
			require(!importing && host.zoltar().getForkTime(host.universeId()) == 0 && !frozen, 'Capital universe inactive');
			require(host.isPriceValid(), 'Capital price stale');
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			require(pledged <= position.rep && position.rep - pledged >= commitmentIndex.requiredRep(position.commitment, host.ownerConservativePrice(msg.sender), host.securityMultiplierBps(), _target(owner)), 'Owner collateral too low');
			uint256 maxPrice = host.maximumHealthyPrice(position.rep - pledged, position.commitment);
			commitmentIndex.replace(owner.positionId, position.rep - pledged, position.commitment, maxPrice);
			if (position.commitment == 0 || maxPrice >= liquidationPrice)
				commitmentIndex.clearLiquidation(owner.positionId);
		}
		host.repToken().safeTransfer(recipient, amount);
		emit PrincipalWithdrawn(msg.sender, recipient, amount);
	}
	function claimEarnings() external onlyLedger {
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 ethAmount = owner.feesAttoEth;
		uint256 repAmount = owner.feesAttoRep;
		owner.feesAttoEth = 0;
		owner.feesAttoRep = 0;
		if (repAmount != 0) ICapitalLifecycleHost(address(this)).repToken().safeTransfer(msg.sender, repAmount);
		_sendEth(msg.sender, ethAmount);
		emit EarningsClaimed(msg.sender, ethAmount, repAmount);
	}

	function exportChoice(address owner) external onlyLedger returns (ChoicePosition memory choice, uint256 target) {
		require(frozen && !exported[owner], 'Fork choice unavailable');
		_settleOwner(owner);
		Owner storage account = owners[owner];
		uint96 id = account.positionId;
		if (id != 0) {
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(id);
			uint96 batch;
			if (position.batch != 0) batch = position.batch == commitmentIndex.currentBatch() ? 1 : 2;
			choice = ChoicePosition(position.rep, position.commitment, batch, position.remainingCommitment);
		}
		exported[owner] = true;
		target = _target(account);
	}
	function beginForkImport() external onlyLedger {
		(uint256 rep, uint256 commitment) = commitmentIndex.totals();
		require(rep == 0 && commitment == 0 && !importing, 'Capital already used');
		importing = true;
		commitmentIndex.initCohorts(1, 2);
	}
	function importChoice(address owner, ChoicePosition calldata position, uint256 target) external onlyLedger {
		require(importing && target >= BPS, 'Fork import unavailable');
		Owner storage account = owners[owner];
		require(account.positionId == 0 && account.freeAttoRep == 0, 'Owner already imported');
		account.targetHealthFactorBps = target;
		require(position.commitment != 0 && position.rep != 0, 'Empty fork choice');
		uint96 id = commitmentIndex.importPosition(owner, position.rep, position.commitment, ICapitalLifecycleHost(address(this)).maximumHealthyPrice(position.rep, position.commitment), position.batch, position.remainingCommitment);
		account.positionId = id;
	}
	function finishForkImport(uint256 fundedDemand) external onlyLedger {
		require(importing, 'Fork import unavailable');
		(uint256 pledged, ) = commitmentIndex.totals();
		require(ICapitalLifecycleHost(address(this)).repToken().balanceOf(address(this)) >= pledged + totalFreeAttoRep + retirementCashAttoRep, 'Fork principal unfunded');
		commitmentIndex.sealImports();
		importing = false;
		demandAttoEth = fundedDemand;
		if (ICapitalLifecycleHost(address(this)).isPriceValid()) commitmentIndex.observeHealthy(liquidationPrice);
	}
	function releaseForkBacking() external onlyLedger {
		require(frozen && !migrationPrepared, 'Fork backing release unavailable');
		migrationPrepared = true;
		if (frozenBackingAttoRep != 0)
			ICapitalLifecycleHost(address(this)).repToken().safeTransfer(msg.sender, frozenBackingAttoRep);
	}
}
