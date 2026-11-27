import Inv05Call
open SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv32FloorHoist Inv32QuoteExpr Inv32Actions Inv32Normal Inv03.Bodies
namespace Inv05.Harness
def dest := "_ret___library_SecurityPoolSettlementMath_mintUnits_0"
def setup := hoist key dest [(a0,wvar "deposit"),(a1,wvar "units"),(a2,wvar "netCash")]
def names := ["deposit","units","netCash"]
def shape := Inv03.Bodies.block (names.map param ++ [Inv32Shapes.Stmt_skip,Inv03.Bodies.block [decl tmp Inv32Shapes.Option_none,setup,Inv03.Bodies.ret copied]])
def frame (cash units net : Nat) : Frame := [("deposit",.word cash),("units",.word units),("netCash",.word net),("_ret0",.word 0)]
def args (cash units net : Nat) : List Value := [.word cash,.word units,.word net]
def inner (r : Runtime) (cash units net : Nat) := (r.withFrame (frame cash units net)).pushScope.pushScope
theorem hoisted (f : Nat) (c : Context) (r : Runtime) (cash units net : Nat)
    (hc : cash<R) (hu : units<R) (hn : net<R) (funded : units=0 ∨ 0<net) (fits : cash*10^9<R) :
    let work := inner r cash units net
    Ends ((allUnits cash units net).map fun a => Inv32OneArg.store work tmp a)
      (Stmt.eval (f+30) Inv03.model.core.table c (Inv32OneArg.store work tmp 0) setup.value) := by
  let t := Inv03.model.core.table
  let work := inner r cash units net
  let st := fun o v => (st3 work tmp o cash units net).declareLocal dest (.word v)
  have called := call f c (st 0 0) a0 a1 a2 [dest] cash units net hc hu hn funded fits rfl rfl rfl
  have A := Inv32Temps.temp (f+28) t c (start work tmp 0) a0 "deposit" cash hc rfl
  have B := Inv32Temps.temp (f+28) t c (st1 work tmp 0 cash) a1 "units" units hu rfl
  have C := Inv32Temps.temp (f+28) t c (st2 work tmp 0 cash units) a2 "netCash" net hn rfl
  have D := zero (f+28) t c (st3 work tmp 0 cash units net) dest
  dsimp only
  cases Q : allUnits cash units net with
  | none =>
    rw [Q] at called
    obtain ⟨nr,e,ev⟩ := called
    have cap := Inv32Revert.capture _ _ _ _ _ _ [dest] _ ev
    refine ⟨nr.popScope,e,Inv32Revert.blockRevert _ _ _ _ _ _ _ ?_⟩
    exact (seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ C).trans
      ((seqStep _ _ _ _ _ _ _ D).trans (Inv32Revert.stop _ _ _ _ _ _ _ _ cap))))
  | some a =>
    rw [Q] at called
    have put : (st 0 0).assignLocal? dest (.word a) = some (st 0 a) := by
      dsimp [st,work,inner,frame,tmp,dest,Inv32CeilFlags.h0]; write_temps
    have cap := Inv32Hoist.takeReturn _ _ _ _ _ _ _ _ _ called put
    have copy := Inv32Hoist.lastCopy (f+28) t c (st 0 a) (st a a) tmp dest 0 a rfl rfl
      (by dsimp [st,work,inner,frame,tmp,dest,Inv32CeilFlags.h0]; write_temps)
    apply Inv32Hoist.block _ _ _ _ (st a a)
    exact (seqStep _ _ _ _ _ _ _ A).trans ((seqStep _ _ _ _ _ _ _ B).trans ((seqStep _ _ _ _ _ _ _ C).trans
      ((seqStep _ _ _ _ _ _ _ D).trans ((seqStep _ _ _ _ _ _ _ cap).trans copy))))
end Inv05.Harness
