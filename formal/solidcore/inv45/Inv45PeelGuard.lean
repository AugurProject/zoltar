import Inv45ValidGuard
open SolidCore.Solidity.Source
namespace Inv45.Public
private theorem lookupScope (r : Runtime) (name : String) : r.pushScope.lookupLocal? name=r.lookupLocal? name := by
  simp [Runtime.lookupLocal?,Runtime.pushScope,LocalEnv.lookup?,Frame.lookup?]
private theorem other (r : Runtime) (newName name : String) (v : Value) (h : newName≠name) :
    (r.declareLocal newName v).lookupLocal? name=r.lookupLocal? name := by
  cases H : r.locals <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.lookup?,LocalEnv.declare,Frame.lookup?,H,h]

theorem peelValidGuard (tail : List Stmt) (fuel : Nat) (c : Context) (r : Runtime) (q n : Nat)
    (fields : c.storageFields=model.core.storageFields) (id : r.lookupLocal? "questionId"=some (.word q))
    (sum : r.lookupLocal? "sum"=some (.word n)) (pos : 0<n) (N : n<Answer.radix)
    (ticks : wordBitRange 96 120 (r.state.loadSlot (questionMemberSlot q 2))=n) :
    Stmt.evalList (fuel+4) model.core.table c r.pushScope (readTicksInto "#read1610"::positiveDecl::checkEquality::tail)=
      Stmt.evalList (fuel+4) model.core.table c (readyForLabel r n) tail := by
  let first := r.pushScope.declareLocal "#read1610" (.word n)
  let ready := readyForLabel r n
  let last := ready.pushScope.declareLocal "#read1617" (.word n)
  have rt := readTick c r.pushScope q n N fields ((lookupScope r _).trans id) ticks
  have A := Inv32Hoist.declEval (fuel+3) model.core.table c r.pushScope "#read1610" .uint256 readTickExpr n rt rfl
  have B := Inv32Hoist.declEval (fuel+3) model.core.table c first "#cond1619" .bool positiveExpr 1
    (positiveRead c first n pos N rfl _ (Nat.le_succ _)) rfl
  have lookup (name : String) (a : "#cond1619"≠name) (b : "#read1610"≠name) :
      ready.pushScope.lookupLocal? name=r.lookupLocal? name := by
    rw [lookupScope];exact (other first _ _ _ a).trans ((other r.pushScope _ _ _ b).trans (lookupScope r _))
  have st := readTick c ready.pushScope q n N fields ((lookup _ (by decide) (by decide)).trans id) ticks
  have C := Inv32Hoist.declEval (fuel+1) model.core.table c ready.pushScope "#read1617" .uint256 readTickExpr n st rfl
  have D := assignMatch (fuel+1) c last n (lt_trans N (by decide))
    ((other ready.pushScope _ _ _ (by decide)).trans ((lookup _ (by decide) (by decide)).trans sum)) rfl rfl
    (by simp [last,ready,readyForLabel,Runtime.pushScope,Runtime.declareLocal,Runtime.assignLocal?,Runtime.lookupLocal?,LocalEnv.lookup?,
      LocalEnv.assign?,LocalEnv.declare,Frame.lookup?,Frame.assign?,Value.coerceLike?])
  have compare : Stmt.eval (fuel+3) model.core.table c ready compareBody=pure (.normal ready) := by
    unfold compareBody readTicksInto
    rw [Stmt.eval];dsimp only
    rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ C,Inv32FloorStart.seqStep _ _ _ _ _ _ _ D,Stmt.evalList];rfl
  have branch := (trueLocal (fuel+3) c ready compareBody .skip rfl).trans compare
  unfold readTicksInto positiveDecl checkEquality
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ A,Inv32FloorStart.seqStep _ _ _ _ _ _ _ B]
  change Stmt.evalList (fuel+4) model.core.table c ready (Stmt.ifElse (.var "#cond1619") compareBody .skip::tail)=_
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ branch]
#print axioms peelValidGuard
end Inv45.Public
