import Inv48EscrowPrefixCreate
import Inv48EscrowTraceShape
open SolidCore.Solidity.Source Inv32Shapes
namespace Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def immutablePattern (name : String) : Pattern Expr where
  value := .immutable name
  test | .immutable n => n == name | _ => false
  sound v h := by
    split at h
    next n =>
      have eq := beq_iff_eq.mp h
      simp only [eq]
    · contradiction

def plainEncoding : Pattern EncodeKind where
  value := .plain
  test | .plain => true | _ => false
  sound v h := by cases v <;> simp_all

def constructorPattern : Pattern Expr := EscrowTrace.encPattern plainEncoding Option_none
  (seq []) (seq [EscrowTrace.addressPattern,EscrowTrace.addressPattern,
    EscrowTrace.addressPattern,EscrowTrace.addressPattern,Ty_uint256])
  (seq [Expr_var (lit "sponsor"),immutablePattern "openOracle",
    immutablePattern "collateralToken",Expr_var (lit "rep"),Expr_var (lit "callbackGasLimit")])

def creationPattern : Pattern Expr where
  value := creationExpr
  test
    | .contractCreate name args (.word 0) none true =>
        (name == "SharedPoolReportEscrow") && constructorPattern.test args
    | _ => false
  sound v h := by
    split at h
    next name args =>
      simp only [Bool.and_eq_true,beq_iff_eq] at h
      have a := constructorPattern.sound args h.2
      simp only [h.1,a]
      rfl
    · contradiction

def pullKey := "__internal___library_Collateral_pull(address,address,address,uint256)#[SolidCore.Solidity.Ty.user { segments := [\"IERC20_1\"] },\n SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.address false,\n SolidCore.Solidity.Ty.uint 256]"
def pullArgs : List Expr := [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2",.var "_ic_arg_3"]
def pullCall : Stmt := .captureReturn [] (.internalCall [] pullKey pullArgs)

def pullPattern : Pattern Stmt := Stmt_captureReturn (seq [])
  (Stmt_internalCall (seq []) (lit pullKey)
    (seq [Expr_var (lit "_ic_arg_0"),Expr_var (lit "_ic_arg_1"),
      Expr_var (lit "_ic_arg_2"),Expr_var (lit "_ic_arg_3")]))

def actualPullLast : Option Stmt :=
  match (Inv48.EscrowTrace.actualStatements[5]? : Option Stmt) with
  | some (Stmt.block ss) => ss.getLast?
  | _ => none

/-- Indexed certificate against the fresh public executable model. -/
theorem actualCreation : EscrowTrace.actualStatements[4]? =
    some (.assign (.var "escrow") creationExpr) :=
  (Option_some (Stmt_assign (LValue_var (lit "escrow")) creationPattern)).sound (Inv48.EscrowTrace.actualStatements[4]?)
    (by native_decide)

theorem actualPull : actualPullLast = some pullCall :=
  (Option_some pullPattern).sound actualPullLast (by native_decide)

#print axioms actualCreation
#print axioms actualPull
end Inv48.EscrowPrefix
