import Inv48MinimaOracle
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv48.Minima

theorem wordLength (n v : Nat) : (wordToBytesBE n v).length=n := by
  induction n generalizing v with
  | zero => rfl
  | succ n ih => simp [wordToBytesBE,ih]

theorem wordFold (n v : Nat) :
    (wordToBytesBE n v).foldl (fun acc byte => acc*256+normByte byte) 0 = v%256^n := by
  induction n generalizing v with
  | zero => exact (Nat.mod_one v).symm
  | succ n ih =>
    simp only [wordToBytesBE,List.foldl_append,List.foldl_cons,List.foldl_nil,ih]
    simp only [normByte,Shared.Account.byte,Nat.mod_mod]
    rw [Nat.pow_succ',Nat.mod_mul]
    ac_rfl

theorem canonicalWord (v : Nat) (fit : v<Inv32Division.R) :
    bytesToWordBE (wordToBytesBE 32 v)=v := by
  simp [bytesToWordBE,wordFold,show 256^32=Inv32Division.R by decide,Shared.norm,show Shared.wordModulus=Inv32Division.R by rfl,Nat.mod_eq_of_lt fit]

theorem canonicalDecode (v : Nat) (fit : v<Inv32Division.R) :
    abiDecodeValuesExcept? [.uint256] (wordToBytesBE 32 v)=.ok [.word v] := by
  simp [abiDecodeValuesExcept?,Ty.listAbiHeadWords?,Ty.abiHeadWords?,Ty.isDynamicAbi,
    Ty.staticAbiHeadWords?,abiDecodeOpt,abiDecodeValuesAux?,abiDecodeValueAt?,Ty.abiDecodeFuel,
    abiDecodeValueAtWithFuel?,readWord?,wordBytes,Bind.bind,Except.bind,readBytes?,wordLength,
    Inv12.bytesClean,canonicalWord v fit,Pure.pure,Except.pure,
    List.take_of_length_le (Nat.le_of_eq (wordLength 32 v))]

def wordResponse (world : EvmCompiler.Simulation.OpenWorld) (v : Nat) : EvmCompiler.Simulation.CallResponse :=
  ⟨true,bytesToByteArray (wordToBytesBE 32 v),world,EvmYul.UInt256.ofNat 0⟩
end Inv48.Minima
