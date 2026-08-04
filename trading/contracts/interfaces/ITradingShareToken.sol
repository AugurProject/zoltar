// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IShareToken } from '../../../solidity/contracts/peripherals/interfaces/IShareToken.sol';
import { IERC1155 } from '../../../solidity/contracts/peripherals/interfaces/IERC1155.sol';

interface ITradingShareToken is IShareToken, IERC1155 {}
