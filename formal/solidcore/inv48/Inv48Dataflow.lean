import Inv48SourceLinks
open SolidCore.Solidity
namespace Inv48.Imported

def precision : Expr := .member (.typeName (.user ⟨["SecurityPoolUtils"]⟩)) "PRICE_PRECISION"
def ceiling : Expr := .member (.typeName (.user ⟨["Math", "Rounding"]⟩)) "Ceil"
def mathCall (name : String) (args : List Expr) : Expr :=
  .call (.member (.typeName (.user ⟨["Math"]⟩)) name) (args.map Arg.positional)
def quoteField (name : String) : Expr := .member (.ident "quote") name

theorem quote_collateral_source :
    (statements "_quoteReportFunding")[1]? = some
      (.expr (.assign (quoteField "collateralAmount") .assign (.ident "requestedInitialAttoWeth"))) := by rfl

theorem quote_rep_ceiling_source :
    (statements "_quoteReportFunding")[2]? = some
      (.expr (.assign (quoteField "repAttoRep") .assign
        (mathCall "mulDiv" [quoteField "collateralAmount", .ident "proposedRepPerEthPrice", precision, ceiling]))) := by rfl

theorem escrow_rep_transfer_source :
    (statements "createReportEscrow")[4]? = some
      (.expr (.call (.ident "require") [
        .positional (.call (.member (.ident "rep") "transferFrom") [
          .positional (.ident "payer"),
          .positional (.call (.typeName (.address false)) [.positional (.ident "escrow")]),
          .positional (.ident "repAmount")]),
        .positional (.literal (.string "REP transfer for initial report failed"))])) := by rfl

theorem report_escrow_arguments_source :
    (statements "_requestPrice")[10]? = some
      (.block [
        .varDecl [⟨some "#result0", some (.uint 256), none⟩,
          ⟨some "#result1", some (.user ⟨["SharedPoolReportEscrow"]⟩), none⟩]
          (some (.call (.member (.ident "this") "createReportEscrow") [
            .positional (.member (.ident "msg") "sender"), .positional (.ident "sponsor"),
            .positional (quoteField "collateralAmount"), .positional (quoteField "repAttoRep"),
            .positional (quoteField "haltAttoEth"), .positional (.ident "bountyAttoEth"),
            .positional (.ident "callbackGasLimit")])),
        .expr (.assign (.ident "escrow") .assign (.ident "#result1")),
        .expr (.assign (.ident "reportId") .assign (.ident "#result0"))]) := by rfl

theorem public_minimum_formula_source :
    functionBody "minimumToken1ReportAttoEthForPrice" = some
      (.block [
        .expr (.call (.ident "require") [
          .positional (.binary .ne (.ident "proposedRepPerEthPrice") (.literal (.number "0"))),
          .positional (.literal (.string "Initial oracle price zero"))]),
        .block [
          .varDecl [⟨some "#view47500", some (.uint 256), none⟩]
            (some (.call (.member (.typeName (.user ⟨["OraclePriceMath"]⟩)) "liquidationPrice") [
              .positional (.ident "proposedRepPerEthPrice"),
              .positional (.ident "targetPriceErrorForDispute")])),
          .expr (.call (.ident "require") [
            .positional (.binary .ne (.ident "#view47500") (.literal (.number "0"))),
            .positional (.literal (.string "Oracle liquidation price is zero"))])],
        .returnValues (some (mathCall "max" [
          .call (.ident "minimumToken1ReportAttoEth") [],
          mathCall "mulDiv" [.call (.ident "minimumToken2ReportAttoRep") [], precision,
            .ident "proposedRepPerEthPrice", ceiling]]))]) := by rfl

def constantValue (contract : ContractDecl) (name : String) : Option Nat :=
  contract.items.findSome? fun item =>
    match item with
    | .stateVar decl =>
      if decl.name = name then
        match decl.init with
        | some (.literal (.number text)) => Executable.parseNumberNat? text
        | _ => none
      else none
    | _ => none

theorem actual_precision : constantValue Target77_2.importedContractDecl25 "PRICE_PRECISION" = some (10^18) := by decide

theorem actual_divider : constantValue Target77_2.importedContract "OPEN_INTEREST_DIVIDER" = some 100 := by decide

#print axioms actual_precision
#print axioms actual_divider
#print axioms public_minimum_formula_source
#print axioms quote_collateral_source
#print axioms quote_rep_ceiling_source
#print axioms escrow_rep_transfer_source
#print axioms report_escrow_arguments_source
end Inv48.Imported
