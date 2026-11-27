import Inv39GuardBinding
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart
namespace Inv39.Child
theorem getterCall (n : Nat) (c : Context) (r : Runtime) (targets : List String)
    (fields : c.storageFields=model.core.context.storageFields) (v : Nat) (atSlot : r.state.loadSlot circulating.slot=v) (fit : v<R) :
    Stmt.eval (n+4) model.core.table c r (.internalCall targets getterKey []) = internalCallAssign r targets [.word v] := by
  obtain ⟨f,found,ps,rs,bd⟩ := internalGetter
  let inner := {r with locals:=[[("_ret0",.word 0)]]}
  have enter : internalCallEnter? f [] r=some (inner,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Internal.wordBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,inner]
  have slot : WordField.stored inner.state (Getter.field .actual)=v := atSlot
  have body := Getter.run .actual model.core.table {c with checked:=true} inner n fields (slot ▸ fit)
  rw [slot,←bd] at body
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (by rfl) found enter body]
  have ret : coerceReturnBindingsRef f.returns inner [.word v]=.ok [.word v] := by
    rw [rs]; simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Internal.wordBindings,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl
def stateTmp (r : Runtime) (v : Nat) := r.pushScope.declareLocal tmp (.word v)
def stateRet (r : Runtime) (v w : Nat) := (stateTmp r v).pushScope.declareLocal supplyRet (.word w)
macro "write_fetch" : tactic => `(tactic| simp [stateRet,stateTmp,tmp,supplyRet,Runtime.lookupLocal?,Runtime.assignLocal?,Runtime.pushScope,
    Runtime.declareLocal,LocalEnv.declare,LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?, *])
theorem fetchRun (n : Nat) (c : Context) (r : Runtime) (v : Nat)
    (fields : c.storageFields=model.core.context.storageFields) (atSlot : r.state.loadSlot circulating.slot=v) (fit : v<R) :
    Stmt.eval (n+6) model.core.table c (stateTmp r 0) fetch.value = pure (.normal (stateTmp r v)) := by
  let t := model.core.table
  have zero := Inv32FloorStart.zero (n+4) t c (stateTmp r 0).pushScope supplyRet
  have call := getterCall n c (stateRet r 0 0) [supplyRet] fields v atSlot fit
  have cap := Inv32Hoist.takeReturn _ _ _ _ (stateRet r 0 v) _ _ _ _ call (by write_fetch)
  have copy := Inv32Hoist.lastCopy (n+4) t c (stateRet r 0 v) (stateRet r v v) tmp supplyRet 0 v
    (by write_fetch) (by write_fetch) (by write_fetch)
  exact Inv32Hoist.block _ _ _ _ _ _ ((seqStep _ _ _ _ _ _ _ zero).trans ((seqStep _ _ _ _ _ _ _ cap).trans copy))
end Inv39.Child
