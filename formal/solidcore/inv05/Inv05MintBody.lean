import Inv05MintRun
import Inv32InverseCall
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorFastPath Inv32QuoteExpr Inv32Actions Inv32Normal
namespace Inv05
theorem shapeEq : shape.value = .block [cleanParam "cash",cleanParam "units",cleanParam "net",.skip,.block purchase] := rfl

theorem positiveBody (f : Nat) (c : Context) (r : Runtime) (cash units net : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (cp : 0<cash) (up : 0<units) (np : 0<net)
    (fits : cash*10^9<R) :
    let src := r.withFrame (frame cash units net 0)
    Ends ((quote cash units net).map fun a => r.withFrame (frame cash units net a))
      (Stmt.eval (f+27) Inv03.model.core.table c src shape.value) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame cash units net 0)
  let outer := src.pushScope
  have sub := purchaseRun f c r cash units net hc hu hn cp up np fits
  have mid := block (f+25) t c outer purchase _ sub
  have A := cleanParamExec (f+25) t c outer "cash" cash hc rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+25) t c outer "units" units hu rfl (by dsimp [outer,src,frame]; write_param)
  have C := cleanParamExec (f+25) t c outer "net" net hn rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+26) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  have body := block (f+26) t c src _ _ (step _ _ _ _ _ _ _ _ A (step _ _ _ _ _ _ _ _ B
    (step _ _ _ _ _ _ _ _ C (step _ _ _ _ _ _ _ _ sk (Inv32InverseCall.single _ _ _ _ _ _ mid)))))
  dsimp only
  rw [shapeEq]
  cases h : quote cash units net <;> rw [h] at body <;> exact body

theorem zeroBody (f : Nat) (c : Context) (r : Runtime) (units net : Nat) (hu : units<R) (hn : net<R) :
    let src := r.withFrame (frame 0 units net 0)
    Stmt.eval (f+27) Inv03.model.core.table c src shape.value = pure (.returned src [.word 0]) := by
  let t := Inv03.model.core.table
  let src := r.withFrame (frame 0 units net 0)
  let outer := src.pushScope
  let inner := outer.pushScope
  have choose := Inv32Blocks.branch (f+24) t c inner (Inv32WideGuards.zeroTest "cash").core (.returnValues [.word 0]) .skip true
    (evalFormula _ c inner 1 (by decide) (Inv32WideGuards.zeroValue c.checked (locals inner) "cash" 0 (by decide) rfl))
  have ret := Inv32CompareValues.retOne (f+23) t c inner (.word 0) 0 rfl
  have mid := blockReturned (f+25) t c outer inner purchase _ (stop _ _ _ _ _ _ _ _ (choose.trans ret))
  have A := cleanParamExec (f+25) t c outer "cash" 0 (by decide) rfl (by dsimp [outer,src,frame]; write_param)
  have B := cleanParamExec (f+25) t c outer "units" units hu rfl (by dsimp [outer,src,frame]; write_param)
  have C := cleanParamExec (f+25) t c outer "net" net hn rfl (by dsimp [outer,src,frame]; write_param)
  have sk : Stmt.eval (f+26) t c outer .skip = pure (.normal outer) := by rw [Stmt.eval]
  dsimp only
  rw [shapeEq]
  exact blockReturned _ _ _ _ outer _ _ ((seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans
    ((seqStep _ _ _ _ _ _ _ C).trans ((seqStep _ _ _ _ _ _ _ sk).trans (stop _ _ _ _ _ _ [] _ mid)))))
end Inv05
