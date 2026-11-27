import Inv48WholeQuoteTail
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
open QuoteMemory

/-- The oracle-stage observation concerns local frame layout, not quote fields.
The two body scopes are discarded before collecting the named return. -/
theorem returnReference (base oracle : Runtime) (inner outer : Frame)
    (p a bounty h v minimum fee : Nat)
    (frames : oracle.locals = inner :: outer :: (allocated base p a bounty).locals) :
    (finalState oracle base.nextMemory a p h v minimum fee).popScope.popScope.lookupLocal? "quote" =
      some (.memoryRef base.nextMemory) := by
  unfold finalState exposed maximumState
  split <;> simp [put,Inv32OneArg.store,Inv32CeilFlags.h0,Runtime.declareLocal,
    LocalEnv.declare,Runtime.popScope,frames,allocated,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]

theorem returnMemory (oracle : Runtime) (id a p h v minimum fee : Nat) :
    (finalState oracle id a p h v minimum fee).popScope.popScope.loadMemory? id =
      some (tuple a (QuoteExec.repAmount a p) (max h v) ((a-minimum)*100) fee) :=
  put_load _ _ _ _ _ _ _

/-- Actual internal-call epilogue, conditional only on the named binding
metadata and the explicit oracle frame observation. -/
theorem finish (fn : InternalFunction) (base oracle : Runtime) (inner outer : Frame)
    (p a bounty h v minimum fee : Nat) (saved : LocalEnv) (targets : List String)
    (returns : fn.returns = [⟨"quote",quoteTy,false⟩])
    (frames : oracle.locals = inner :: outer :: (allocated base p a bounty).locals) :
    let out := (finalState oracle base.nextMemory a p h v minimum fee).popScope.popScope
    internalCallFinish fn targets saved (.normal out) =
      internalCallAssign {out with locals := saved} targets [.memoryRef base.nextMemory] := by
  apply finishQuote
  · exact returns
  · exact returnReference base oracle inner outer p a bounty h v minimum fee frames

/-- Reading the returned pointer observes the derived funding fields, even
though all three non-funding fields have subsequently changed. -/
theorem returnedFields (c : Context) (base oracle : Runtime) (inner outer : Frame)
    (p a bounty h v minimum fee : Nat)
    (frames : oracle.locals = inner :: outer :: (allocated base p a bounty).locals) :
    let out := (finalState oracle base.nextMemory a p h v minimum fee).popScope.popScope
    Expr.eval c out (.index (.var "quote") (.word 0)) = pure (.word a,out) ∧
    Expr.eval c out (.index (.var "quote") (.word 1)) = pure (.word (QuoteExec.repAmount a p),out) := by
  exact returnedFundingFields c _ base.nextMemory a (QuoteExec.repAmount a p) (max h v)
    ((a-minimum)*100) fee (returnReference base oracle inner outer p a bounty h v minimum fee frames)
    (returnMemory oracle base.nextMemory a p h v minimum fee)

#print axioms returnReference
#print axioms returnMemory
#print axioms finish
#print axioms returnedFields
end Inv48.WholeQuote
