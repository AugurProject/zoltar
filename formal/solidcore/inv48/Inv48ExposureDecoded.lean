import Inv48MinimaCanonical
namespace Inv48.ExposureComparison
open SolidCore.Solidity SolidCore.Solidity.Source

def decoded (out : EvmCompiler.Simulation.CallResponse) (x : Nat) : Prop :=
  abiDecodeValuesExcept? [.uint256] ((byteArrayToBytes out.returnData).map normByte) = .ok [.word x]

 theorem decoded_unique {out : EvmCompiler.Simulation.CallResponse} {x y : Nat}
    (hx : decoded out x) (hy : decoded out y) : x = y := by
  unfold decoded at hx hy
  rw [hx] at hy
  injection hy with h
  injection h with h
  injection h

#print axioms decoded_unique
end Inv48.ExposureComparison
