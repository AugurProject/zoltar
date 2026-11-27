import Inv48CloneGettersWrappers
import Inv48CloneGettersCert
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem call_body (fuel : Nat) (table : FunctionTable) (c : Context) (base inner : Runtime)
    (key : String) (targets : List String) (fn : InternalFunction) (out : Result)
    (found : table.lookup? key = some fn)
    (enter : internalCallEnter? fn [] base = some (inner,base.locals))
    (body : Stmt.eval fuel table {c with checked := true} inner fn.body = pure out) :
    Stmt.eval (fuel+1) table c base (.internalCall targets key []) =
      internalCallFinish fn targets base.locals out := by
  rw [Stmt.eval]
  change (match table.lookup? key with
    | none => pure (Result.reverted base .typeMismatch)
    | some f => match internalCallEnter? f [] base with
      | none => pure (Result.reverted base .typeMismatch)
      | some (r,s) => Stmt.eval fuel table {c with checked := true} r f.body >>= internalCallFinish f targets s) = _
  simp only [found,enter,body,pb]

theorem universe_finish (base : Runtime) (code : List Nat) (u : Nat) (targets : List String) :
    internalCallFinish universeFn targets base.locals (.normal (uStart (post base code) u)) =
      internalCallAssign (post base code) targets [.word u] := by
  simp [internalCallFinish,universeFn,universeFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,collectReturnBindingsRef,
    collectReturnBindingsRef.collect,uStart,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,
    Bind.bind,Except.bind,post,Runtime.allocMemory]

theorem reputation_finish (base : Runtime) (code : List Nat) (t : Nat) (targets : List String) :
    internalCallFinish reputationFn targets base.locals (.returned (tStart (post base code)) [.word t]) =
      internalCallAssign (post base code) targets [.word t] := by
  simp [internalCallFinish,reputationFn,reputationFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,coerceReturnBindingsRef,
    coerceReturnBindingsRef.coerce,tStart,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind,post,Runtime.allocMemory]

theorem universe_call (n : Nat) (c : Context) (base : Runtime) (targets : List String)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+44) Inv48.Source.model.core.table c base (.internalCall targets universeKey []) =
      internalCallAssign (post base (runtimeCode implementation universeBytes token)) targets [.word (decode universeBytes)] := by
  rw [call_body (n+43) _ c base (uStart base 0) universeKey targets universeFn _ universe_lookup
    (by simp [internalCallEnter?,InternalFunction.initialFrame?,universeFn,universeFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,uStart])
    (universe_body n _ {c with checked := true} base library_lookup implementation universeBytes token hi hu ht cu ct selfWord boundary)]
  exact universe_finish base _ _ targets

theorem reputation_call (n : Nat) (c : Context) (base : Runtime) (targets : List String)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+43) Inv48.Source.model.core.table c base (.internalCall targets reputationKey []) =
      internalCallAssign (post base (runtimeCode implementation universeBytes token)) targets [.word (decode token)] := by
  rw [call_body (n+42) _ c base (tStart base) reputationKey targets reputationFn _ reputation_lookup
    (by simp [internalCallEnter?,InternalFunction.initialFrame?,reputationFn,reputationFnPattern,fnPattern,Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,binding,addrPattern,Inv32Shapes.Ty_uint256,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,tStart])
    (reputation_body n _ {c with checked := true} base library_lookup implementation universeBytes token hi hu ht cu ct selfWord boundary)]
  exact reputation_finish base _ _ targets

theorem bindings_call (n : Nat) (c : Context) (base : Runtime) (targets : List String)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+39) Inv48.Source.model.core.table c base (.internalCall targets cloneKey []) =
      internalCallAssign (post base (runtimeCode implementation universeBytes token)) targets
        [.word (decode universeBytes),.word (decode token)] :=
  library_call n _ c base targets libraryFn library_lookup rfl rfl rfl
    implementation universeBytes token hi hu ht cu ct selfWord boundary

end Inv48.CloneGetters
