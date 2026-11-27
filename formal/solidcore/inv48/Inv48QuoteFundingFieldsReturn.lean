import Inv48QuoteFundingFieldsFrame
import Inv48QuoteTransportCore
open SolidCore.Solidity.Source
namespace Inv48.QuoteFundingFields
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- The actual caller capture target receives the named-return pointer, in
exactly the same heap in which the two funding fields were established. -/
theorem namedCaller (fn : InternalFunction) (r : Runtime) (frame : Frame) (rest : LocalEnv)
    (p a bounty old hoisted id rep : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩])
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) (fields : Fields r id a rep) :
    let caller := Inv48.QuoteTransport.captured r frame rest p a bounty id hoisted
    internalCallFinish fn [Inv48.QuoteTransport.ret]
      (Inv48.QuoteTransport.saved frame rest p a bounty old hoisted) (.normal r) =
        pure (.normal caller) ∧
    caller.lookupLocal? Inv48.QuoteTransport.ret = some (.memoryRef id) ∧
    Fields caller id a rep := by
  dsimp only
  refine ⟨?_,?_,sameHeap r _ id a rep fields rfl⟩
  · rw [Inv48.QuoteMemory.finishQuote fn r _ _ id returns ref]
    exact Inv48.QuoteTransport.assignCaptured r frame rest p a bounty old hoisted id
  · simp [Inv48.QuoteTransport.captured,Inv48.QuoteTransport.saved,
      Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]

#print axioms namedCaller
end Inv48.QuoteFundingFields
