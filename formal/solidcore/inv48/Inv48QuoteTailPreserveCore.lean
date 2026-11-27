import Inv48QuoteFundingFieldsFunding
import Inv48QuoteFundingFieldsCapture
import Inv48QuoteFundingFieldsReturn
open SolidCore.Solidity.Source
namespace Inv48.QuoteTailPreserve
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open Inv48.QuoteFundingFields

/-- The invariant refers to the immediately post-funding pointer and two words.
No later upper-field values are part of the invariant. -/
def Keeps (r : Runtime) (id a b : Nat) : Prop :=
  r.lookupLocal? "quote" = some (.memoryRef id) ∧ Fields r id a b

/-- Structural heap updates, rather than an assumed memory equality for a call.
Local restoration is restricted to environments with the same named pointer. -/
inductive Frame (c : Context) (id : Nat) : Runtime → Runtime → Prop
  | refl (r) : Frame c id r r
  | locals (r : Runtime) (saved : LocalEnv)
      (ref : ({r with locals := saved} : Runtime).lookupLocal? "quote" =
        r.lookupLocal? "quote") : Frame c id r {r with locals := saved}
  | state (r : Runtime) (s : State) : Frame c id r {r with state := s}
  | upper (r next : Runtime) (i v : Nat)
      (hi : i = 2 ∨ i = 3 ∨ i = 4)
      (write : (ResolvedLValue.valueIndex (.memoryCell id) i).write c r (.word v) = .ok next) :
      Frame c id r next
  | trans {r s t} : Frame c id r s → Frame c id s t → Frame c id r t

/-- Soundness of the structural update calculus. This is not an adequacy theorem
for Stmt.eval: an execution must still be shown to induce these updates. -/
theorem frameKeeps {c id r next a b} (frame : Frame c id r next)
    (before : Keeps r id a b) : Keeps next id a b := by
  induction frame with
  | refl => exact before
  | locals r saved ref => exact ⟨ref.trans before.1, sameHeap r _ id a b before.2 rfl⟩
  | state r s => exact ⟨before.1, sameHeap r _ id a b before.2 rfl⟩
  | upper r next i v hi write =>
    refine ⟨?_,upperWrite c r next id a b i v before.2 hi write⟩
    obtain ⟨h,e,s,mem⟩ := before.2
    rcases hi with hi | hi | hi <;> subst i
    · rw [Inv48.QuoteMemory.write2 c r id a b h e s v mem] at write
      cases write; exact before.1
    · rw [Inv48.QuoteMemory.write3 c r id a b h e s v mem] at write
      cases write; exact before.1
    · rw [Inv48.QuoteMemory.write4 c r id a b h e s v mem] at write
      cases write; exact before.1
  | trans first second ihFirst ihSecond => exact ihSecond (ihFirst before)

/-- Composition through the actual caller capture target. The frame premise is
explicit; no claim is made here that arbitrary successful suffixes satisfy it. -/
theorem capturedKeeps (fn : InternalFunction) (post final : Runtime)
    (callerFrame : SolidCore.Solidity.Source.Frame) (rest : LocalEnv)
    (p a bounty old hoisted id rep : Nat) (c : Context)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩])
    (before : Keeps post id a rep) (updates : Frame c id post final) :
    let caller := Inv48.QuoteTransport.captured final callerFrame rest p a bounty id hoisted
    internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.QuoteTransport.saved callerFrame rest p a bounty old hoisted) (.normal final) =
        pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Fields caller id a rep := by
  have preserved := frameKeeps updates before
  exact namedCaller fn final callerFrame rest p a bounty old hoisted id rep
    returns preserved.1 preserved.2
end Inv48.QuoteTailPreserve
