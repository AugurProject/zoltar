import Inv48BatchLoopClosureDecode
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
open Inv48.EscrowPrefix Inv48.RequestGuards Inv48.RequestDispatch Inv48.RequestClassify Inv48.FundingFallthrough
namespace Inv48.OperationsPublicEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000
def batchGas : Expr := .index (.var "batch") (.word 0)
def gasRead : Expr := .castOp .uintCleanup 32 batchGas
def gasHoist : Stmt := .varDecl .uint256 "_sol_hoist_1" (some gasRead)
def budget : Expr := .binary .le (.castOp .uintCleanup 256 (.var "requiredGas"))
  (.castOp .uintCleanup 256 batchGas)
def budgetGuard : Stmt := .requireStmt budget (some "Operation gas budget insufficient")

def gasReadP := Inv48.OperationsWrapperArgs.P_Expr_castOp
  Inv48.OperationsWrapperArgs.P_CastKind_uintCleanup (lit 32)
  (Inv48.OperationsWrapperArgs.P_Expr_index
    (Inv48.OperationsWrapperArgs.P_Expr_var (lit "batch"))
    (Inv48.OperationsWrapperArgs.P_Expr_word (lit 0)))
def gasHoistP := Inv48.OperationsWrapperArgs.P_Stmt_varDecl Ty_uint256
  (lit "_sol_hoist_1") (Option_some gasReadP)
def budgetP := Inv48.OperationsWrapperArgs.P_Stmt_requireStmt
  (Inv48.OperationsWrapperArgs.P_Expr_binary Inv48.OperationsWrapperArgs.P_BinaryOp_le
    (Inv48.OperationsWrapperArgs.P_Expr_castOp Inv48.OperationsWrapperArgs.P_CastKind_uintCleanup (lit 256)
      (Inv48.OperationsWrapperArgs.P_Expr_var (lit "requiredGas")))
    (Inv48.OperationsWrapperArgs.P_Expr_castOp Inv48.OperationsWrapperArgs.P_CastKind_uintCleanup (lit 256)
      (Inv48.OperationsWrapperArgs.P_Expr_index
        (Inv48.OperationsWrapperArgs.P_Expr_var (lit "batch"))
        (Inv48.OperationsWrapperArgs.P_Expr_word (lit 0)))))
  (Option_some (lit "Operation gas budget insufficient"))
def gasNodesCheck := Inv48.OperationsWrapperArgs.wrapper.any fun fn =>
  ((Inv48.OperationsWrapperArgs.mainStatements fn)[5]?.any budgetP.test) &&
  ((Inv48.OperationsWrapperArgs.mainStatements fn)[6]?.any gasHoistP.test)
theorem checkedGasNodes : gasNodesCheck = true := by native_decide

theorem actualGasNodes (fn : FunctionDef)
    (found : Inv48.OperationsWrapperArgs.wrapper = some fn) :
    (Inv48.OperationsWrapperArgs.mainStatements fn)[5]? = some budgetGuard ∧
    (Inv48.OperationsWrapperArgs.mainStatements fn)[6]? = some gasHoist := by
  have h := checkedGasNodes
  simp only [gasNodesCheck,found,Option.any_some,Bool.and_eq_true] at h
  have get {α : Type} (p : Pattern α) (v : Option α) (h : v.any p.test = true) : v = some p.value := by
    cases v with
    | none => contradiction
    | some v => exact congrArg some (p.sound v h)
  exact ⟨get _ _ h.1,get _ _ h.2⟩

end Inv48.OperationsPublicEntry
