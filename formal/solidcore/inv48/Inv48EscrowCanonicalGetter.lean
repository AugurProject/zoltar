import Inv48EscrowEntryFinal
import Inv48CloneGettersResults
open SolidCore.Solidity.Source
namespace Inv48.EscrowEntry
open Inv48.CloneGetters Inv48.CloneRead Inv48.SymbolicClone
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
theorem canonicalLookup (n : Nat) (c : Context) (caller : Runtime)
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b∈universeBytes,b<256) (ct : ∀ b∈token,b<256) (selfWord : c.self<Inv32Division.R)
    (code : caller.state.envAccountCode c c.self=runtimeCode implementation universeBytes token) :
    LookupResponse (n+42) Inv48.Source.model.core.table c lookupFn caller
      (tStart (post caller (runtimeCode implementation universeBytes token))) (decode token) [] := by
  have eq : lookupFn=reputationFn := Option.some.inj (lookupFound.symm.trans reputation_lookup)
  rw [eq]
  refine ⟨tStart caller,?_,?_⟩
  · simp [internalCallEnter?,InternalFunction.initialFrame?,reputationFn,reputationFnPattern,fnPattern,
      Inv32Shapes.seq,Inv32Shapes.List_cons,Inv32Shapes.List_nil,CloneGetters.binding,CloneGetters.addrPattern,Inv32Shapes.Ty_uint256,
      InternalFunction.returnDefaultBindings,BindingDecl.bindArgsRef?,BindingDecl.defaultBinding,Ty.defaultValue,tStart]
  · rw [reputation_body n _ {c with checked:=true} caller library_lookup implementation universeBytes token hi hu ht cu ct selfWord code]
    exact .done _
#print axioms canonicalLookup
end Inv48.EscrowEntry
