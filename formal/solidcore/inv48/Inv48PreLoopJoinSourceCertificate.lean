import Inv48PreLoopJoinRead
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.PreLoopJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def cleanPrefix : List Stmt := [Inv32FloorFastPath.cleanParam "proposedRepPerEthPrice",
  Inv32FloorFastPath.cleanParam "requestedInitialAttoWeth",Inv32FloorFastPath.cleanParam "bountyAttoEth",.skip,.skip]
def field (i : Nat) : Expr := .castOp .uintCleanup 256 (.index (.var "batch") (.word i))
def settlementDeadline : Expr := .castOp .uintCleanup 256 (.castOp .uintCleanup 256
  (.binary .add (.castOp .uintCleanup 256 (.env .blockTimestamp))
    (.castOp .uintCleanup 256 (.immutable "settlementTime"))))
def first : Expr := .binary .ge (field 3) settlementDeadline
def second : Expr := .binary .boolAnd (.binary .ge (field 2) (field 1))
  (.binary .ne (field 2) (.word 0))
def third : Expr := .binary .ne (.castOp .uintCleanup 256 (.length (.index (.var "batch") (.word 4)))) (.word 0)
def guards : List Stmt := [.requireStmt first (some "Report operations expire before settlement"),
  .requireStmt second (some "Invalid operation price bounds"),.requireStmt third (some "No report operations")]
def initialPrefix : List Stmt := guards ++ [.varDecl .uint256 "requiredGas" none]
open Inv32Shapes Inv48.OperationsWrapperArgs

def geP : Pattern BinaryOp where
  value := .ge
  test | .ge => true | _ => false
  sound v h := by cases v <;> first | rfl | cases h
def andP : Pattern BinaryOp where
  value := .boolAnd
  test | .boolAnd => true | _ => false
  sound v h := by cases v <;> first | rfl | cases h
def timestampP : Pattern Expr where
  value := .env .blockTimestamp
  test | .env .blockTimestamp => true | _ => false
  sound v h := by cases v <;> try cases h
                  case env w => cases w <;> first | rfl | cases h

def fieldP (i : Nat) := P_Expr_castOp P_CastKind_uintCleanup (lit 256)
  (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit i)))
def settlementTimeP : Pattern Expr where
  value := .immutable "settlementTime"
  test | .immutable name => name == "settlementTime" | _ => false
  sound v h := by
    cases v <;> try cases h
    case immutable name =>
      have eq : name = "settlementTime" := by simpa using h
      rw [eq]
def settlementDeadlineP := P_Expr_castOp P_CastKind_uintCleanup (lit 256)
  (P_Expr_castOp P_CastKind_uintCleanup (lit 256)
    (P_Expr_binary P_BinaryOp_add
      (P_Expr_castOp P_CastKind_uintCleanup (lit 256) timestampP)
      (P_Expr_castOp P_CastKind_uintCleanup (lit 256) settlementTimeP)))
def firstP := P_Expr_binary geP (fieldP 3) settlementDeadlineP
def secondP := P_Expr_binary andP (P_Expr_binary geP (fieldP 2) (fieldP 1))
  (P_Expr_binary P_BinaryOp_ne (fieldP 2) (P_Expr_word (lit 0)))
def thirdP := P_Expr_binary P_BinaryOp_ne
  (P_Expr_castOp P_CastKind_uintCleanup (lit 256)
    (P_Expr_length (P_Expr_index (P_Expr_var (lit "batch")) (P_Expr_word (lit 4)))))
  (P_Expr_word (lit 0))
def initialP := seq [P_Stmt_requireStmt firstP (Option_some (lit "Report operations expire before settlement")),
  P_Stmt_requireStmt secondP (Option_some (lit "Invalid operation price bounds")),
  P_Stmt_requireStmt thirdP (Option_some (lit "No report operations")),
  P_Stmt_varDecl Ty_uint256 (lit "requiredGas") Option_none]
def cleanP := seq [Inv48.RequestPrologue.cleanupP 256 "proposedRepPerEthPrice",
  Inv48.RequestPrologue.cleanupP 256 "requestedInitialAttoWeth",
  Inv48.RequestPrologue.cleanupP 256 "bountyAttoEth",Stmt_skip,Stmt_skip]
def prefixCheck := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  cleanP.test ((Inv48.OperationsPublicEntry.outerStatements fn).take 5) &&
  initialP.test ((Inv48.OperationsWrapperArgs.mainStatements fn).take 4)
theorem checkedPrefixes : prefixCheck = true := by native_decide

end Inv48.PreLoopJoin
