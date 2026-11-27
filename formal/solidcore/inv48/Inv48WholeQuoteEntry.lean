import Inv48WholeQuoteCore
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def prologue : List Stmt := [cleanParam "proposedRepPerEthPrice",
  cleanParam "requestedInitialAttoWeth",cleanParam "bountyAttoEth",
  .memoryLocalize quoteTy "quote"]

macro "entry_cleanup" : tactic => `(tactic|
  simp [entry,Runtime.withFrame,Runtime.pushScope,Runtime.lookupLocal?,Runtime.assignLocal?,
    LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem prologueExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (p a b : Nat) (hp : p<R) (ha : a<R) (hb : b<R) :
    Stmt.evalList (n+1) t c (entry r p a b).pushScope prologue =
      pure (.normal (allocated r p a b).pushScope) := by
  have pstep := cleanParamExec n t c (entry r p a b).pushScope "proposedRepPerEthPrice" p hp
    (by rfl) (by entry_cleanup)
  have astep := cleanParamExec n t c (entry r p a b).pushScope "requestedInitialAttoWeth" a ha
    (by rfl) (by entry_cleanup)
  have bstep := cleanParamExec n t c (entry r p a b).pushScope "bountyAttoEth" b hb
    (by rfl) (by entry_cleanup)
  have alloc : Stmt.eval (n+1) t c (entry r p a b).pushScope (.memoryLocalize quoteTy "quote") =
      pure (.normal (allocated r p a b).pushScope) := by
    rw [Stmt.eval]; dsimp only; rw [localization]
  unfold prologue
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ pstep).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ astep).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ bstep).trans
        ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] alloc).trans (by rw [Stmt.evalList]))))

#print axioms prologueExecution
end Inv48.WholeQuote
