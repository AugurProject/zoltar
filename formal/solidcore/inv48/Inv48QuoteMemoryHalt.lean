import Inv48QuoteMemoryGuards
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def haltCondition : Expr := .binary .gt
  (clean (.var "exposureEscalationHaltAttoEth")) (clean (field 2))
def haltUpdateStmt : Stmt := .ifElse haltCondition
  (.assign (.index (.var "quote") (.word 2))
    (clean (.var "exposureEscalationHaltAttoEth"))) .skip

/-- Numeric max selection and its memory effect, with neither a branch-result
nor a successful-condition-evaluation premise. -/
theorem haltMaximum (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (hh : h<R) (hv : v<R)
    (read : r.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v)) :
    Stmt.eval (n+2) t c r haltUpdateStmt =
      pure (.normal (if h<v then put r id a b v e s else r)) := by
  have fieldRead := Inv08.MemoryMember.clean
    (Inv08.MemoryMember.fromMemory c r "quote" id 2 h [.word a,.word b,.word h,.word e,.word s]
      ref mem (by decide) rfl) hh
  have cond : Expr.eval c r haltCondition = pure (.word (boolWord (decide (h<v))),r) := by
    change Expr.evalFuel 8 c r haltCondition = _
    apply Inv32Eval.binary 7 c r .gt (by intro h; cases h) (by intro h; cases h) _ _ (.word v) (.word h)
    · exact Inv32Guards.clean 6 c r _ v hv (Inv32Guards.readWord 5 c r _ v read)
    · exact fieldRead _ (by decide)
    · simpa [boolWord] using Inv32QuoteExpr.gt c.checked v h hv hh
  simpa [haltUpdateStmt,clean] using haltUpdate n t c r id a b h e s v haltCondition (decide (h<v)) ref mem hv read cond

#print axioms haltMaximum
end Inv48.QuoteMemory
