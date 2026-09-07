// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './Constants.sol';
import { ERC20 } from './ERC20.sol';
import { ERC20Authorization } from './vendor/authorization/ERC20Authorization.sol';

contract ReputationToken is ERC20Authorization {
	uint256 private totalTheoreticalSupplyAttoRep;
	address public immutable zoltar;
	uint248 public universeId;
	uint256 public repNumber;
	event Mint(address indexed account, uint256 valueAttoRep);
	event Burn(address indexed account, uint256 valueAttoRep, uint256 totalTheoreticalSupplyAttoRep);
	event TheoreticalSupplySet(uint256 totalTheoreticalSupplyAttoRep);
	event ReputationTokenInitialized(uint248 indexed universeId, uint256 indexed repNumber, string name, string symbol, uint256 totalTheoreticalSupplyAttoRep);

	modifier isZoltar() {
		require(msg.sender == zoltar, 'ReputationToken caller must be the Zoltar contract');
		_;
	}

	constructor(address _zoltar) ERC20('Reputation', 'REP') {
		require(_zoltar != address(0), 'Zoltar must not be the zero address');
		zoltar = _zoltar;
	}

	function initialize(uint248 universeId_, uint256 totalTheoreticalSupplyAttoRep_, uint256 repNumber_) external isZoltar {
		require(repNumber == 0, 'Reputation token already initialized');
		require(universeId_ != 0, 'Child universe ID must be non-zero');
		require(repNumber_ != 0, 'REP number must be non-zero');
		require(totalTheoreticalSupplyAttoRep_ <= Constants.MAX_ATTO_REP, 'Theoretical supply exceeds maximum REP');
		require(totalTheoreticalSupplyAttoRep_ != 0, 'Theoretical supply must be non-zero');
		universeId = universeId_;
		repNumber = repNumber_;
		string memory number = _toString(repNumber_);
		_name = string.concat('Augur Reputation ', number);
		_symbol = string.concat('REP', number);
		totalTheoreticalSupplyAttoRep = totalTheoreticalSupplyAttoRep_;
		emit TheoreticalSupplySet(totalTheoreticalSupplyAttoRep);
		emit ReputationTokenInitialized(universeId_, repNumber_, _name, _symbol, totalTheoreticalSupplyAttoRep_);
	}

	function mint(address account, uint256 valueAttoRep) external isZoltar {
		// Defense in depth: preserve the theoretical-supply invariant even if future
		// migration accounting changes accidentally route an oversized mint here.
		require(totalSupply() + valueAttoRep <= totalTheoreticalSupplyAttoRep, 'Mint exceeds theoretical supply');
		_mint(account, valueAttoRep);
		emit Mint(account, valueAttoRep);
	}

	function burn(address account, uint256 valueAttoRep) external isZoltar {
		_burn(account, valueAttoRep);
		totalTheoreticalSupplyAttoRep -= valueAttoRep;
		emit Burn(account, valueAttoRep, totalTheoreticalSupplyAttoRep);
	}

	function getTotalTheoreticalSupplyAttoRep() external view returns (uint256) {
		return totalTheoreticalSupplyAttoRep;
	}

	function _toString(uint256 value) private pure returns (string memory) {
		uint256 digits = 1;
		uint256 remaining = value;
		while (remaining >= 10) {
			remaining /= 10;
			digits++;
		}
		bytes memory buffer = new bytes(digits);
		while (value != 0) {
			digits--;
			buffer[digits] = bytes1(uint8(48 + (value % 10)));
			value /= 10;
		}
		return string(buffer);
	}
}
