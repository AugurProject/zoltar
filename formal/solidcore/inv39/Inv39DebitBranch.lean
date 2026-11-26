import Inv39Branches
import Inv39Assignment
import Inv39UpdateBody
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.ERC20
theorem debitRun (t : FunctionTable) (c : Context) (r : Runtime) (fuel addr a : Nat)
    (src : r.lookupLocal? "from" = some (.word addr)) (qty : r.lookupLocal? "value"=some (.word a))
    (enough : a ≤ r.state.loadSlot (balanceSlot addr)) (fit : r.state.loadSlot (balanceSlot addr)<R)
    (fields : c.storageFields=model.core.context.storageFields) :
    Stmt.eval (fuel+4) t c r debit.value = pure (.normal {r with state:=r.state.storeSlot (balanceSlot addr) (r.state.loadSlot (balanceSlot addr)-a)}) := by
  let b := r.state.loadSlot (balanceSlot addr)
  let d := r.pushScope.declareLocal "fromBalance" (.word b)
  let post := {d with state:=r.state.storeSlot (balanceSlot addr) (b-a)}
  have db : d.lookupLocal? "fromBalance"=some (.word b) := rfl
  have da : d.lookupLocal? "value"=some (.word a) := qty
  have df : d.lookupLocal? "from"=some (.word addr) := src
  apply Inv32Hoist.block (next:=post)
  let guard := (Inv32Shapes.Stmt_ifElse insufficient (Inv03.Bodies.block [reject]) Inv32Shapes.Stmt_skip).value
  let write := Source.Stmt.unchecked (.block [.assign (.storageIndex "_balances" (.var "from")) difference])
  change Stmt.evalList (fuel+3) t c r.pushScope [.varDecl .uint256 "fromBalance" (some (Inv03.Bodies.clean (balanceAt "from")).value),guard,write] = _
  have rd : (Inv03.Bodies.clean (balanceAt "from")).value.eval c r.pushScope = pure (.word b,r.pushScope) :=
    Inv32Guards.clean 5 c r.pushScope _ b fit (readMapping _ _ _ _ 3 src fields)
  have decl := Inv32Hoist.declEval (fuel+2) t c r.pushScope "fromBalance" .uint256 _ b rd (by rfl)
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ decl]
  have skipIf : Stmt.eval (fuel+3) t c d (Inv32Shapes.Stmt_ifElse insufficient (Inv03.Bodies.block [reject]) Inv32Shapes.Stmt_skip).value = pure (.normal d) := by
    change Stmt.eval (fuel+3) t c d (.ifElse shortage (.block [reject.value]) .skip) = _
    rw [Inv32Blocks.branch (fuel+2) t c d _ _ _ false (noShortage c d b a db da enough fit)]
    change Stmt.eval (fuel+2) t c d .skip = _
    rw [Stmt.eval]
  change Stmt.evalList (fuel+3) t c d [(Inv32Shapes.Stmt_ifElse insufficient (Inv03.Bodies.block [reject]) Inv32Shapes.Stmt_skip).value,write] = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ skipIf]
  have step : Stmt.eval (fuel+3) t c d (.unchecked (.block [.assign (.storageIndex "_balances" (.var "from")) difference])) = pure (.normal post) := by
    apply uncheckedStmt
    exact Inv32Blocks.one _ _ _ _ _ _ (debitAssignment {c with checked:=false} d.pushScope _ _ _ _ _ df db da enough fit fields)
  change Stmt.evalList (fuel+3) t c d [.unchecked (.block [.assign (.storageIndex "_balances" (.var "from")) difference])] = _
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ step,Stmt.evalList]
end Inv39.ERC20
