import Inv39StringFrame
import Inv39Ledger
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init
inductive Edit where
  | scalar (slot : Nat) (allowed : slot=5 ∨ slot=6 ∨ slot=7) (word : Nat)
  | metadata (slot : Nat) (allowed : slot=3 ∨ slot=4) (bytes : List Source.Byte)
def applyEdit (s : State) : Edit → State
  | .scalar slot _ word => s.storeSlot slot word
  | .metadata slot _ bytes => s.storeStorageBytesAt slot bytes
/-- A witness records the initializer's individual, finite storage writes. State fields unrelated to storage
can evolve independently (memory, logs, immutables, and accounting for message value). -/
inductive Writes (base : State) : List Edit → State → Type where
  | initial : Writes base [] base
  | same {s s' edits} : Writes base edits s → s'.storage=s.storage → Writes base edits s'
  | step {s edits} (e : Edit) : Writes base edits s → Writes base (e::edits) (applyEdit s e)
def Records (base s : State) := Nonempty (Σ edits, Writes base edits s)
theorem unchanged {base s post : State} (h : Records base s) (eq : post.storage=s.storage) : Records base post := by
  obtain ⟨⟨es,h⟩⟩ := h; exact ⟨⟨es,.same h eq⟩⟩
theorem added {base s : State} (h : Records base s) (e : Edit) : Records base (applyEdit s e) := by
  obtain ⟨⟨es,h⟩⟩ := h; exact ⟨⟨_,.step e h⟩⟩
def avoids (s : State) (query : Nat) : Edit → Prop
  | .scalar slot _ _ => Shared.norm slot≠Shared.norm query
  | .metadata slot _ bs => Shared.norm slot≠Shared.norm query ∧
      ∀ i, i<max (bs.length+1) (oldChunks s slot) → Shared.norm (storageBytesLongDataSlot slot i)≠Shared.norm query
/-- The distinctness check is over the finite sequence and actual byte lengths, including each previous header. -/
def separated {base : State} {edits : List Edit} {s : State} (query : Nat) (w : Writes base edits s) : Prop :=
  ∀ (e : Edit) (before : State), (e,before) ∈ footprint w → avoids before query e
where
  footprint {es : List Edit} {post : State} : Writes base es post → List (Edit × State)
  | .initial => []
  | .same prior _ => footprint prior
  | .step (s:=prior) e rest => (e,prior)::footprint rest
theorem sameAt {base : State} {edits : List Edit} {s : State} (w : Writes base edits s) (q : Nat) (clear : separated q w) :
    s.loadSlot q=base.loadSlot q := by
  induction w with
  | initial => rfl
  | same prior eq ih => simpa only [State.loadSlot,eq] using ih clear
  | @step last es e prev ih =>
    have safe := clear e last List.mem_cons_self
    have pred : separated q prev := fun a b h => clear a b (List.mem_cons_of_mem _ h)
    apply Eq.trans _ (ih pred)
    cases e with
    | scalar slot which v => exact loadUnchanged _ _ _ _ safe
    | metadata slot which bs => exact stringFrame _ _ _ _ safe.1 safe.2
theorem books {base : State} {edits : List Edit} {s : State} (w : Writes base edits s) (A : Nat → Prop)
    (empty : Books A base []) (issued : separated circulating.slot w) (mapped : ∀ a, A a → separated (balanceSlot a) w) :
    Books A s [] := ⟨fun a ha => (sameAt w _ (mapped a ha)).trans (empty.balances a ha),(sameAt w _ issued).trans empty.issued⟩
end Inv39.Init
