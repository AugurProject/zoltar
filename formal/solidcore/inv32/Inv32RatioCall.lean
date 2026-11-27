import Inv32RatioNarrow
open Inv32FloorFastPath SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Actions Inv32RatioTest Inv32RatioStep Inv32RatioLoop
namespace Inv32RatioCall
def returned := Stmt.returnValues [(Inv32QuoteExpr.w "low").core]
def seqs := [Inv32RatioNarrow.test,.varDecl .uint256 "low" none,Inv32FloorStart.temp "high" "scale",
  .whileLoop cond.core iteration,returned]
theorem shape : ss = seqs := by rfl
theorem execute (n : Nat) (c : Context) (r : Runtime) (s p o : Nat) (hs : s<R) (hp : p<R) (ho : o<R)
    (pos : 0<o+p) (ch : c.checked=true) :
    let src := r.withFrame (frame s p o)
    Stmt.eval (n+275) Inv32Dispatch.model.core.table c src Inv32Bodies.Ratio.body =
      pure (.returned src [.word (answer s p o)]) := by
  let t := Inv32Dispatch.model.core.table
  let src := r.withFrame (frame s p o)
  let outside := src.pushScope
  let inside := root r s p o
  let q := answer s p o
  have qr : q<R := lt_of_le_of_lt (bound _ _ _ pos) hs
  have branch := Inv32RatioNarrow.execute (n+255) c r s p o hs hp ho pos ch
  dsimp only at branch
  have mid : Stmt.eval (n+274) t c outside (.block ss) = pure (.returned outside [.word q]) := by
    rw [shape]
    by_cases small : o+p<R
    · rw [if_pos small] at branch
      exact Inv32FloorFastPath.blockReturned _ _ _ outside inside _ _ (Inv32FloorFastPath.stop _ _ _ _ _ _ _ _ branch)
    · rw [if_neg small] at branch
      let low := inside.declareLocal "low" (.word 0)
      let end' := range r s p o q q
      have Z := Inv32FloorStart.zero (n+272) t c inside "low"
      have H := Inv32Temps.temp (n+272) t c low "high" "scale" s hs rfl
      have loop := Inv32RatioLoop.run n c r s p o hs hp ho pos ch
      have R' := Inv32CompareValues.retOne (n+272) t c end' (Inv32QuoteExpr.w "low").core q
        (Inv32Guards.clean _ _ _ _ _ qr (Inv32Guards.readWord _ _ _ _ _ rfl))
      exact Inv32FloorFastPath.blockReturned _ _ _ outside end' _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ branch).trans
        ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ Z).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ H).trans
          ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ loop).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ R')))))
  have S := Inv32FloorFastPath.cleanParamExec (n+273) t c outside "scale" s hs rfl (by dsimp [outside,src,frame]; write_param)
  have P := Inv32FloorFastPath.cleanParamExec (n+273) t c outside "numeratorPart" p hp rfl (by dsimp [outside,src,frame]; write_param)
  have O := Inv32FloorFastPath.cleanParamExec (n+273) t c outside "otherPart" o ho rfl (by dsimp [outside,src,frame]; write_param)
  have skip : Stmt.eval (n+274) t c outside .skip = pure (.normal outside) := by rw [Stmt.eval]
  exact Inv32FloorFastPath.blockReturned _ _ _ src outside _ _ ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ S).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ P).trans ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ O).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ skip).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ mid)))))
theorem call (n : Nat) (c : Context) (r : Runtime) (a b d : String) (targets : List String)
    (s p o : Nat) (hs : s<R) (hp : p<R) (ho : o<R) (pos : 0<o+p)
    (S : r.lookupLocal? a = some (.word s)) (P : r.lookupLocal? b = some (.word p)) (O : r.lookupLocal? d = some (.word o)) :
    Stmt.eval (n+276) Inv32Dispatch.model.core.table c r (.internalCall targets Inv32Bodies.Ratio.key [.var a,.var b,.var d]) =
      internalCallAssign r targets [.word (answer s p o)] := by
  obtain ⟨fn,linked,ps,rs,bd⟩ := Inv32Library.linkRatio
  let empty := {r with locals := []}
  let src := empty.withFrame (frame s p o)
  have enter : internalCallEnter? fn [.word s,.word p,.word o] r = some (src,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]; simp [Inv32Library.decl,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,frame,src,empty,Runtime.withFrame]
  have ev := execute n {c with checked := true} empty s p o hs hp ho pos rfl
  change Stmt.eval _ _ _ src _ = _ at ev
  rw [← bd] at ev
  rw [Inv32Internal.call _ _ _ _ _ _ _ _ _ _ _ _ _ (Inv32FloorCall.args _ _ _ _ _ _ _ _ S P O) linked enter ev]
  simp [internalCallFinish,rs,coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,Inv32Library.decl,src,empty,Runtime.withFrame,
    Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
end Inv32RatioCall
