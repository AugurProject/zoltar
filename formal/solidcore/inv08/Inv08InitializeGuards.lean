import Inv08InitializeShape
import Inv08AddStreamGuards
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32FloorStart Inv03.Bodies
namespace Inv08.Initialize
theorem deployerOK (n : Nat) (c : Context) (r : Runtime) (fit : c.sender<R)
    (imm : r.loadImmutableField c "initializer" = pure (.word c.sender)) :
    deployer.value.eval (n+1) model.core.table c r = pure (.normal r) := by
  have lhs : Inv40.Reads c r .caller c.sender := by
    intro fuel enough
    cases fuel with
    | zero => change 1≤0 at enough; omega
    | succ n => rw [Expr.evalFuel]
  have rhs : Inv40.Reads c r (.immutable "initializer") c.sender := by
    intro fuel enough
    cases fuel with
    | zero => change 1≤0 at enough; omega
    | succ n => rw [Expr.evalFuel,imm]; rfl
  have eq := ReleaseQuote.binary lhs rhs .eq (by intro h; cases h) (by intro h; cases h)
    (Inv32WideGuards.eqWord c.checked _ _ fit fit)
  simp only [if_pos rfl] at eq
  exact AddStream.requireHolds _ _ _ _ _ eq

theorem emptyOK (n : Nat) (c : Context) (r : Runtime)
    (fields : c.storageFields=model.core.context.storageFields) (zero : stored r.state .duration=0) :
    empty.value.eval (n+1) model.core.table c r=pure (.normal r) := by
  have read := reads c r .duration fields
  rw [zero] at read
  have lhs := Expiry.cleaned read (by decide)
  have rhs := Authority.castBits (Authority.literal c r 0 (by decide)) 48 (by decide) (by decide) (by decide)
  have eq := ReleaseQuote.binary lhs rhs .eq (by intro h; cases h) (by intro h; cases h)
    (Inv32WideGuards.eqWord c.checked 0 0 (by decide) (by decide))
  exact AddStream.requireHolds _ _ _ _ _ eq

theorem positiveOK (n : Nat) (c : Context) (r : Runtime) (d : Nat) (fit : d<2^48) (pos : 0<d)
    (found : r.lookupLocal? "vestingDuration"=some (.word d)) :
    positive.value.eval (n+1) model.core.table c r=pure (.normal r) := by
  have rhs := Authority.castBits (Authority.literal c r 0 (by decide)) 48 (by decide) (by decide) (by decide)
  have ne := ReleaseQuote.binary (Expiry.local48 _ _ _ _ fit found) rhs .ne (by intro h; cases h) (by intro h; cases h)
    (AddStream.neRead c d 0 (lt_trans fit (by decide)) (by decide))
  simp only [if_neg (Nat.ne_of_gt pos)] at ne
  exact AddStream.requireHolds _ _ _ _ _ ne

theorem timeOK (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (tm : Nat)
    (current : tm ≤ EnvWord.blockTimestamp.eval c) (word : EnvWord.blockTimestamp.eval c < Inv32Division.R)
    (found : r.lookupLocal? "timestamp"=some (.word tm)) :
    time.value.eval (n+1) t c r=pure (.normal r) := by
  have timeWord := lt_of_le_of_lt current word
  have lhs := ReleaseQuote.readClean (localReads c r _ _ found) timeWord
  have env : Inv40.Reads c r (.env .blockTimestamp) (EnvWord.blockTimestamp.eval c) := by
    intro fuel enough
    cases fuel with
    | zero => change 1≤0 at enough; omega
    | succ n => simp [Expr.evalFuel]
  have rhs := ReleaseQuote.readClean env word
  have op : BinaryOp.apply c.checked .le (.word tm) (.word (EnvWord.blockTimestamp.eval c)) = .ok (.word 1) := by
    simpa [current] using Inv32WideGuards.leWord _ _ timeWord word
  exact Inv32QuoteGuard.requireEval _ _ _ _ _ true "Future fee checkpoint"
    (ReleaseQuote.binary lhs rhs .le (by intro h; cases h) (by intro h; cases h) op _ (Nat.le_succ _))

end Inv08.Initialize
