import Inv39UniversalGenesisFacts
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.UniversalGenesis
set_option maxRecDepth 20000
set_option maxHeartbeats 0
theorem shortWrite (s : State) (slot : Nat) (bs : List Source.Byte)
    (small : bs.length≤31) (zero : s.loadSlot slot=0) :
    s.storeStorageBytesAt slot bs=s.storeSlot slot (storageBytesShortWord (bs.map normByte)) := by
  unfold State.storeStorageBytesAt
  rw [zero]
  simp only [List.length_map,if_pos small]
  simp [storageBytesHeader?,Shared.norm,State.clearStorageBytesLongSlots,State.clearStorageBytesLongSlotsFuel]
end Inv39.UniversalGenesis
