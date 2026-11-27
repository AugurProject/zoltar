import Inv48EscrowJoinPull
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def pullBlockPattern : Pattern Stmt := Stmt_block (seq [
  Stmt_varDecl EscrowTrace.addressPattern (lit "_ic_arg_0")
    (Option_some (immutablePattern "collateralToken")),
  Stmt_varDecl EscrowTrace.addressPattern (lit "_ic_arg_1")
    (Option_some (Expr_var (lit "payer"))),
  Stmt_varDecl EscrowTrace.addressPattern (lit "_ic_arg_2")
    (Option_some (Expr_var (lit "escrow"))),
  Stmt_varDecl Ty_uint256 (lit "_ic_arg_3")
    (Option_some (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "wethAmount")))),
  pullPattern])

def consecutivePattern : Pattern (List Stmt) := seq [pullBlockPattern,
  Stmt_varDecl Ty_bool (lit "_sol_hoist_0") Option_none]

theorem actualPair : (EscrowTrace.actualStatements.drop 5).take 2 =
    [pullBlock,.varDecl .bool "_sol_hoist_0" none] :=
  consecutivePattern.sound _ (by native_decide)

theorem actualPullBlock : EscrowTrace.actualStatements[5]? = some pullBlock := by
  have h := congrArg (fun ss : List Stmt => ss[0]?) actualPair
  simpa using h

theorem actualBooleanDeclaration : EscrowTrace.actualStatements[6]? =
    some (.varDecl .bool "_sol_hoist_0" none) := by
  have h := congrArg (fun ss : List Stmt => ss[1]?) actualPair
  simpa using h

#print axioms actualPair
#print axioms actualPullBlock
#print axioms actualBooleanDeclaration
end Inv48.EscrowJoin
