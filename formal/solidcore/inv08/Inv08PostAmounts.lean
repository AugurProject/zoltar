import Inv08PostRecords
import Inv08FundingStages
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Release

theorem readWritten (s : State) (k : Field) (v : Nat) (word : k.width=32) (off : k.offset=0) (fit : v<R) :
    stored (s.storeFieldWord k.field v) k = v := by
  simp [stored,State.loadFieldWord,State.storeFieldWord,State.storeFieldSlot,State.loadFieldSlot,
    Field.field,StorageField.isPacked,word,off,wordBytes,slotAfter,show Shared.norm v=v from Nat.mod_eq_of_lt fit]

theorem amounts (s : State) (tm : Nat) (eth : Bool) (h : Ready s tm) :
    stored (post s tm) (cursorField eth) = cursor s tm eth ∧
    stored (post s tm) (outstandingField eth) = leftover s tm eth := by
  have before := h.word eth
  have leftFit : leftover s tm eth<R := lt_of_le_of_lt (Nat.sub_le _ _) before
  have curFit := cursorFit h eth
  cases eth <;> dsimp only [cursorField,outstandingField,post,timestamped,repDebited,ethDebited,repCredited,ethCredited]
  all_goals
    simp (disch := decide) only [AddStream.otherField]
    exact ⟨readWritten _ _ _ rfl rfl curFit,readWritten _ _ _ rfl rfl leftFit⟩
end Inv08.Release
