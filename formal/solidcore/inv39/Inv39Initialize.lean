import Inv39EntryWrites
import Inv39InitBinding
import Inv39InitBounds
import Inv39CheckedHistory
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init
/-- Every successful checked public initializer, for every calldata word triple and caller, produces
only the scalar and dynamic metadata writes recorded in its finite storage footprint. -/
theorem publicWrites (before post : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize") (Child.callContext sender self) before
      [.word uid,.word cap,.word rep]=some (.returned post out)) : Records before post := by
  obtain ⟨f,found,ps,rs,body⟩ := linked
  let locals := [("universeId_",Source.Value.word uid),("totalTheoreticalSupplyAttoRep_",.word cap),("repNumber_",.word rep)]
  have frame : f.initialFrame? [.word uid,.word cap,.word rep] = some locals := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings; rw [ps,rs]
    simp [params,BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,locals]
  have good : safeFrame locals := by
    simp [locals,safeFrame,safeTemplate]
  apply entry before post (Child.callContext sender self) f "initialize" _ out locals 50000 found body frame _ good rfl run
  simp [Child.callContext,FunctionDef.acceptsValue,Contract.context,wordEq]
/-- Headroom from the initial observed theoretical supply after any successful real initialization.
Only slots actually touched by that initialization need to be distinct from account balances and circulating supply. -/
theorem initializedHistory (before initial : State) (sender self uid cap rep : Nat) (out : List Source.Value)
    (run : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name "initialize") (Child.callContext sender self) before
      [.word uid,.word cap,.word rep]=some (.returned initial out)) (fresh : canonical before) :
    ∃ (edits : List Edit) (w : Writes before edits initial),
      ∀ (A : Nat → Prop) (post : State) (b : Balances) (changes : List Change), Books A before [] →
      separated circulating.slot w → (∀ a, A a → separated (balanceSlot a) w) →
      SlotSeparation A → History A initial [] changes post b →
      post.loadSlot theoretical.slot-post.loadSlot circulating.slot =
        initial.loadSlot theoretical.slot-(changes.map Change.minted).sum ∧
      (changes.map Change.minted).sum ≤ initial.loadSlot theoretical.slot := by
  obtain ⟨⟨edits,w⟩⟩ := publicWrites before initial sender self uid cap rep out run
  refine ⟨edits,w,?_⟩
  intro A post b changes zero circ balances sep history
  exact headroom history sep (books w _ zero circ balances) (canonicalWrites w fresh _)
end Inv39.Init
