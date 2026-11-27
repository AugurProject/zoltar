import Inv48QuoteMemoryOps
open SolidCore.Solidity.Source
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Only the two funding fields are observed. The other fields are existential. -/
def Fields (r : Runtime) (id a b : Nat) : Prop :=
  ∃ h e s, r.loadMemory? id = some (Inv48.QuoteMemory.tuple a b h e s)

/-- Invert a successful upper-field heap write, without prescribing its value. -/
theorem upperWrite (c : Context) (r next : Runtime) (id a b i v : Nat)
    (fields : Fields r id a b) (upper : i = 2 ∨ i = 3 ∨ i = 4)
    (write : (ResolvedLValue.valueIndex (.memoryCell id) i).write c r (.word v) = .ok next) :
    Fields next id a b := by
  obtain ⟨h,e,s,mem⟩ := fields
  rcases upper with hi | hi | hi <;> subst i
  · rw [Inv48.QuoteMemory.write2 c r id a b h e s v mem] at write
    cases write
    exact ⟨v,e,s,Inv48.QuoteMemory.put_load _ _ _ _ _ _ _⟩
  · rw [Inv48.QuoteMemory.write3 c r id a b h e s v mem] at write
    cases write
    exact ⟨h,v,s,Inv48.QuoteMemory.put_load _ _ _ _ _ _ _⟩
  · rw [Inv48.QuoteMemory.write4 c r id a b h e s v mem] at write
    cases write
    exact ⟨h,e,v,Inv48.QuoteMemory.put_load _ _ _ _ _ _ _⟩

/-- A frame stated directly on the heap also transports through local restoration. -/
theorem sameHeap (r next : Runtime) (id a b : Nat)
    (fields : Fields r id a b) (heap : next.memory = r.memory) : Fields next id a b := by
  obtain ⟨h,e,s,mem⟩ := fields
  exact ⟨h,e,s,by simpa only [Runtime.loadMemory?,heap] using mem⟩

theorem observe (c : Context) (r : Runtime) (id a b : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) (fields : Fields r id a b) :
    Expr.eval c r (.index (.var "quote") (.word 0)) = pure (.word a,r) ∧
    Expr.eval c r (.index (.var "quote") (.word 1)) = pure (.word b,r) := by
  obtain ⟨h,e,s,mem⟩ := fields
  exact Inv48.QuoteMemory.returnedFundingFields c r id a b h e s ref mem

/-- The named return is the same memory reference in the post-callee heap. -/
theorem namedFinish (fn : InternalFunction) (r : Runtime) (saved : LocalEnv)
    (targets : List String) (id a b : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩])
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) (fields : Fields r id a b) :
    internalCallFinish fn targets saved (.normal r) =
      internalCallAssign {r with locals := saved} targets [.memoryRef id] ∧
    Fields {r with locals := saved} id a b :=
  ⟨Inv48.QuoteMemory.finishQuote fn r saved targets id returns ref,
    sameHeap r _ id a b fields rfl⟩

#print axioms upperWrite
#print axioms namedFinish
end Inv48.QuoteFundingFields
