import Inv03Rounded
import Inv03Expressions
import Inv03Hoist

open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr
namespace Inv03
private def rawFrame (x net total : Nat) : Frame :=
  [("weight",.word x),("net",.word net),("units",.word total),("rounding",.word 0),("_ret0",.word 0)]

private theorem rawExecution (n : Nat) (c : Context) (r : Runtime) (x net total : Nat)
    (hx : x<R) (hn : net<R) (ht : total<R) (positive : 0<total)
    (scaledFits : total*10^9<R) (fits : rawValue x net total<R) :
    let src := r.withFrame (rawFrame x net total)
    Stmt.eval (n+24) model.core.table c src Bodies.rawBody.value =
      pure (.returned src [.word (rawValue x net total)]) := by
  let t := model.core.table
  let src := r.withFrame (rawFrame x net total)
  let outer := src.pushScope
  let inner := outer.pushScope
  let work := inner.pushScope
  let q := rawValue x net total
  let zeroRet := Stmt.returnValues [.word 0]
  let expr := (Bodies.scaledUnits "units").value
  let rhs := Hoist.code Inv32Bodies.Ceil.key Inv32CeilHoist.dest (w "weight").core (w "net").core expr (.var "rounding")
  let compute := Stmt.block [.varDecl .uint256 Bodies.tmp none,rhs,.returnValues [(castCopy Bodies.tmp).core]]
  have test := Expressions.zeros c inner "weight" "units" x total hx ht rfl rfl
  have choose := Inv32Blocks.branch (n+21) t c inner _ zeroRet compute _ test
  have branch : Stmt.eval (n+22) t c inner (.ifElse (Bodies.zeros "weight" "units").value zeroRet compute) =
      pure (.returned inner [.word q]) := by
    rw [choose]
    by_cases h : x=0
    · simp only [h,true_or,decide_true,if_true]
      have zero : q=0 := by simp [q,rawValue,h]
      rw [zero]
      exact Inv32CompareValues.retOne _ _ _ _ _ _ (by rfl)
    · simp only [h,Nat.ne_of_gt positive,false_or,decide_false,Bool.false_eq_true,if_false]
      let st := Hoist.frame work Inv32CeilHoist.dest 0 x net (total*10^9) 0 0
      have inputs : Inv32FloorHoist.Inputs c work Bodies.tmp (w "weight").core (w "net").core expr x net (total*10^9) :=
        ⟨Inv32Guards.clean _ _ _ _ _ hx (Inv32Guards.readWord _ _ _ _ _ rfl),
         Inv32Guards.clean _ _ _ _ _ hn (Inv32Guards.readWord _ _ _ _ _ rfl),
         Expressions.scaled _ _ "units" total ht scaledFits rfl⟩
      have called := roundedCall n c st Inv32FloorHoist.a0 Inv32FloorHoist.a1 Inv32FloorHoist.a2 Inv32CeilHoist.a3
        [Inv32CeilHoist.dest] x net (total*10^9) false hx hn scaledFits (Nat.mul_pos positive (by decide))
        (by rw [roundedFloor]; exact fits) rfl rfl rfl rfl
      rw [roundedFloor] at called
      have step := Hoist.run (n+17) t c work _ _ _ _ _ _ x net (total*10^9) 0 q inputs
        (Inv32Guards.readWord _ _ _ "rounding" 0 rfl) (by decide) called
      let finish := Inv32OneArg.store work Bodies.tmp q
      have ret := Inv32CompareValues.retOne (n+19) t c finish (castCopy Bodies.tmp).core q
        (evalFormula (castCopy Bodies.tmp) c finish q (by decide) (castValue _ _ _ _ fits rfl))
      apply blockReturned _ _ _ _ finish
      exact (seqStep _ _ _ _ _ _ _ (zero (n+19) t c work Bodies.tmp)).trans
        ((seqStep _ _ _ _ _ _ _ step).trans (stop _ _ _ _ _ _ [] _ ret))
  have mid := blockReturned (n+22) t c outer inner _ _ (stop _ _ _ _ _ _ [] _ branch)
  have a := cleanParamExec (n+22) t c outer "weight" x hx rfl (by dsimp [outer,src,rawFrame]; write_param)
  have b := cleanParamExec (n+22) t c outer "net" net hn rfl (by dsimp [outer,src,rawFrame]; write_param)
  have d := cleanParamExec (n+22) t c outer "units" total ht rfl (by dsimp [outer,src,rawFrame]; write_param)
  have sk : Stmt.eval (n+23) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  apply blockReturned _ _ _ _ outer
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans ((seqStep _ _ _ _ _ _ _ d).trans
    ((seqStep _ _ _ _ _ _ _ sk).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ mid)))))

theorem rawCall (n : Nat) (c : Context) (r : Runtime) (a b den mode : String)
    (targets : List String) (x net total : Nat) (hx : x<R) (hn : net<R) (ht : total<R)
    (positive : 0<total) (scaledFits : total*10^9<R) (fits : rawValue x net total<R)
    (X : r.lookupLocal? a = some (.word x)) (N : r.lookupLocal? b = some (.word net))
    (T : r.lookupLocal? den = some (.word total)) (M : r.lookupLocal? mode = some (.word 0)) :
    Stmt.eval (n+25) model.core.table c r (.internalCall targets Bodies.rawKey
      [.var a,.var b,.var den,.var mode]) = internalCallAssign r targets [.word (rawValue x net total)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Bodies.rawSignature
  let empty := {r with locals := []}
  let src := empty.withFrame (rawFrame x net total)
  have enter : internalCallEnter? fn [.word x,.word net,.word total,.word 0] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,rawFrame,src,empty,Runtime.withFrame]
  have ev := rawExecution n {c with checked := true} empty x net total hx hn ht positive scaledFits fits
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _
    (Inv32CeilCall.args4 _ _ _ _ _ _ _ _ _ _ X N T M) found enter ev]
  have ret : coerceReturnBindingsRef fn.returns src [.word (rawValue x net total)] =
      .ok [.word (rawValue x net total)] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src] at ret
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl

end Inv03
