import Inv03FeeBody

open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist
namespace Inv03.Fee
abbrev a3 := Inv32CeilHoist.a3
abbrev a4 := "_ic_arg_4"
def argv : List Expr := [.var a0,.var a1,.var a2,.var a3,.var a4]

private theorem pureBind {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

theorem call (n : Nat) (c : Context) (r : Runtime) (q s rate net total : Nat)
    (hq : q<R) (hs : s<R) (hr : rate<R) (hn : net<R) (ht : total<R)
    (np : 0<net) (tp : 0<total) (hc : ceilQuot (s*rate) (10^18)<R)
    (scaledFits : total*10^9<R) (hv : rawValue q net total<R)
    (Q : r.lookupLocal? a0 = some (.word q)) (S : r.lookupLocal? a1 = some (.word s))
    (R' : r.lookupLocal? a2 = some (.word rate)) (N : r.lookupLocal? a3 = some (.word net))
    (T : r.lookupLocal? a4 = some (.word total)) :
    Stmt.eval (n+31) model.core.table c r (.internalCall [Bodies.feeRet] Bodies.feeKey argv) =
      internalCallAssign r [Bodies.feeRet] [.word (budget q (ceilQuot (s*rate) (10^18)) net total)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := Bodies.feeSignature
  let empty := {r with locals := []}
  let src := empty.withFrame (frame q s rate net total)
  let v := budget q (ceilQuot (s*rate) (10^18)) net total
  let vs := [Value.word q,.word s,.word rate,.word net,.word total]
  have args : Expr.evalRefArgList c r argv = pure (vs,r) := by
    change Expr.evalRefArgListFuel (_+1) c r [.var a0,.var a1,.var a2,.var a3,.var a4] = _
    simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
      Inv32ProductCall.wordArg _ _ _ _ Q,Inv32ProductCall.wordArg _ _ _ _ S,Inv32ProductCall.wordArg _ _ _ _ R',
      Inv32ProductCall.wordArg _ _ _ _ N,Inv32ProductCall.wordArg _ _ _ _ T,pureBind,vs]
  have enter : internalCallEnter? fn vs r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [vs,Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := execute n {c with checked := true} empty q s rate net total hq hs hr hn ht np tp hc scaledFits hv
  rw [←bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ args found enter ev]
  have ret : coerceReturnBindingsRef fn.returns src [.word v] = .ok [.word v] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,
      Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  dsimp only [src,v] at ret
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret]
  rfl
end Inv03.Fee
