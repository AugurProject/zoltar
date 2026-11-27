import Inv05MintTail
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32FloorHoist Inv32QuoteExpr Inv32Actions Inv32Normal
namespace Inv05
def zeroCheck (name : String) (ret : Expr) := Stmt.ifElse (Inv32WideGuards.zeroTest name).core (.returnValues [ret]) .skip
def amount (cash units net : Nat) := cash*10^9*units/net
def quote (cash units net : Nat) : Option Nat :=
  let a := amount cash units net
  if a<R ∧ permitted cash units net a then some a else none
def purchase : List Stmt := [
  zeroCheck "cash" (.word 0),zeroCheck "units" (scale (Inv03.Bodies.wvar "cash")).value,
  .requireStmt (nz "net").value (some "Settlement backing exhausted"),
  .varDecl .uint256 Inv03.Bodies.tmp none,
  code Inv03.Bodies.tmp (scale (Inv03.Bodies.wvar "cash")).value (w "units").core (w "net").core,
  .assign (.var "added") (castCopy Inv03.Bodies.tmp).core] ++ tailCode

theorem skipZero (f : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (name : String) (v : Nat)
    (small : v<R) (positive : 0<v) (lookup : locals r name=some v) (ret : Expr) :
    Stmt.eval (f+2) t c r (zeroCheck name ret) = pure (.normal r) := by
  have val := Inv32WideGuards.zeroValue c.checked (locals r) name v small lookup
  rw [if_neg (Nat.ne_of_gt positive)] at val
  have read := evalFormula (Inv32WideGuards.zeroTest name) c r 0 (by exact of_decide_eq_true rfl) val
  rw [zeroCheck,Inv32Blocks.branch _ _ _ _ _ _ _ false read]
  change Stmt.eval (f+1) t c r .skip = _
  rw [Stmt.eval]

theorem purchaseRun (f : Nat) (c : Context) (r : Runtime) (cash units net : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (cp : 0<cash) (up : 0<units) (np : 0<net)
    (scaledFits : cash*10^9<R) :
    Ends ((quote cash units net).map fun a => marked r cash units net a 1)
      (Stmt.evalList (f+25) Inv03.model.core.table c (work r cash units net 0) purchase) := by
  let t := Inv03.model.core.table
  let src := work r cash units net 0
  let x := cash*10^9
  let a := amount cash units net
  have A := skipZero (f+23) t c src "cash" cash hc cp rfl (.word 0)
  have B := skipZero (f+23) t c src "units" units hu up rfl (scale (Inv03.Bodies.wvar "cash")).value
  have g := nonzero c src "net" net hn rfl
  rw [show decide (net≠0)=true from decide_eq_true (Nat.ne_of_gt np)] at g
  have C := guardResult (f+24) t c src _ "Settlement backing exhausted" true g
  have args : Inputs c src Inv03.Bodies.tmp (scale (Inv03.Bodies.wvar "cash")).value (w "units").core (w "net").core x units net :=
    ⟨Inv03.Expressions.scaled c _ "cash" cash hc scaledFits rfl,
     Inv32Guards.clean _ _ _ _ _ hu (Inv32Guards.readWord _ _ _ _ _ rfl),
     Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl)⟩
  unfold purchase
  refine step _ _ _ _ _ _ _ _ A (step _ _ _ _ _ _ _ _ B (step _ _ _ _ _ _ _ _ C ?_))
  refine step _ _ _ _ _ _ _ _ (zero (f+24) t c src Inv03.Bodies.tmp) ?_
  by_cases small : a<R
  · have first := successAt t Inv03.productLinked Inv03.floorLinked (f+10) c src Inv03.Bodies.tmp _ _ _ x units net
      scaledFits hu hn np small args (by decide) (by decide) (by decide) (by decide)
    let got := Inv32OneArg.store src Inv03.Bodies.tmp a
    have put := Inv32Assign.scalarCast (f+24) t c got (minted r cash units net a) "added" 0 a _ _ _ rfl
      (evalFormula (castCopy Inv03.Bodies.tmp) c got a (by decide) (castValue _ _ _ _ small rfl))
      (by dsimp [got,src,minted,work,frame,Inv32OneArg.store,Inv03.Bodies.tmp,Inv32CeilFlags.h0,Runtime.withFrame]; write_temps)
    refine step _ _ _ _ _ _ _ _ first (step _ _ _ _ _ _ _ _ put ?_)
    have end' := finish (f+7) c r cash units net a hc hu hn small cp up scaledFits
      (lt_of_le_of_lt (precisionBound cash units net) scaledFits)
    unfold quote
    change Ends ((if a<R ∧ permitted cash units net a then some a else none).map _) _
    cases gate : permitted cash units net a <;> simp [small,gate] at end' ⊢ <;> exact end'
  · have fail := floorOverflow f c src Inv03.Bodies.tmp _ _ _ x units net scaledFits hu hn np (Nat.le_of_not_gt small) args
    unfold quote
    rw [if_neg (fun h => small h.1)]
    exact reject _ _ _ _ _ _ fail
end Inv05
