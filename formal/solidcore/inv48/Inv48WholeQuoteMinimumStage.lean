import Inv48WholeQuoteMinShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

theorem initializedMinimum (n : Nat) (table : FunctionTable) (c : Context) (base mid : Runtime)
    (p a bounty minimum : Nat) (trace : EvmCompiler.Simulation.Interaction.Transcript)
    (helper : Reached (Stmt.evalList (n+19) table c (prepared base p a bounty).pushScope minPrefix) trace mid)
    (scope : mid.popScope = prepared base p a bounty)
    (A : mid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (M : mid.lookupLocal? "#view48027" = some (.word minimum))
    (ha : a<R) (hm : minimum<R) (le : minimum≤a) :
    Reached (Stmt.eval (n+20) table c (prepared base p a bounty) minP.value) trace (prepared base p a bounty) := by
  rw [minimumStatement]
  exact minimumReached (n+18) table c (prepared base p a bounty) mid minPrefix "#view48027"
    a minimum trace helper scope A M ha hm le

#print axioms initializedMinimum
end Inv48.WholeQuote
