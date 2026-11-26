import Inv32NewtonSeed
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Scalar Inv32Product Inv32NewtonBody Inv32NewtonSeed
namespace Inv32WideWords
private theorem norm (w : W) : Shared.norm w.toNat = w.toNat := Nat.mod_eq_of_lt w.isLt
private theorem toEvm (w : W) : Shared.toEvmWord w.toNat = ⟨w.toFin⟩ := by
  apply congrArg EvmYul.UInt256.mk
  apply Fin.ext
  change (w.toNat%R)%R = _
  simp [Nat.mod_eq_of_lt w.isLt]
private theorem fromEvm (a : Fin (2^256)) : Shared.ofEvmWord ⟨a⟩ = a.val := Nat.mod_eq_of_lt a.isLt

theorem andWord (x y : W) : Source.BinaryOp.apply false .bitAnd (.word x.toNat) (.word y.toNat) =
    .ok (.word (x &&& y).toNat) := by
  have eqn : Shared.andWord x.toNat y.toNat = (x &&& y).toNat := by
    unfold Shared.andWord Shared.liftEvmBinary
    rw [toEvm,toEvm, EvmYul.UInt256.land,fromEvm]
    change ((x.toNat &&& y.toNat)%R) = _
    rw [Nat.mod_eq_of_lt (lt_of_le_of_lt Nat.and_le_left x.isLt)]; rfl
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.applyWord,eqn,Bind.bind,Except.bind]

theorem orWord (x y : W) : Source.BinaryOp.apply false .bitOr (.word x.toNat) (.word y.toNat) =
    .ok (.word (x ||| y).toNat) := by
  have eqn : Shared.orWord x.toNat y.toNat = (x ||| y).toNat := by
    unfold Shared.orWord Shared.liftEvmBinary
    rw [toEvm,toEvm, EvmYul.UInt256.lor,fromEvm]
    change ((x.toNat ||| y.toNat)%R) = _
    rw [Nat.mod_eq_of_lt (Nat.or_lt_two_pow x.isLt y.isLt)]; rfl
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.applyWord,eqn,Bind.bind,Except.bind]

theorem addWord (x y : W) : Source.BinaryOp.apply false .add (.word x.toNat) (.word y.toNat) =
    .ok (.word (x+y).toNat) := by
  have eqn : Shared.addWord x.toNat y.toNat = (x+y).toNat := by
    unfold Shared.addWord Shared.liftEvmBinary
    rw [toEvm,toEvm,EvmYul.UInt256.add,fromEvm]; rfl
  simp [Source.BinaryOp.apply,Source.BinaryOp.preservesFixedBytesWidth,Value.forceAbiLazy,Source.BinaryOp.applyWord,
    checkedAdd,eqn,Bind.bind,Except.bind]

def andF := binary .bitAnd (by intro h; cases h) (by intro h; cases h)
def addF := binary .add (by intro h; cases h) (by intro h; cases h)
def lowBit := clean (andF den (twice (subF (literal 0) den)))
theorem lowBitValue (env : Env) (d : W) (hd : env "denominator" = some d.toNat) :
    lowBit.run false env = some (d &&& -d).toNat := by
  have D := Inv32ProductValues.cleanup (localWord "denominator") false env _ d.isLt hd
  apply Inv32ProductValues.cleanup _ _ _ _ (d &&& -d).isLt
  apply binaryValue _ _ _ _ _ _ d (-d) _ D _ (andWord d (-d))
  apply double
  simpa using binaryValue _ _ _ env (literal 0) den (0 : W) d _ rfl D (Inv32NewtonBody.subWord 0 d)
theorem declarationMatches : Inv32FloorStart.instructions[13]? = some (.varDecl .uint256 "twos" (some lowBit.core)) := by rfl
theorem declaration (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W)
    (u : c.checked = false) (hd : Inv32Actions.locals r "denominator" = some d.toNat) :
    Source.Stmt.eval (n+1) t c r (.varDecl .uint256 "twos" (some lowBit.core)) =
    pure (.normal (r.declareLocal "twos" (.word (d &&& -d).toNat))) := by
  have h := Inv32Actions.evalFormula lowBit c r _ (by decide) (u ▸ lowBitValue _ _ hd)
  rw [Source.Stmt.eval]; dsimp only; rw [h]; rfl
end Inv32WideWords
