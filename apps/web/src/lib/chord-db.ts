import guitar from "@tombatossals/chords-db/lib/guitar.json";
import ukulele from "@tombatossals/chords-db/lib/ukulele.json";
import type { ChordDb, Instrument } from "@zeolite/core";

/** Fingering databases (chords-db, MIT). Mandolin has no database yet: custom shapes only. */
export const CHORD_DBS: Partial<Record<Instrument, ChordDb>> = {
  guitar: guitar as unknown as ChordDb,
  ukulele: ukulele as unknown as ChordDb,
};
