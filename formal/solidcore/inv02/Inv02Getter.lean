import Inv02Grid
import Inv32CompareValues
import Inv32FloorHoist

open SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32QuoteExpr Inv32Actions
open Inv32FloorStart Inv32FloorFastPath
namespace Inv02.Getter

abbrev tmp := "_sol_hoist_0"
abbrev baseName := "#view7395"
def constantArg (v : Nat) := choice (literal 1) (literal v) (literal v)
def floorCall (x : String) (factor : Nat) (d : String) :=
  Inv32FloorHoist.code tmp (w x).core (constantArg factor).core (w d).core
def compute : Stmt := .block [
  .varDecl .uint256 tmp none, floorCall "rep" 10000 "multiplier",
  .varDecl .uint256 baseName (some (castCopy tmp).core),
  .varDecl .uint256 tmp none, floorCall baseName (10^18) "commitment",
  .returnValues [(castCopy tmp).core]]
def zeroCondition := Inv32WideGuards.zeroTest "commitment"
def zeroReturn := Stmt.returnValues [(Inv32Product.clean (literal (R-1))).core]
def body : Stmt := .block [cleanParam "rep",cleanParam "commitment",cleanParam "multiplier",.skip,
  .block [.ifElse zeroCondition.core zeroReturn .skip,compute]]
def frame (r : Runtime) (rep k m : Nat) :=
  r.withFrame [("rep",.word rep),("commitment",.word k),("multiplier",.word m),("_ret0",.word 0)]

local macro "writeInput" : tactic => `(tactic|
  simp [frame,Runtime.withFrame,Runtime.pushScope,Runtime.assignLocal?,Runtime.lookupLocal?,
    LocalEnv.lookup?,LocalEnv.assign?,Frame.lookup?,Frame.assign?,Value.coerceLike?])

theorem run (n : Nat) (t : FunctionTable) (prod : Inv32Internal.ProductLinked t)
    (floor : Inv32FloorCall.FloorLinked t) (c : Context) (r : Runtime) (rep k m : Nat)
    (hr : rep<R) (hk : k<R) (hm : m<R) (kp : 0<k) (mp : 0<m)
    (hb : rep*10000/m<R) (hp : price rep k m<R) :
    Stmt.eval (n+18) t c (frame r rep k m) body =
      pure (.returned (frame r rep k m) [.word (price rep k m)]) := by
  let outer := (frame r rep k m).pushScope
  let inner := outer.pushScope
  let pre := inner.pushScope
  let base := rep*10000/m
  let first := Inv32OneArg.store pre tmp base
  let saved := first.declareLocal baseName (.word base)
  let q := price rep k m
  let last := Inv32OneArg.store saved tmp q
  have args1 : Inv32FloorHoist.Inputs c pre tmp (w "rep").core (constantArg 10000).core
      (w "multiplier").core rep 10000 m :=
    ⟨Inv32Guards.clean _ _ _ _ _ hr (Inv32Guards.readWord _ _ _ _ _ rfl),
      evalFormula (constantArg 10000) _ _ _ (by decide) rfl,
      Inv32Guards.clean _ _ _ _ _ hm (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have args2 : Inv32FloorHoist.Inputs c saved tmp (w baseName).core (constantArg (10^18)).core
      (w "commitment").core base (10^18) k :=
    ⟨Inv32Guards.clean _ _ _ _ _ hb (Inv32Guards.readWord _ _ _ _ _ rfl),
      evalFormula (constantArg (10^18)) _ _ _ (by decide) rfl,
      Inv32Guards.clean _ _ _ _ _ hk (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  have a := Inv32FloorHoist.successAt t prod floor n c pre tmp _ _ _ _ _ _ hr (by decide) hm mp hb
    args1 (by decide) (by decide) (by decide) (by decide)
  have b := Inv32FloorHoist.successAt t prod floor n c saved tmp _ _ _ _ _ _ hb (by decide) hk kp hp
    args2 (by decide) (by decide) (by decide) (by decide)
  have save := Inv32Hoist.declEval (n+14) t c first baseName .uint256 (castCopy tmp).core base
    (evalFormula _ _ _ _ (by decide) (castValue _ _ _ _ hb rfl)) (by rw [Ty.coerceValue?])
  have ret := Inv32CompareValues.retOne (n+14) t c last (castCopy tmp).core q
    (evalFormula (castCopy tmp) _ _ _ (by decide) (castValue _ _ _ _ hp rfl))
  have calcStep : Stmt.eval (n+16) t c inner compute = pure (.returned inner [.word q]) := by
    apply blockReturned _ _ _ _ last
    exact (seqStep _ _ _ _ _ _ _ (zero (n+14) t c pre tmp)).trans
      ((seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ save).trans
      ((seqStep _ _ _ _ _ _ _ (zero (n+14) t c saved tmp)).trans
      ((seqStep _ _ _ _ _ _ _ b).trans (stop _ _ _ _ _ _ [] _ ret)))))
  have guard := Inv32WideGuards.zeroValue c.checked (locals inner) "commitment" k hk rfl
  rw [if_neg (Nat.ne_of_gt kp)] at guard
  have choose := Inv32Blocks.branch (n+15) t c inner zeroCondition.core zeroReturn .skip false
    (evalFormula zeroCondition _ _ _ (by decide) guard)
  have sk : Stmt.eval (n+15) t c inner .skip = pure (.normal inner) := by rw [Stmt.eval]
  have main : Stmt.eval (n+17) t c outer (.block [.ifElse zeroCondition.core zeroReturn .skip,compute]) =
      pure (.returned outer [.word q]) := by
    apply blockReturned _ _ _ _ inner
    exact (seqStep _ _ _ _ _ _ _ (choose.trans sk)).trans (stop _ _ _ _ _ _ [] _ calcStep)
  apply blockReturned _ _ _ _ outer
  have cleanR := cleanParamExec (n+16) t c outer "rep" rep hr rfl (by dsimp [outer]; writeInput)
  have cleanK := cleanParamExec (n+16) t c outer "commitment" k hk rfl (by dsimp [outer]; writeInput)
  have cleanM := cleanParamExec (n+16) t c outer "multiplier" m hm rfl (by dsimp [outer]; writeInput)
  have skip : Stmt.eval (n+17) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  exact (seqStep _ _ _ _ _ _ _ cleanR).trans ((seqStep _ _ _ _ _ _ _ cleanK).trans
    ((seqStep _ _ _ _ _ _ _ cleanM).trans ((seqStep _ _ _ _ _ _ _ skip).trans (stop _ _ _ _ _ _ [] _ main))))

end Inv02.Getter
