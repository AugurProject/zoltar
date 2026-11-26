import Inv39MarkerBinding
import Inv39MarkerTail
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.Marker
/-- Explicit residual execution obligations. These are NOT currently derived
from public dispatch success. In particular this is not a post-marker premise:
normal evaluation of the real guard, normal evaluation of the real store, and
an ordered suffix footprint must be supplied. Local bindings connect those
reached sites to the original argument after generated uint256 cleanup.

To close the unconditional public theorem one must extract these witnesses from
`callTargetWithContext?` success, transporting the cleaned local across earlier
requires and the universe store, and prove the actual decimal result has ≤78
bytes so that the two metadata writes inhabit Suffix. -/
structure Reachability (c : Context) (rep : Nat) (post : State) : Prop where
  reached : ∃ (guardRuntime guardNext storeRuntime markerRuntime : Runtime) (guardFuel storeFuel : Nat),
    guardRuntime.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) ∧
    SolI.runWith [] (Stmt.eval (guardFuel+1) model.core.table c guardRuntime repGuard)=.ok (.normal guardNext) ∧
    storeRuntime.lookupLocal? "repNumber_"=some (.word (Shared.norm rep)) ∧
    SolI.runWith [] (Stmt.eval (storeFuel+1) model.core.table c storeRuntime repStore)=.ok (.normal markerRuntime) ∧
    Suffix markerRuntime.state post
/-- Conditional marker obligation, with every residual reachability premise
visible in Reachability. No conclusion about post storage is assumed. -/
theorem markerOfReachability (c : Context) (rep : Nat) (post : State)
    (fields : c.storageFields=model.core.context.storageFields)
    (reach : Reachability c rep post) :
    Shared.norm (post.loadSlot 7)=Shared.norm rep ∧ Shared.norm (post.loadSlot 7)≠0 := by
  obtain ⟨guardRuntime,guardNext,storeRuntime,markerRuntime,guardFuel,storeFuel,
    guardLocal,guardRun,storeLocal,storeRun,suffix⟩ := reach.reached
  have idem : Shared.norm (Shared.norm rep)=Shared.norm rep := Nat.mod_mod _ _
  have nonzero : Shared.norm rep≠0 := by
    have nz := guardNonzero c guardRuntime guardNext (Shared.norm rep) guardFuel guardLocal guardRun
    rwa [idem] at nz
  have stored : Fold.Ensures (Stmt.eval (storeFuel+1) model.core.table c storeRuntime repStore)
      (fun res => res=Result.normal {storeRuntime with state:=storeRuntime.state.storeSlot 7 (Shared.norm rep)}) := by
    rw [storeExec c storeRuntime (Shared.norm rep) storeFuel fields storeLocal,idem]
    exact Fold.pureValue _ _ rfl
  unfold Fold.Ensures at stored
  have eq := stored (.normal markerRuntime) storeRun
  have runtimeEq := Result.normal.inj eq
  have atStore : markerRuntime.state.loadSlot 7=Shared.norm rep := by
    rw [runtimeEq]
    exact loadChanged _ _ _ (Nat.mod_lt _ (by decide))
  have postValue := (suffixMarker suffix).trans atStore
  have normalized : Shared.norm (post.loadSlot 7)=Shared.norm rep := by rw [postValue,idem]
  exact ⟨normalized,normalized ▸ nonzero⟩
/-- The successful public call contributes the already compiled necessary
pre-marker condition. The postcondition still explicitly requires Reachability;
this must not be advertised as the unconditional next INV-39 obligation. -/
theorem publicMarkerOfReachability (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]=some (.returned post out))
    (reach : Reachability (Child.callContext sender self) rep post) :
    Shared.norm (before.loadSlot 7)=0 ∧ Shared.norm (post.loadSlot 7)=Shared.norm rep ∧
      Shared.norm (post.loadSlot 7)≠0 := by
  exact ⟨Repeat.successMarkerZero before post sender self uid cap rep out run,
    markerOfReachability (Child.callContext sender self) rep post rfl reach⟩
end Inv39.Init.Marker
