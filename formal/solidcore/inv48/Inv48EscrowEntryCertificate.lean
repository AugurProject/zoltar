import Inv48EscrowEntryPrepare
import Inv32Shapes
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def paramPattern : Pattern (List BindingDecl) := seq [
  EscrowTrace.bindingPattern (lit "payer") EscrowTrace.addressPattern (lit false),
  EscrowTrace.bindingPattern (lit "sponsor") EscrowTrace.addressPattern (lit false),
  EscrowTrace.bindingPattern (lit "wethAmount") Ty_uint256 (lit false),
  EscrowTrace.bindingPattern (lit "repAmount") Ty_uint256 (lit false),
  EscrowTrace.bindingPattern (lit "haltAmount") Ty_uint256 (lit false),
  EscrowTrace.bindingPattern (lit "bounty") Ty_uint256 (lit false),
  EscrowTrace.bindingPattern (lit "callbackGasLimit") Ty_uint256 (lit false)]
def returnPattern : Pattern (List BindingDecl) := seq [
  EscrowTrace.bindingPattern (lit "id") Ty_uint256 (lit false),
  EscrowTrace.bindingPattern (lit "escrow") EscrowTrace.addressPattern (lit false)]
def cleanPattern (bits : Nat) (name : String) : Pattern Stmt :=
  Stmt_assign (LValue_var (lit name))
    (Expr_castOp CastKind_uintCleanup (lit bits) (Expr_var (lit name)))
def prologuePattern : Pattern (List Stmt) := seq [Stmt_skip,Stmt_skip,
  cleanPattern 256 "wethAmount",cleanPattern 256 "repAmount",cleanPattern 256 "haltAmount",
  cleanPattern 256 "bounty",cleanPattern 32 "callbackGasLimit",Stmt_skip,Stmt_skip]
def lookupBlockPattern : Pattern (List Stmt) := seq [
  Stmt_varDecl EscrowTrace.addressPattern (lit "_ret_reputationToken_0") Option_none,
  Stmt_captureReturn (seq [lit "_ret_reputationToken_0"])
    (Stmt_internalCall (seq [lit "_ret_reputationToken_0"])
      (lit "__internal_reputationToken()#[]") (seq [])),
  Stmt_assign (LValue_var (lit "_sol_hoist_0")) (Expr_var (lit "_ret_reputationToken_0"))]
def callerPattern : Pattern Expr where
  value := .caller
  test | .caller => true | _ => false
  sound v h := by cases v <;> simp_all
def selfPattern : Pattern Expr where
  value := .self
  test | .self => true | _ => false
  sound v h := by cases v <;> simp_all
def eqPattern : Pattern BinaryOp where
  value := .eq
  test | .eq => true | _ => false
  sound v h := by cases v <;> simp_all
def preparationPattern : Pattern (List Stmt) := seq [
  Stmt_requireStmt (Expr_binary eqPattern callerPattern selfPattern) (Option_some (lit "Only report creation")),
  Stmt_varDecl EscrowTrace.addressPattern (lit "_sol_hoist_0") Option_none,
  Stmt_block lookupBlockPattern,
  Stmt_varDecl EscrowTrace.addressPattern (lit "rep") (Option_some (Expr_var (lit "_sol_hoist_0")))]
def lookupReturnsPattern : Pattern (List BindingDecl) := seq [
  EscrowTrace.bindingPattern (lit "_ret0") EscrowTrace.addressPattern (lit false)]

def outerOf (f : FunctionDef) : List Stmt := match f.body with | .block ss => ss | _ => []
def innerOf (f : FunctionDef) : List Stmt := match ((outerOf f)[9]? : Option Stmt) with | some (.block ss) => ss | _ => []
def selections : Option (FunctionDef × InternalFunction) := do
  let f ← Inv48.Source.model.core.findFunctionByName? "createReportEscrow"
  let g ← Inv48.Source.model.core.table.lookup? "__internal_reputationToken()#[]"
  pure (f,g)
def testPair (p : FunctionDef × InternalFunction) : Bool :=
  paramPattern.test p.1.params && (returnPattern.test p.1.returns &&
  (!p.1.payable && (prologuePattern.test ((outerOf p.1).take 9) &&
  (((outerOf p.1).length == 10) && (preparationPattern.test ((innerOf p.1).take 4) &&
  ((match p.1.body with | .block _ => true | _ => false) &&
  ((match ((outerOf p.1)[9]? : Option Stmt) with | some (.block _) => true | _ => false) &&
  lookupReturnsPattern.test p.2.returns)))))))

theorem checkedPair : selections.any testPair = true := by native_decide


#print axioms checkedPair
end Inv48.EscrowEntry
