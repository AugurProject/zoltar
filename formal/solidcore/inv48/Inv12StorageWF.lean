import Inv12AfterCallback
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem insertedWF (m : StorageMap) (wf : StorageMap.WF m) (key value : Nat) :
    StorageMap.WF (m.insertLoop key value) := by
  rintro ⟨k,v⟩ mem
  have get := Std.HashMap.mem_toList_iff_getElem?_eq_some.mp mem
  unfold StorageMap.insertLoop at get
  rw [Std.HashMap.getElem?_insert] at get
  split at get
  · rename_i eqn
    simp at eqn get
    subst k; subst v
    simp [Shared.norm]
  · exact wf _ (Std.HashMap.mem_toList_iff_getElem?_eq_some.mpr get)

theorem putWF (s : State) (slot off v : Nat) (wf : StorageMap.WF s.storage) :
    StorageMap.WF (putAmount s slot off v).storage := insertedWF _ wf _ _

theorem afterCreditsWF (r : Runtime) (f b : Ref) (rep extra : Nat) (wf : StorageMap.WF r.state.storage) :
    StorageMap.WF (afterCredits r f b rep extra).state.storage :=
  insertedWF _ (insertedWF _ (insertedWF _ wf _ _) _ _) _ _
end Inv12
