import Inv39MarkerExecution
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init.Marker

theorem observedMarker {guard store marked : Runtime} {closed : Result}
    {publicPost : State} {rep : Nat} {c : Context} {ng ns : Nat}
    (fields : c.storageFields=model.core.context.storageFields)
    (glook : guard.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)))
    (grun : (Stmt.eval (ng+1) model.core.table c guard repGuard).runWith []=.ok (.normal guard))
    (slook : store.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)))
    (srun : (Stmt.eval (ns+1) model.core.table c store repStore).runWith []=.ok (.normal marked))
    (tail : Suffix marked.state closed.runtime.state)
    (abi : publicPost.storage=closed.runtime.state.storage) :
    Shared.norm (publicPost.loadSlot 7)=Shared.norm rep ∧ Shared.norm (publicPost.loadSlot 7)≠0 :=
  markerOfReachability c rep publicPost fields ⟨guard,guard,store,marked,ng,ns,glook,grun,slook,srun,.same tail abi⟩
#print axioms observedMarker
end Inv39.Init.Marker
