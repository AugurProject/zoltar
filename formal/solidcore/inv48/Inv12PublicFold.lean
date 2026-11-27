import Inv12Model
import Inv12Fold
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv12

theorem checkedFold {α : Type} (rows : ScriptedResponder) (label : String) (tree : SolI α) (value : α)
    (ok : TypeCheck.foldResponder rows label (some tree)=.ok value) :
    tree.runWith rows=.ok value := by
  unfold TypeCheck.foldResponder at ok
  dsimp only at ok
  cases done : tree.runWith rows with
  | error err => rw [done] at ok;cases err <;> cases ok
  | ok a => rw [done] at ok;cases ok;rfl

theorem leafOfMapped {α β : Type} (rows : ScriptedResponder) (tree : SolI α) (f : α → β) (val : β)
    (ok : (Functor.map f tree).runWith rows=.ok val) :
    ∃ a, tree.runWith rows=.ok a ∧ f a=val := by
  change (tree >>= fun a => pure (f a)).runWith rows=.ok val at ok
  rw [runWithBind] at ok
  cases H : tree.runWith rows with
  | error err => rw [H] at ok;cases ok
  | ok a => rw [H] at ok;exact ⟨a,rfl,Except.ok.inj ok⟩
end Inv12
