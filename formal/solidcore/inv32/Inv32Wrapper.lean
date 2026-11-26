import Inv32InverseCall
import Inv32CoreBodies
open SolidCore.Solidity.Source Inv32Dispatch Inv32Division Inv32FloorFastPath Inv32FloorStart Inv32Exit
namespace Inv32Wrapper
def input : Direction → String | .forward => "amountIn" | .inverse => "amountOut"
def output : Direction → String | .forward => "amountOut" | .inverse => "amountIn"
def key : Direction → String | .forward => Inv32Bodies.Forward.key | .inverse => Inv32Bodies.Inverse.key
def result (d : Direction) (i : Nat) := "_ret___library_TwoWayConstantProductMath_" ++ method d ++ "_" ++ toString i
abbrev s0 := "_ic_arg_0"
abbrev s1 := "_ic_arg_1"
abbrev s2 := "_ic_arg_2"
abbrev s3 := "_ic_arg_3"
def argv : List Expr := [.var s0,.var s1,.var s2,.var s3]
def targets (d : Direction) := [result d 0,result d 1]
def callStmt (d : Direction) := Stmt.internalCall (targets d) (key d) argv
def prepare (d : Direction) : List Stmt := [temp s0 "reserveIn",temp s1 "reserveOut",temp s2 (input d),temp s3 "feeBps",
  .varDecl .uint256 (result d 0) none,.varDecl .uint256 (result d 1) none]
def ret (d : Direction) : Stmt := .returnValues [.var (result d 0),.var (result d 1)]
def inner (d : Direction) : Stmt := .block (prepare d ++ [.captureReturn (targets d) (callStmt d),ret d])
def outer (d : Direction) : Stmt := .block [cleanParam "reserveIn",cleanParam "reserveOut",cleanParam (input d),
  cleanParam "feeBps",.skip,.skip,.block [inner d]]
theorem checked (d : Direction) : (selected d).body = outer d := by
  cases d with
  | forward => exact Inv32CoreBodies.generatedinput
  | inverse => exact Inv32CoreBodies.generatedoutput
def frame (d : Direction) (x y a f : Nat) : Frame := [("reserveIn",.word x),("reserveOut",.word y),
  (input d,.word a),("feeBps",.word f),(output d,.word 0),("feeAmount",.word 0)]
def top (r : Runtime) (d : Direction) (x y a f : Nat) := r.withFrame (frame d x y a f)
def work (r : Runtime) (d : Direction) (x y a f q fee : Nat) :=
  (top r d x y a f).pushScope.pushScope.withFrame [
    (result d 1,.word fee),(result d 0,.word q),(s3,.word f),(s2,.word a),(s1,.word y),(s0,.word x)]
def toValues (o : Option (Nat × Nat)) := o.map (fun (p : Nat × Nat) => [Value.word p.1,.word p.2])
def Binds (r : Runtime) (d : Direction) (o : Option (Nat × Nat)) (prog : SolI Result) : Prop :=
  match o with
  | none => ∃ s e, prog = pure (Result.reverted s e)
  | some (q,f) => prog = internalCallAssign r (targets d) [.word q,.word f]

theorem setup (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : Direction) (x y a f : Nat)
    (hx : x<R) (hy : y<R) (ha : a<R) (hf : f<R) (ss : List Stmt) :
    Stmt.evalList (n+1) t c (top r d x y a f).pushScope.pushScope.pushScope (prepare d ++ ss) =
      Stmt.evalList (n+1) t c (work r d x y a f 0 0) ss := by
  cases d <;> (
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ x hx rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ y hy rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ a ha rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (Inv32Temps.temp _ _ _ _ _ _ f hf rfl)).trans ?_
    refine (seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _)).trans ?_
    exact seqStep _ _ _ _ _ _ _ (zero _ _ _ _ _))

private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl
theorem retValue (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : Direction) (x y a f q fee : Nat) :
    let st := work r d x y a f q fee
    Stmt.eval (n+1) t c st (ret d) = pure (.returned st [.word q,.word fee]) := by
  let st := work r d x y a f q fee
  have read (s : String) (v : Nat) (h : st.lookupLocal? s = some (.word v)) :
      Expr.evalReturnValue c st (.var s) = pure (.word v,st) := by
    simp only [Expr.evalReturnValue,Runtime.lookupMemoryRef?,h]; exact Inv32Guards.readWord _ _ _ _ _ h
  have A := read (result d 0) q (by cases d <;> rfl)
  have B := read (result d 1) fee (by cases d <;> rfl)
  have vs : Expr.evalReturnList c st [.var (result d 0),.var (result d 1)] = pure ([.word q,.word fee],st) := by
    change Expr.evalReturnListFuel (_+1+1+1) c st _ = _
    simp only [Expr.evalReturnListFuel,A,B,pb]
  unfold ret; dsimp only; rw [Stmt.eval]; dsimp only; rw [vs]; rfl
end Inv32Wrapper
