import Inv08FundingTransition
import Inv08Authority
open SolidCore.Solidity.Source
namespace Inv08.AddStream
open FundingHistory ExpiryStorage
def withEth (s : State) (f : Funding) := s.storeFieldWord Field.ethOut.field (stored s .ethOut + f.eth)
def withOutstanding (s : State) (f : Funding) := (withEth s f).storeFieldWord Field.repOut.field (stored s .repOut + f.rep)
def nextId (s : State) (f : Funding) (previous : Record) :=
  stored s .latest + (if previous.endAt=f.time+stored s .duration then 0 else 1)
def withId (s : State) (f : Funding) (previous : Record) :=
  if previous.endAt=f.time+stored s .duration then withOutstanding s f
  else (withOutstanding s f).storeFieldWord Field.latest.field (nextId s f previous)
def withRecord (s : State) (f : Funding) (previous : Record) :=
  install (withId s f previous) (mappingStorageSlot 7 (nextId s f previous)) (add (stored s .duration) previous f)
def withEthCursor (s : State) (f : Funding) (previous : Record) :=
  (withRecord s f previous).storeFieldWord Field.ethCursor.field (stored s .ethCursor + f.eth*f.time)
def post (s : State) (f : Funding) (previous : Record) :=
  (withEthCursor s f previous).storeFieldWord Field.repCursor.field (stored s .repCursor + f.rep*f.time)
/-- Field separation facts at the write boundaries of the generated funding body. -/
structure StageReads (s : State) (f : Funding) (previous : Record) : Prop where
  repOutstanding : stored (withEth s f) .repOut = stored s .repOut
  through : stored (withOutstanding s f) .through = f.time
  duration : stored (withOutstanding s f) .duration = stored s .duration
  latest : stored (withOutstanding s f) .latest = stored s .latest
  previousTuple : tuple (withOutstanding s f) (mappingStorageSlot 7 (stored s .latest)) = .tuple previous.words
  finalId : stored (withId s f previous) .latest = nextId s f previous
  mappedThrough : stored (withRecord s f previous) .through = f.time
  mappedEthCursor : stored (withRecord s f previous) .ethCursor = stored s .ethCursor
  ethThrough : stored (withEthCursor s f previous) .through = f.time
  ethRepCursor : stored (withEthCursor s f previous) .repCursor = stored s .repCursor

end Inv08.AddStream
