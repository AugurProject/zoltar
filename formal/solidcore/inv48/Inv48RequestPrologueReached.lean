import Inv48RequestPrologueLinked
import Inv48RequestPrologueSource
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

/-- Exact call input, isolated callee entry and saved frame computed from the
actual quote prologue. Reaching the initial request runtime is still separate. -/
theorem computedPrologue (n : Nat) (c : Context) (r : Runtime)
    (rest : LocalEnv) (sponsor p a bounty gas : Nat) (fn : InternalFunction)
    (linked : Inv48.Source.model.core.table.lookup? Inv48.QuoteMemory.quoteKey = some fn)
    (hp : p<2^256) (ha : a<2^256) (hb : bounty<2^256) :
    let hoisted := source (reserve r) rest sponsor p a bounty gas r.nextMemory
    let called := caller (reserve (reserve r)) []
      ([]::requestFrame sponsor p a bounty gas::rest) p a bounty (r.nextMemory+1) r.nextMemory
    Stmt.eval (n+1) Inv48.Source.model.core.table c
      {r with locals := []::[]::requestFrame sponsor p a bounty gas::rest}
      (.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.hoist none) =
      pure (.normal hoisted) ∧
    Stmt.evalList (n+1) Inv48.Source.model.core.table c hoisted.pushScope quotePrefix =
      pure (.normal called) ∧
    Expr.evalRefArgList c called [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2"] =
      pure ([.word p,.word a,.word bounty],called) ∧
    internalCallEnter? fn [.word p,.word a,.word bounty] called =
      some (Inv48.WholeQuote.entry (base (reserve (reserve r))) p a bounty,
        Inv48.QuoteTransport.saved [] ([]::requestFrame sponsor p a bounty gas::rest)
          p a bounty (r.nextMemory+1) r.nextMemory) := by
  refine ⟨hoistDefault n _ c r rest sponsor p a bounty gas,?_,?_,?_⟩
  · exact prefixExecution n _ c (reserve r) rest sponsor p a bounty gas r.nextMemory hp ha hb
  · exact arguments c _ [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty (r.nextMemory+1) r.nextMemory
  · exact enter fn _ [] ([]::requestFrame sponsor p a bounty gas::rest) p a bounty (r.nextMemory+1) r.nextMemory
      (registeredInitial fn linked p a bounty hp ha hb)
end Inv48.RequestPrologue
