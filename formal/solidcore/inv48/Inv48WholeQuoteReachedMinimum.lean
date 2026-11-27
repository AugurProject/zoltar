import Inv48WholeQuoteMinimum
import Inv48WholeQuoteReached
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem minimumReached (n : Nat) (t : FunctionTable) (c : Context) (r mid : Runtime)
    (helperCode : List Stmt) (name : String) (a minimum : Nat) (trace : Interaction.Transcript)
    (helper : Reached (Stmt.evalList (n+1) t c r.pushScope helperCode) trace mid)
    (scope : mid.popScope = r)
    (A : mid.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (M : mid.lookupLocal? name = some (.word minimum))
    (ha : a<R) (hm : minimum<R) (le : minimum≤a) :
    Reached (Stmt.eval (n+2) t c r (.block (helperCode++[minimumGuard name]))) trace r := by
  have guard := minimumCheck n t c mid name a minimum ha hm le A M
  have guardRun : Reached (Stmt.evalList (n+1) t c mid [minimumGuard name]) [] mid := by
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ [] guard,Stmt.evalList]
    exact reachedPure _
  have codeRun := reachedAppend (n+1) t c r.pushScope mid mid helperCode [minimumGuard name]
    trace [] helper guardRun
  have result := reachedBlock (n+1) t c r mid _ _ codeRun
  simpa only [List.append_nil,scope] using result

#print axioms minimumReached
end Inv48.WholeQuote
