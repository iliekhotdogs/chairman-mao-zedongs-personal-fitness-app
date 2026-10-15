// Shared by the local coach and the Edge Function so safety gates agree.
const URGENT = /\b(?:chest (?:pain|tightness|pressure)|can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|short(?:ness)? of breath|faint(?:ed|ing)?|passed out|black(?:ed)? out|dizz(?:y|iness))\b/i;
const RED_FLAGS = /\b(?:swell(?:ing|s)?|swollen|numb(?:ness)?|tingl(?:e|es|ing)|sharp|pop(?:ped|ping)?|snap(?:ped|ping)?|can'?t (?:walk|bear|put weight|move)|cannot (?:walk|bear|put weight|move)|unable to (?:walk|bear weight|move)|fell|fall(?:en|ing)?|bruis(?:e|es|ed|ing)|locked|gave way|giving way|worse at night|radiat(?:e|es|ed|ing))\b/i;

export const isUrgentSymptom = (message: string) => URGENT.test(message);
export const hasInjuryRedFlag = (message: string) => RED_FLAGS.test(message);
