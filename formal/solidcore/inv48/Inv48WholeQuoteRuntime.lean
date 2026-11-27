import Inv48WholeQuoteRefProbe
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000
open QuoteMemory
opaque sealedRuntime (r : Runtime) : {s : Runtime // s=r} := ⟨r,rfl⟩
def fundingState (base : Runtime) (p a bounty : Nat) :=
  (sealedRuntime (funded (prepared base p a bounty) base.nextMemory a p)).val
theorem fundingState_eq (base : Runtime) (p a bounty : Nat) :
    fundingState base p a bounty = funded (prepared base p a bounty) base.nextMemory a p :=
  (sealedRuntime _).property

theorem fundingStateRef (base : Runtime) (p a bounty : Nat) :
    (fundingState base p a bounty).lookupLocal? "quote" = some (.memoryRef base.nextMemory) := by
  apply (congrArg (fun r : Runtime => r.lookupLocal? "quote") (fundingState_eq base p a bounty)).trans
  exact initializedFundingRef base p a bounty

theorem fundingStateMemory (base : Runtime) (p a bounty : Nat) :
    (fundingState base p a bounty).loadMemory? base.nextMemory = some (tuple a (QuoteExec.repAmount a p) 0 0 0) := by
  apply (congrArg (fun r : Runtime => r.loadMemory? base.nextMemory) (fundingState_eq base p a bounty)).trans
  exact put_load
    (Inv32OneArg.store (put (prepared base p a bounty) base.nextMemory a 0 0 0 0)
      Inv32CeilFlags.h0 (QuoteExec.repAmount a p)) base.nextMemory a (QuoteExec.repAmount a p) 0 0 0

theorem fundingTransport (fuel : Nat) (table : FunctionTable) (c : Context) (base : Runtime)
    (p a bounty : Nat)
    (run : Stmt.evalList fuel table c (prepared base p a bounty) (collateralWrite :: fundingCode) =
      pure (.normal (funded (prepared base p a bounty) base.nextMemory a p))) :
    Stmt.evalList fuel table c (prepared base p a bounty) (collateralWrite :: fundingCode) =
      pure (.normal (fundingState base p a bounty)) :=
  run.trans (congrArg (fun r : Runtime => (pure (.normal r) : SolI Result)) (fundingState_eq base p a bounty).symm)

#print axioms fundingStateRef
#print axioms fundingStateMemory
#print axioms fundingTransport
end Inv48.WholeQuote
