import Inv45GetterStorageArgs
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public
set_option maxHeartbeats 4000000
set_option maxRecDepth 4096

def payoutAllocated (r : Runtime) (n k : Nat) : Runtime :=
  (r.allocMemory (.fixedArray [.word (n-k),.word k])).1

def argumentsAllocated (r : Runtime) (n k : Nat) (unit : List Nat) : Runtime :=
  ((payoutAllocated r n k).allocMemory (.bytes unit)).1

theorem argumentMemory (r : Runtime) (n k : Nat) (unit : List Nat) :
    (argumentsAllocated r n k unit).loadMemory? r.nextMemory=some (.fixedArray [.word (n-k),.word k]) ∧
    (argumentsAllocated r n k unit).loadMemory? (r.nextMemory+1)=some (.bytes unit) ∧
    r.nextMemory<(argumentsAllocated r n k unit).nextMemory ∧
    r.nextMemory+1<(argumentsAllocated r n k unit).nextMemory := by
  constructor
  · change ((r.memory.insert r.nextMemory (.fixedArray [.word (n-k),.word k])).insert (r.nextMemory+1) (.bytes unit))[r.nextMemory]?=_
    rw [Std.HashMap.getElem?_insert]
    simp only [show (r.nextMemory+1 == r.nextMemory)=false by simp,if_false]
    simp
  constructor
  · change ((r.memory.insert r.nextMemory (.fixedArray [.word (n-k),.word k])).insert (r.nextMemory+1) (.bytes unit))[r.nextMemory+1]?=_
    simp
  · change r.nextMemory<r.nextMemory+1+1 ∧ r.nextMemory+1<r.nextMemory+1+1
    omega

def argumentFrame (r : Runtime) (n k : Nat) (lo hi : Int) (unit : List Nat) :=
  (argumentsAllocated r n k unit).withFrame
    [("_ic_arg_0",.memoryRef r.nextMemory),("_ic_arg_1",.memoryRef (r.nextMemory+1)),
     ("_ic_arg_2",.word n),("_ic_arg_3",.int (Signed.word lo)),("_ic_arg_4",.int (Signed.word hi))]

theorem preparedCall (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat) (lo hi : Int) (unit : List Nat)
    (targets : List String) (L : Signed.inRange lo) (H : Signed.inRange hi) (rise : lo<hi)
    (N : n<R) (pos : 0<n) (valid : k≤n) (len : unit.length<R) (sane : ∀ch∈unit,ch<256)
    (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Bytes.Retains (argumentFrame r n k lo hi unit) after ∧
      Decimal.Holds after (Text.label (Scale.display lo (hi-lo).toNat n k) unit n (Scale.tag (hi-lo).toNat n k)) out ∧
      after.locals=(argumentFrame r n k lo hi unit).locals ∧
      Stmt.eval (fuel+104) model.core.table c (argumentFrame r n k lo hi unit)
        (.internalCall targets Scalar.key [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2",.var "_ic_arg_3",.var "_ic_arg_4"])=
        internalCallAssign after targets [out] := by
  obtain ⟨a,b,d,e⟩ := argumentMemory r n k unit
  exact Scalar.call fuel c (argumentFrame r n k lo hi unit) r.nextMemory (r.nextMemory+1) n k lo hi unit
    "_ic_arg_0" "_ic_arg_1" "_ic_arg_2" "_ic_arg_3" "_ic_arg_4" targets
    L H rise N pos valid a b d e len sane cap rfl rfl rfl rfl rfl

theorem payoutDeclaration (r : Runtime) (n k : Nat) :
    r.declareMemoryLocal (.fixedArray 2 .uint256) "_ic_arg_0" (.fixedArray [.word (n-k),.word k])=
      some ((payoutAllocated r n k).declareLocal "_ic_arg_0" (.memoryRef r.nextMemory)) := by
  rfl

theorem unitDeclaration (r : Runtime) (unit : List Nat) :
    r.declareMemoryLocal .bytesCalldata "_ic_arg_1" (.bytes unit)=
      some ((r.allocMemory (.bytes unit)).1.declareLocal "_ic_arg_1" (.memoryRef r.nextMemory)) := by
  rfl
#print axioms payoutDeclaration
#print axioms unitDeclaration
#print axioms argumentMemory
#print axioms preparedCall
end Inv45.Public
