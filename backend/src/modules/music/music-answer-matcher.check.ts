import assert from "node:assert/strict";
import { matchesArtistAnswer, matchesSongAnswer } from "./music-answer-matcher.js";

const songCases: Array<[string, string, boolean]> = [
  ["Die With a Smile", "Die With a Smile (Official Music Video)", true],
  ["Die With a Smile (Official Music Video)", "Die With a Smile", true],
  ["I Can't Get No", "(I Can't Get No) Satisfaction", true],
  ["Smells Like Teen", "Smells Like Teen Spirit (Official Video)", true],
  ["birds of feather", "BIRDS OF A FEATHER [Official Music Video]", true],
  ["Bohemian Rapsody", "Bohemian Rhapsody", true],
  ["Flowers", "Flowers (Official Video)", true],
  ["Nunca es suficiente", "Nunca Es Suficiente (Video Oficial)", true],
  ["Me rehúso", "Me Rehúso (Official Audio)", true],
  ["No se va", "No Se Va (En Vivo)", true],
  ["I Want It", "I Want It That Way", true],
  ["Sweet Child o Mine", "Sweet Child O' Mine [Official Music Video]", true],
  ["Rolling in the", "Rolling in the Deep", true],
  ["official music video", "Die With a Smile (Official Music Video)", false],
  ["with a smile", "Die With a Smile", true],
  ["Die With", "Die With a Smile", false],
  ["Teen Spirit", "Smells Like Teen Spirit", false],
  ["Shape of You", "Thinking Out Loud", false],
  ["Live Version", "Hotel California (Live Version)", false],
  ["I Want That", "I Want It That Way", false],
  ["Nunca fue suficiente", "Nunca Es Suficiente", false],
];

const artistCases: Array<[string, string, boolean]> = [
  ["Bruno Mars", "Lady Gaga and Bruno Mars", true],
  ["Lady Gaga", "Lady Gaga feat. Bruno Mars", true],
  ["ROSÉ", "ROSÉ & Bruno Mars", true],
  ["Mark Ronson", "Mark Ronson, Bruno Mars", true],
  ["Luis Fonsi", "Luis Fonsi ft. Daddy Yankee", true],
  ["Daddy Yanki", "Luis Fonsi ft. Daddy Yankee", true],
  ["Guns N Roses", "Guns N' Roses", true],
  ["Bruno Marz", "Lady Gaga & Bruno Mars", true],
  ["Daddy Yankee", "Luis Fonsi / Daddy Yankee", true],
  ["Shakira", "Shakira y Bizarrap", true],
  ["Michael Jackson", "The Jackson 5", false],
  ["Mars", "Bruno Mars", false],
  ["Lady", "Lady Gaga and Bruno Mars", false],
];

for (const [candidate, expected, result] of songCases) {
  assert.equal(matchesSongAnswer(candidate, expected), result, `canción: ${candidate} / ${expected}`);
}
for (const [candidate, expected, result] of artistCases) {
  assert.equal(matchesArtistAnswer(candidate, expected), result, `artista: ${candidate} / ${expected}`);
}

console.log(`Verificador musical: ${songCases.length + artistCases.length} casos correctos.`);
