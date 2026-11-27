import Inv48LiquidationGuardRecovery
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def prologue : List Stmt := match actualMinimumBody with
  | .block [a,b,_] => [a,b]
  | _ => []
def inner : List Stmt := match actualMinimumBody with
  | .block [_,_,.block ss] => ss
  | _ => []
def guardCode : Stmt := match inner with
  | _::g::_ => g
  | _ => .skip
def initial : List Stmt := inner.take 1
def tail : List Stmt := inner.drop 2

theorem bodyForm : actualMinimumBody = .block (prologue ++ [.block (initial ++ [guardCode] ++ tail)]) := by rfl

structure GetterPath (n : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) where
  outside : Runtime
  positive : Runtime
  guarded : Runtime
  value : Result
  prologueTrace : Interaction.Transcript
  initialTrace : Interaction.Transcript
  guardTrace : Interaction.Transcript
  tailTrace : Interaction.Transcript
  split : tr = prologueTrace ++ (initialTrace ++ (guardTrace ++ tailTrace))
  prologueRun : Interaction.Executes (Stmt.evalList (n+4) Inv48.Source.model.core.table c r.pushScope prologue)
    prologueTrace (.ok (.normal outside))
  initialRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c outside.pushScope initial)
    initialTrace (.ok (.normal positive))
  guardRun : Interaction.Executes (Stmt.eval (n+3) Inv48.Source.model.core.table c positive guardCode)
    guardTrace (.ok (.normal guarded))
  tailRun : Interaction.Executes (Stmt.evalList (n+3) Inv48.Source.model.core.table c guarded tail)
    tailTrace (.ok value)
  originalResult : out = (value.mapRuntime Runtime.popScope).mapRuntime Runtime.popScope

theorem getterPath (n : Nat) (c : Context) (r : Runtime)
    (tr : Interaction.Transcript) (out : Result) (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r actualMinimumBody)
      tr (.ok out)) : Nonempty (GetterPath n c r tr out) := by
  rw [bodyForm] at run
  obtain ⟨k,outer,eq,outEq,outerRun⟩ := block _ _ _ _ _ _ _ run
  have kEq : k = n+4 := by omega
  subst k
  have outerOrd := popOrdinary outer (by rwa [outEq] at ordinary)
  obtain ⟨outside,pt,it,sp,pre,inside⟩ := listPrefix _ _ _ _ _ _ _ _ (by decide) outerOrd outerRun
  have inside := singleton _ _ _ _ _ _ _ inside
  obtain ⟨k,value,eq2,outerEq,list⟩ := block _ _ _ _ _ _ _ inside
  have kEq : k = n+3 := by omega
  subst k
  have valueOrd := popOrdinary value (by rwa [outerEq] at outerOrd)
  obtain ⟨positive,zt,rest,sp2,zero,restRun⟩ := listPrefix _ _ _ _ initial ([guardCode] ++ tail) _ _ (by decide) valueOrd list
  obtain ⟨guarded,gt,tt,sp3,guard,last⟩ := listPrefix _ _ _ _ [guardCode] tail _ _ (by decide) valueOrd restRun
  exact ⟨⟨outside,positive,guarded,value,pt,zt,gt,tt,by rw [sp,sp2,sp3],pre,zero,
    singleton _ _ _ _ _ _ _ guard,last,by rw [outEq,outerEq]⟩⟩

#print axioms getterPath
end GuardRecovery
