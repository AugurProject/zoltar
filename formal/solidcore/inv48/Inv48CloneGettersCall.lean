import Inv48CloneGettersLibrary
open SolidCore.Solidity.Source
namespace Inv48.CloneGetters
open Inv48.SymbolicClone Inv48.CloneRead
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem library_finish (fn : InternalFunction) (base : Runtime) (code : List Nat)
    (u t : Nat) (targets : List String)
    (returns : fn.returns = [⟨"universe",.uint256,false⟩,⟨"token",.address,false⟩]) :
    internalCallFinish fn targets base.locals (.normal (callee (post base code) u t)) =
      internalCallAssign (post base code) targets [.word u,.word t] := by
  simp [internalCallFinish,returns,collectReturnBindingsRef,collectReturnBindingsRef.collect,
    callee,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?,Runtime.derefMemoryValueDeep,
    Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Runtime.derefMemoryValue,
    Bind.bind,Except.bind,post,Runtime.allocMemory]

theorem library_call (n : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (targets : List String) (fn : InternalFunction)
    (found : table.lookup? cloneKey = some fn)
    (params : fn.params = [])
    (returns : fn.returns = [⟨"universe",.uint256,false⟩,⟨"token",.address,false⟩])
    (body : fn.body = libraryBody)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256)
    (selfWord : c.self < R)
    (boundary : base.state.envAccountCode c c.self = runtimeCode implementation universeBytes token) :
    Stmt.eval (n+39) table c base (.internalCall targets cloneKey []) =
      internalCallAssign (post base (runtimeCode implementation universeBytes token)) targets
        [.word (decode universeBytes),.word (decode token)] := by
  have enter : internalCallEnter? fn [] base = some (callee base 0 0,base.locals) := by
    simp [internalCallEnter?,InternalFunction.initialFrame?,params,BindingDecl.bindArgsRef?,
      InternalFunction.returnDefaultBindings,returns,BindingDecl.defaultBinding,Ty.defaultValue,callee]
  rw [Stmt.eval]
  change (match table.lookup? cloneKey with
    | none => pure (Result.reverted base .typeMismatch)
    | some f => match internalCallEnter? f [] base with
      | none => pure (Result.reverted base .typeMismatch)
      | some (r,s) => Stmt.eval (n+38) table {c with checked := true} r f.body >>= internalCallFinish f targets s) = _
  simp only [found,enter,body]
  rw [library_body n table {c with checked := true} base implementation universeBytes token hi hu ht cu ct selfWord boundary]
  simp only [pb]
  exact library_finish fn base _ _ _ targets returns

end Inv48.CloneGetters
