import Inv39MarkerPrefix
import Inv39MarkerSuffix
import Inv39MarkerObserved
import Inv39RepeatExclusion
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv39.Init.Marker

theorem installedMarker (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]=some (.returned post out)) :
    Shared.norm (post.loadSlot 7)=Shared.norm rep ∧ Shared.norm (post.loadSlot 7)≠0 := by
  obtain ⟨w⟩ := Prefix.initializerPrefix before post sender self uid cap rep out run
  have u := w.universeRun
  rw [w.universeIdentity] at u
  have shape := Prefix.universeShape 49994 (Child.callContext sender self) w.start rfl
  unfold Fold.Ensures at shape
  have frames : w.store.locals=w.start.locals := shape _ u
  rw [w.startIdentity] at frames
  have tail := ActualSuffix.afterRepStore w.fn w.a w.b w.d w.e w.suffix w.found w.bodyIdentity
    (Child.callContext sender self) w.store w.marked w.result _ (Shared.norm rep) 49994 frames w.storeLocal rfl rfl w.repStoreRun w.suffixRun
  exact observedMarker (c:=Child.callContext sender self) (ng:=49994) (ns:=49994) rfl w.guardLocal w.repGuardRun w.storeLocal w.repStoreRun tail w.postStorage

theorem noImmediateReinitialization (before post later : State)
    (sender self uid cap rep sender' self' uid' cap' rep' : Nat) (out out' : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender self) before [.word uid,.word cap,.word rep]=some (.returned post out)) :
    TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize")
      (Child.callContext sender' self') post [.word uid',.word cap',.word rep']≠some (.returned later out') :=
  Repeat.publicExclusion _ _ _ _ _ _ _ _ (installedMarker _ _ _ _ _ _ _ _ run).2

#print axioms installedMarker
#print axioms noImmediateReinitialization
end Inv39.Init.Marker
