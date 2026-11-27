import Inv48ExposureHeapQuote
open SolidCore.Solidity.Source
namespace Inv48.ExposureHeap
set_option maxRecDepth 65536
set_option maxHeartbeats 3000000
set_option linter.unusedSimpArgs false

theorem byteList_loop (bs : ByteArray) (i : Nat) (acc : List UInt8) :
    ByteArray.toList.loop bs i acc = acc.reverse ++ bs.data.toList.drop i := by
  rw [ByteArray.toList.loop]
  split
  next h =>
    rw [byteList_loop bs (i+1) (bs.get! i :: acc)]
    simp only [List.reverse_cons,List.append_assoc,List.singleton_append]
    congr 1
    have hi : i < bs.data.toList.length := by simpa using h
    rw [List.drop_eq_getElem_cons hi]
    congr 1
    simp [ByteArray.get!,ByteArray.getElem_eq_getElem_data,h]
  next h => simp [List.drop_eq_nil_of_le (show bs.data.toList.length ≤ i by simpa using Nat.le_of_not_gt h)]
termination_by bs.size-i

theorem byteList_data (bs : ByteArray) : bs.toList = bs.data.toList := by
  exact byteList_loop bs 0 []

theorem bytes_roundtrip (bs : List Nat) :
    (byteArrayToBytes (bytesToByteArray bs)).map normByte = bs.map normByte := by
  simp only [byteArrayToBytes,byteList_data,bytesToByteArray,List.map_map]
  apply List.map_congr_left
  intro x hx
  simp [Function.comp_def,normByte,UInt8.toNat_ofNat,SolidCore.Solidity.Shared.Account.byte]
end Inv48.ExposureHeap
