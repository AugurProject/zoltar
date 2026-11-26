import Inv39TransferBinding
import Inv39Fetch
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath
namespace Inv39.Transfer
theorem returns (e : Expr) (c : Context) (r : Runtime) (v : Nat) (t : FunctionTable) (n : Nat)
    (h : e.evalReturnValue c r = pure (.word v,r)) :
    Stmt.eval (n+1) t c r (.returnValues [e]) = pure (.returned r [.word v]) := by
  have vals : Expr.evalReturnList c r [e] = pure ([.word v],r) := by
    unfold Expr.evalReturnList
    change Expr.evalReturnListFuel (_+1) c r [e] = _
    rw [Expr.evalReturnListFuel]
    change (do let (v,s) ← e.evalReturnValue c r; let (vs,s') ← Expr.evalReturnListFuel _ c s []; pure (v::vs,s'))=_
    rw [h]; rfl
  rw [Stmt.eval]; dsimp only; rw [vals]; rfl
theorem senderRun (n : Nat) (c : Context) (r : Runtime) (t : FunctionTable) :
    Stmt.eval (n+3) t c r senderShape.value = pure (.returned r [.word c.sender]) := by
  let inner := r.pushScope.pushScope
  have tail := returns .caller c inner c.sender t n (by rfl)
  have block := blockReturned _ t c r.pushScope inner _ _ (stop _ _ _ _ _ _ [] _ tail)
  have skip : Stmt.eval (n+2) t c r.pushScope .skip = pure (.normal r.pushScope) := by rw [Stmt.eval]
  apply blockReturned (next:=r.pushScope)
  exact (seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ block)
theorem senderCall (n : Nat) (c : Context) (r : Runtime) (targets : List String) :
    Stmt.eval (n+4) model.core.table c r (.internalCall targets senderKey []) = internalCallAssign r targets [.word c.sender] := by
  obtain ⟨f,found,ps,rs,bd⟩ := helper
  let inner := {r with locals:=[[("_ret0",.word 0)]]}
  have enter : internalCallEnter? f [] r=some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,inner]
  have body := senderRun n {c with checked:=true} inner model.core.table
  rw [←bd] at body
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (by rfl) found enter body]
  have ret : coerceReturnBindingsRef f.returns inner [.word c.sender]=.ok [.word c.sender] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl
def stateRet (r : Runtime) (v w : Nat) := (Child.stateTmp r v).pushScope.declareLocal result (.word w)
macro "write_sender" : tactic => `(tactic| simp [stateRet,Child.stateTmp,Child.tmp,tmp,result,Runtime.lookupLocal?,Runtime.assignLocal?,Runtime.pushScope,
    Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?, *])
theorem zeroAddress (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) :
    Stmt.eval (n+1) t c r (.varDecl .address name none) = pure (.normal (r.declareLocal name (.word 0))) := by
  rw [Stmt.eval]; dsimp only; rw [Ty.defaultValue]
theorem fetchRun (n : Nat) (c : Context) (r : Runtime) :
    Stmt.eval (n+6) model.core.table c (Child.stateTmp r 0) fetch.value = pure (.normal (Child.stateTmp r c.sender)) := by
  let t := model.core.table
  have zero := zeroAddress (n+4) t c (Child.stateTmp r 0).pushScope result
  have call := senderCall n c (stateRet r 0 0) [result]
  have cap := Inv32Hoist.takeReturn _ _ _ _ (stateRet r 0 c.sender) _ _ _ _ call (by write_sender)
  have copy := Inv32Hoist.lastCopy (n+4) t c (stateRet r 0 c.sender) (stateRet r c.sender c.sender) tmp result 0 c.sender
    (by write_sender) (by write_sender) (by write_sender)
  exact Inv32Hoist.block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ cap).trans copy))
end Inv39.Transfer
