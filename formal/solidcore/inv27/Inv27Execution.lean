import Inv27Expressions
open SolidCore.Solidity.Source Inv32Division Inv32FloorFastPath Inv32FloorStart Inv32Actions Inv32QuoteExpr Inv03.Bodies
namespace Inv27
def frame (p e : Nat) : Frame := [("price",.word p),("uncertainty",.word e),("_ret0",.word 0)]
abbrev table := Inv03.model.core.table
def lowerCall := Inv32FloorHoist.code tmp (w "price").core prec.core (Inv32Midpoint.plus prec (w "uncertainty")).core
def maximumCall := Inv32FloorHoist.code tmp (Inv32Product.clean (Inv32Scalar.literal M)).core
  (nonnegativeSub prec (w "uncertainty")).core prec.core
def upperCall := Inv03.Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest
  (w "price").core prec.core (nonnegativeSub prec (w "uncertainty")).core (enumWord 1).value
def output := Stmt.returnValues [(castCopy tmp).core]
def init := Stmt.varDecl .uint256 tmp none
def setMax := Stmt.varDecl .uint256 "maximumPrice" (some (castCopy tmp).core)
def code (cons : Bool) := [guard.value,init] ++ (if cons then [maximumCall,setMax,priceGuard.value,init,upperCall]
  else [lowerCall]) ++ [output]
theorem shape (cons : Bool) : (body cons).value = .block [cleanParam "price",cleanParam "uncertainty",.skip,.block (code cons)] := by
  cases cons <;> rfl

inductive Answer | value (amount : Nat) | error (reason : String)
def Answer.atState (answer : Answer) (r : Runtime) : Result := match answer with
  | .value amount => .returned r [.word amount]
  | .error reason => .reverted r (.error reason)
private theorem stopAnswer (fuel : Nat) (c : Context) (r next : Runtime) (s : Stmt) (tail : List Stmt) (a : Answer)
    (h : Stmt.eval fuel table c r s = pure (a.atState next)) :
    Stmt.evalList fuel table c r (s::tail) = pure (a.atState next) := by
  cases a with
  | value v => exact stop _ _ _ _ _ _ _ _ h
  | error msg => exact Inv32Revert.stop _ _ _ _ _ _ _ _ h
private theorem blockAnswer (fuel : Nat) (c : Context) (r next : Runtime) (stmts : List Stmt) (a : Answer)
    (h : Stmt.evalList fuel table c r.pushScope stmts = pure (a.atState next)) :
    Stmt.eval (fuel+1) table c r (.block stmts) = pure (a.atState next.popScope) := by
  cases a with
  | value v => exact blockReturned _ _ _ _ _ _ _ h
  | error msg => exact Inv32Revert.blockRevert _ _ _ _ _ _ _ h

theorem runBody (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (he : e<R)
    (cons : Bool) (a : Answer)
    (evaluate : let src := r.withFrame (frame p e)
      ∃ next, next.popScope = src.pushScope ∧
        Stmt.evalList (f+20) table c src.pushScope.pushScope (code cons) = pure (a.atState next)) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table c src (body cons).value = pure (a.atState src) := by
  let src := r.withFrame (frame p e)
  let outer := src.pushScope
  obtain ⟨next,popped,steps⟩ := evaluate
  have mid := blockAnswer _ c outer next (code cons) a steps
  rw [popped] at mid
  have A := cleanParamExec (f+20) table c outer "price" p hp rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+20) table c outer "uncertainty" e he rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+21) table c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  rw [shape]
  apply blockAnswer (f+21) c src outer _ a
  exact (seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans (stopAnswer _ _ _ _ _ [] _ mid)))

theorem invalid (f : Nat) (c : Context) (r : Runtime) (p e : Nat) (hp : p<R) (he : e<R) (bad : D≤e) (cons : Bool) :
    let src := r.withFrame (frame p e)
    Stmt.eval (f+22) table c src (body cons).value = pure (.reverted src (.error "Invalid oracle uncertainty")) := by
  apply runBody _ _ _ _ _ hp he cons (.error _)
  let inner := (r.withFrame (frame p e)).pushScope.pushScope
  have rejected := guardExec (f+19) c inner e he rfl
  rw [if_neg (Nat.not_lt.mpr bad)] at rejected
  exact ⟨inner,rfl,Inv32Revert.stop _ _ _ _ _ _ _ _ rejected⟩
end Inv27
