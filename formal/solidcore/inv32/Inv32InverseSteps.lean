import Inv32Normal
open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32QuoteExpr Inv32CeilFlags
namespace Inv32InverseSteps
def frm (x y a f q paid : Nat) : Frame := [("reserveIn",.word x),("reserveOut",.word y),("amountOut",.word a),
  ("feeBps",.word f),("amountIn",.word q),("feeAmount",.word paid)]
def base (r : Runtime) (x y a f q paid : Nat) := (r.withFrame (frm x y a f q paid)).pushScope.pushScope
def firstX := w "reserveIn"
def firstY := w "amountOut"
def firstD := nonnegativeSub (w "reserveOut") (w "amountOut")
def secondX := w "netInput"
def secondD := nonnegativeSub bps (w "feeBps")
def firstCall := Inv32CeilHoist.code firstX.core firstY.core firstD.core
def secondCall := Inv32CeilHoist.code secondX.core bps.core secondD.core
def castResult := castCopy h0
def declareNet := Stmt.varDecl .uint256 "netInput" (some castResult.core)
def setGross := Stmt.assign (.var "amountIn") castResult.core
def diff := nonnegativeSub (w "amountIn") (w "netInput")
def setFee := Stmt.assign (.var "feeAmount") diff.core
def zeros := Stmt.varDecl .uint256 h0 none
def tail := [zeros,firstCall,declareNet,zeros,secondCall,setGross,setFee]
def instr := match Inv32Bodies.Inverse.body with | .block [_,_,_,_,_,_,.block ss] => ss | _ => []
theorem identity' : instr = Inv32Guards.reservesGuard :: Inv32QuoteGuard.output :: Inv32QuoteGuard.fee :: tail := by rfl
def withNet (r : Runtime) (net : Nat) := (Inv32OneArg.store r h0 net).declareLocal "netInput" (.word net)
def finalState (r : Runtime) (x y a f net q paid : Nat) := Inv32OneArg.store (withNet (base r x y a f q paid) net) h0 q
theorem capRead (c : Context) (r : Runtime) (s : String) (v : Nat) (hv : v<R) (V : locals r s = some v) :
    (w s).run c.checked (locals r) = some v := Inv32ProductValues.cleanup (localWord s) _ _ _ hv V

theorem firstInputs (c : Context) (r : Runtime) (x y a f : Nat) (hx : x<R) (hy : y<R) (ha : a<R) (le : a≤y) :
    Inv32FloorHoist.Inputs c (base r x y a f 0 0) h0 firstX.core firstY.core firstD.core x a (y-a) := by
  refine ⟨evalFormula _ _ _ _ (by decide : firstX.depth ≤ firstX.core.orderFuel + 1) (capRead _ _ _ _ hx rfl),
    evalFormula _ _ _ _ (by decide : firstY.depth ≤ firstY.core.orderFuel + 1) (capRead _ _ _ _ ha rfl),?_⟩
  exact evalFormula firstD _ _ _ (by decide) (subValue _ _ _ _ _ _ hy ha le
    (capRead c _ "reserveOut" _ hy rfl) (capRead c _ "amountOut" _ ha rfl))
theorem secondInputs (c : Context) (r : Runtime) (x y a f net : Nat) (hn : net<R) (hf : f<R) (le : f≤10000) :
    Inv32FloorHoist.Inputs c (withNet (base r x y a f 0 0) net) h0 secondX.core bps.core secondD.core net 10000 (10000-f) := by
  refine ⟨evalFormula _ _ _ _ (by decide : secondX.depth ≤ secondX.core.orderFuel + 1) (capRead _ _ _ _ hn rfl),
    evalFormula bps _ _ _ (by decide) (bpsValue _ _),?_⟩
  exact evalFormula secondD _ _ _ (by decide) (subValue _ _ _ _ _ _ (by decide : 10000<R) hf le (bpsValue _ _) (capRead c _ "feeBps" _ hf rfl))
set_option maxRecDepth 10000
macro "assign_result" : tactic => `(tactic|
  simp [finalState,withNet,Inv32OneArg.store,base,frm,h0,Runtime.declareLocal,Runtime.withFrame,Runtime.pushScope,
    Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,LocalEnv.declare,LocalEnv.assign?,Frame.lookup?,Frame.assign?,
    Value.coerceLike?])
theorem finish (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y a f net q : Nat)
    (hn : net<R) (hq : q<R) (le : net≤q) :
    Stmt.evalList (n+1) t c (Inv32OneArg.store (withNet (base r x y a f 0 0) net) h0 q) [setGross,setFee] =
      pure (.normal (finalState r x y a f net q (q-net))) := by
  let pre := Inv32OneArg.store (withNet (base r x y a f 0 0) net) h0 q
  let mid := finalState r x y a f net q 0
  let post := finalState r x y a f net q (q-net)
  have G := Inv32Assign.scalarCast n t c pre mid "amountIn" 0 q _ _ _ rfl
    (evalFormula castResult c pre _ (by decide) (castValue c.checked (locals pre) h0 q hq rfl))
    (by dsimp [pre,mid]; assign_result)
  have F := Inv32Assign.scalarCast n t c mid post "feeAmount" 0 (q-net) _ _ _ rfl
    (evalFormula diff c mid _ (by decide) (subValue c.checked (locals mid) _ _ _ _ hq hn le
      (capRead c mid "amountIn" q hq rfl) (capRead c mid "netInput" net hn rfl)))
    (by dsimp [mid,post]; assign_result)
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ G).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ [] F).trans (by rw [Stmt.evalList]))
end Inv32InverseSteps
