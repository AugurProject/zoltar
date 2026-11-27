import Inv48WholeQuoteMinShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMinimumJoin
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536

/-- The quote calls the price-dependent getter, copies its returned word into
_sol_hoist_0, cleans that word into #view48027, and compares that exact local. -/
theorem minimumDataflow : minPrefix =
    [.varDecl .uint256 "_sol_hoist_0" none,
      Inv32OneArg.code "_sol_hoist_0" "_ret_minimumToken1ReportAttoEthForPrice_0"
        "__internal_minimumToken1ReportAttoEthForPrice(uint256)#[SolidCore.Solidity.Ty.uint 256]"
        .uint256 .uint256 (clean (.var "proposedRepPerEthPrice")),
      .varDecl .uint256 "#view48027" (some (clean (.var "_sol_hoist_0")))] ∧
    minP.value = .block (minPrefix ++ [minimumGuard "#view48027"]) := ⟨rfl,rfl⟩

/-- The exposure subtraction consumes the immutable floor. It does not consume
#view48027, the price-dependent minimum used by the entry guard. -/
theorem exposureDataflow : exposureExpr = clean (clean (.binary .mul
    (clean (clean (.binary .sub (clean (field 0)) (clean (.immutable "minimumReportCollateral")))))
    (.ternary (.word 1) (.word 100) (.word 100)))) := rfl

/-- The later halt calculation performs a fresh aggregate exposure call.
No equality with the earlier minimum getter's exposure reply is asserted. -/
theorem haltExposureDataflow : oracleCode = oracleP.map Inv32Shapes.Pattern.value := oracleCode_eq

#print axioms minimumDataflow
#print axioms exposureDataflow
#print axioms haltExposureDataflow
end Inv48.QuoteMinimumJoin
