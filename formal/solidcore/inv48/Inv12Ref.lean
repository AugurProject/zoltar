import Inv12Assignment
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv12
structure Ref where
  slot : Nat
  members : List StorageLayout
def Ref.bound (a : Ref) (r : Runtime) (name : String) :=
  r.lookupStorageBase? name=some (.slot a.slot (.struct a.members))
def Ref.hasField (a : Ref) (idx off : Nat) :=
  StorageLayouts.fieldOffsetAndLayout? (Shared.norm (Shared.norm idx)) 0 a.members=some (off,.packedScalar 0 32 false .uint256)
def Ref.get (a : Ref) (s : State) (off : Nat) := amountAt s a.slot off
theorem Ref.fits (a : Ref) (s : State) (off : Nat) : a.get s off<R := Nat.mod_lt _ (by decide)
theorem Ref.cleanRead (a : Ref) (c : Context) (r : Runtime) (name : String) (i off : Nat)
    (small : i<R) (aliasSlot : a.bound r name) (f : a.hasField i off) :
    Inv40.Reads c r (Inv03.Bodies.clean (Inv08.Integral.member name i)).value (a.get r.state off) :=
  Inv08.ReleaseQuote.readClean (readAmount _ _ _ _ _ _ _ small aliasSlot f) (a.fits _ _)

theorem lookupOther (r : Runtime) (name other : String) (v : Value) (different : other≠name) :
    (r.declareLocal other v).lookupLocal? name=r.lookupLocal? name := by
  cases h : r.locals <;>
    simp [Runtime.lookupLocal?,Runtime.declareLocal,h,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,different,Ne.symm different]
theorem Ref.afterDecl (a : Ref) (bound : a.bound r name) (other : String) (v : Value) (different : other≠name) :
    a.bound (r.declareLocal other v) name := by
  unfold Ref.bound Runtime.lookupStorageBase? at *
  rw [lookupOther _ _ _ _ different]; exact bound
theorem Ref.afterScope (a : Ref) (bound : a.bound r name) : a.bound r.pushScope name := by
  simpa [Ref.bound,Runtime.lookupStorageBase?,Runtime.lookupLocal?,Runtime.pushScope,LocalEnv.lookup?,Frame.lookup?] using bound
end Inv12
