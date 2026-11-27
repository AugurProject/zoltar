import Inv48LiquidationGetterSuccess
import Inv48LiquidationGuardReadOnly
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def guardPrefix : List Stmt := match guardCode with
  | .block ss => ss.take 2
  | _ => []
def viewDecl : Stmt := match guardCode with
  | .block [_,_,d,_] => d
  | _ => .skip
def guardCondition : Expr := .binary .ne (.castOp .uintCleanup 256 (.var "#view47500")) (.word 0)
def guardRequire : Stmt := .requireStmt guardCondition (some "Oracle liquidation price is zero")
theorem guardForm : guardCode = .block (guardPrefix ++ [viewDecl,guardRequire]) := by rfl

structure GuardPassage (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript) where
  computed : Runtime
  declared : Runtime
  prefixTrace : Interaction.Transcript
  declarationTrace : Interaction.Transcript
  split : tr = prefixTrace ++ declarationTrace
  prefixRun : Interaction.Executes (Stmt.evalList (n+2) Inv48.Source.model.core.table c r.pushScope guardPrefix)
    prefixTrace (.ok (.normal computed))
  declarationRun : Interaction.Executes (Stmt.eval (n+2) Inv48.Source.model.core.table c computed viewDecl)
    declarationTrace (.ok (.normal declared))
  accepted : ∃ v w, Expr.eval c declared guardCondition = pure (v,declared) ∧
    v.expectWord = .ok w ∧ wordTruthy w = true
  frame : final = declared.popScope

theorem guardPassage (n : Nat) (c : Context) (r final : Runtime)
    (tr : Interaction.Transcript)
    (run : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c r guardCode)
      tr (.ok (.normal final))) : Nonempty (GuardPassage n c r final tr) := by
  rw [guardForm] at run
  obtain ⟨k,value,eq,outEq,list⟩ := block _ _ _ _ _ _ _ run
  have kEq : k = n+2 := by omega
  subst k
  cases value <;> simp only [Result.mapRuntime] at outEq
  all_goals try contradiction
  case normal last =>
    have finalEq := Result.normal.inj outEq
    obtain ⟨computed,pt,rest,sp,preRun,lastRun⟩ := listPrefix _ _ _ _ guardPrefix [viewDecl,guardRequire] _ _
      (by decide) (by simp [Escapes]) list
    obtain ⟨declared,dt,gt,sp2,decl,gate⟩ := listPrefix _ _ _ _ [viewDecl] [guardRequire] _ _
      (by decide) (by simp [Escapes]) lastRun
    have decl := singleton _ _ _ _ _ _ _ decl
    have gate := singleton _ _ _ _ _ _ _ gate
    have safe : ReadOnly guardCondition := .binary .ne (by intro h; cases h) (by intro h; cases h)
      (.cleanup 256 (.var _)) (.word 0)
    obtain ⟨gn,frame,accepted⟩ := requirePassage (n+1) _ c declared last guardCondition
      (some "Oracle liquidation price is zero") safe gt gate
    subst last
    exact ⟨⟨computed,declared,pt,dt,by rw [sp,sp2,gn,List.append_nil],preRun,decl,accepted,finalEq⟩⟩

theorem sameExecution (path : GetterPath n c r tr out) :
    Nonempty (GuardPassage n c path.positive path.guarded path.guardTrace) :=
  guardPassage n c path.positive path.guarded path.guardTrace path.guardRun

#print axioms guardPassage
#print axioms sameExecution
end GuardRecovery
